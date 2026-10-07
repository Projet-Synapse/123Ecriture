import { Alert } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { StorageAccessFramework } from 'expo-file-system/legacy';

import { parseFrontmatter } from '../frontmatter';
import { CODE_FILE_EXTENSIONS } from '../codeLanguages';
import { getActiveVaultRootUri } from './nativeVaultsAdapter';

// Implémentation native (Android) de VaultBridge, sur le Storage Access
// Framework (SAF) — voir docs/ARCHITECTURE.md §5, "écart pragmatique"
// Phase 1 : l'implémentation Electron vit directement dans
// apps/desktop/electron/vault.ts, celle-ci en est le pendant natif, PREMIER
// vrai second consommateur du concept VaultAdapter décrit dans ce document
// (extraction d'un packages/storage commun laissée pour plus tard, une fois
// les deux implémentations éprouvées en usage réel).
//
// ⚠️ PAS TESTÉ SUR UN VRAI APPAREIL ANDROID (voir la conversation) — écrit
// aussi soigneusement que possible à partir de la documentation officielle
// expo-file-system/legacy, mais SAF a des cas limites documentés qui
// varient selon la version d'Android/le fournisseur de stockage (voir les
// commentaires ciblés ci-dessous, notamment sur readDirectoryAsync). À
// valider/corriger avec de vrais retours de bugs plutôt que par relecture.
//
// //1. 🗺️ Modèle interne (relPath ↔ URI SAF)
// //2. 📖 Lire/écrire le CONTENU d'un fichier SAF
// //3. 🌳 Parcours de l'arborescence
// //4. 🧩 Types de fichiers & noms disponibles
// //5. 🔌 Implémentation de VaultBridge

// //1. 🗺️ MODÈLE INTERNE (relPath ↔ URI SAF)
// ////////////////////////////////////////////////////////////////////////

// SAF travaille avec des URI `content://...`, pas des chemins — il n'existe
// aucune façon de "joindre" une URI + un relPath comme on le ferait avec
// `path.join` côté Node. On maintient donc un index reconstruit à chaque
// `listTree()` (l'écran Notes appelle toujours listTree avant d'ouvrir une
// note, voir NotesScreen.tsx) qui fait le pont entre le relPath affiché
// dans l'UI et l'URI SAF réelle nécessaire pour chaque opération suivante.
type IndexEntry = { uri: string; isDirectory: boolean };
let pathIndex = new Map<string, IndexEntry>();
let indexedRootUri: string | null = null;
// Dernier arbre construit — SAF est LENT (une requête content-resolver par
// entrée + une sonde dossier/fichier) : ~1000 notes = près d'une minute de
// parcours. listTree renvoie ce cache tant que le coffre ne change pas ;
// toute mutation de l'index (création, renommage, pull...) l'invalide via
// invalidateTree() pour que l'ouverture suivante reflète le disque.
let cachedTree: VaultTreeNode[] | null = null;

function invalidateTree(): void {
  cachedTree = null;
  scheduleIndexPersist();
}

// SAF rend toute relecture du coffre RUINEUSE (une requete par entree) : le
// hachage de synchro (nativeSyncAdapter) ne relit donc que ce qui a change.
// Chaque mutation du coffre enregistre le relPath touche dans une file
// PERSISTEE (l'app peut etre tuee entre l'ecriture et le cycle) ; le
// consommateur (takeDirtyPathsForRoot) vide sa part. Les metadonnees
// .123ecriture/** ne sont jamais hachees (hors arbre synchronise).
type DirtyItem = { root: string; relPath: string };
const DIRTY_QUEUE_PATH = `${FileSystem.documentDirectory}sync-dirty-queue.json`;
let dirtyQueue: DirtyItem[] | null = null;

async function loadDirtyQueue(): Promise<DirtyItem[]> {
  if (dirtyQueue) return dirtyQueue;
  try {
    const raw = await FileSystem.readAsStringAsync(DIRTY_QUEUE_PATH);
    const parsed = JSON.parse(raw) as { items?: DirtyItem[] };
    dirtyQueue = Array.isArray(parsed.items) ? parsed.items : [];
  } catch {
    dirtyQueue = []; // absent/corrompu : repart a vide
  }
  return dirtyQueue;
}

function markVaultFileDirty(relPath: string): void {
  if (relPath.startsWith('.123ecriture/')) return;
  void (async () => {
    const root = await getActiveVaultRootUri();
    if (!root) return;
    const queue = await loadDirtyQueue();
    queue.push({ root, relPath });
    try {
      await FileSystem.writeAsStringAsync(DIRTY_QUEUE_PATH, JSON.stringify({ items: queue }));
    } catch {
      // Ecriture ratee : la file reste en memoire ; au pire (processus tue),
      // le fichier sera re-hache au prochain cycle complet (baseline vide).
    }
  })();
}

// Vide la part de la file qui concerne CE coffre et renvoie les relPaths.
export async function takeDirtyPathsForRoot(rootUri: string): Promise<string[]> {
  const queue = await loadDirtyQueue();
  const mine: string[] = [];
  const rest: DirtyItem[] = [];
  for (const item of queue) {
    if (item.root === rootUri) mine.push(item.relPath);
    else rest.push(item);
  }
  dirtyQueue = rest;
  try {
    await FileSystem.writeAsStringAsync(DIRTY_QUEUE_PATH, JSON.stringify({ items: rest }));
  } catch {
    // Best-effort : en cas d'echec, la file memoire reste a jour.
  }
  return mine;
}

// Garantit que l'index reflechit le coffre actif (construit si necessaire) —
// utilise par nativeSyncAdapter avant toute lecture indexee.
export async function ensureVaultIndexed(): Promise<void> {
  const rootUri = await requireActiveRootUri();
  if (indexedRootUri !== rootUri) {
    if (await loadPersistedIndex(rootUri)) return;
    pathIndex = new Map();
    indexedRootUri = rootUri;
    cachedTree = await walkSafTree(rootUri, '');
    await persistIndex();
  }
}

// Lecture seule de l'index pour nativeSyncAdapter (hachage incrémental) —
// la Map reste privée au module, seules ces deux fenêtres sont exposées.
export function getVaultIndexKeys(): string[] {
  return [...pathIndex.keys()];
}

export function getVaultIndexEntry(relPath: string): IndexEntry | undefined {
  return pathIndex.get(relPath);
}

function resolveIndexed(relPath: string): IndexEntry {
  const entry = pathIndex.get(relPath);
  if (!entry) {
    throw new Error(
      `« ${relPath} » est introuvable — l'arborescence a peut-être changé ailleurs. Rouvre l'explorateur pour rafraîchir.`,
    );
  }
  return entry;
}

async function requireActiveRootUri(): Promise<string> {
  const uri = await getActiveVaultRootUri();
  if (!uri) throw new Error('Aucun coffre sélectionné.');
  return uri;
}

// //2. 📖 LIRE/ÉCRIRE LE CONTENU D'UN FICHIER SAF
// ////////////////////////////////////////////////////////////////////////

// `readAsStringAsync` ne sait PAS lire une URI `content://` directement
// (documenté) — le contournement standard est de copier le fichier SAF vers
// le cache privé de l'app, puis de le lire normalement depuis ce chemin
// `file://`, et de nettoyer ensuite.
async function readSafFileText(uri: string): Promise<string> {
  const tmpPath = `${FileSystem.cacheDirectory}saf-read-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    await FileSystem.copyAsync({ from: uri, to: tmpPath });
    return await FileSystem.readAsStringAsync(tmpPath);
  } finally {
    await FileSystem.deleteAsync(tmpPath, { idempotent: true });
  }
}

// `writeAsStringAsync` fonctionne directement sur une URI SAF, mais
// uniquement si le fichier existe DÉJÀ (documenté : "you can't create a new
// file" via cette fonction sur une URI SAF) — créer un nouveau fichier
// passe par `StorageAccessFramework.createFileAsync` (voir plus bas),
// jamais par celle-ci.
async function writeSafFileText(uri: string, content: string): Promise<void> {
  await FileSystem.writeAsStringAsync(uri, content);
}

// //3. 🌳 PARCOURS DE L'ARBORESCENCE
// ////////////////////////////////////////////////////////////////////////

function extensionKind(name: string): VaultEntryKind | null {
  const lower = name.toLowerCase();
  if (lower.endsWith('.mdx') || lower.endsWith('.md')) return 'markdown';
  if (lower.endsWith('.canvas')) return 'canvas';
  if (lower.endsWith('.chart')) return 'chart';
  if (lower.endsWith('.excalidraw')) return 'excalidraw';
  // Fichiers code (.py/.ts/.js/…) — même liste que le desktop/web (source
  // de vérité unique : lib/codeLanguages.ts).
  if (CODE_FILE_EXTENSIONS.some((extension) => lower.endsWith(extension))) return 'code';
  return null;
}

// Extensions de CONTENU reconnues (même liste que createNote plus bas).
const KNOWN_CONTENT_EXTS = [
  '.mdx',
  '.md',
  '.canvas',
  '.chart',
  '.excalidraw',
  '.base',
  ...CODE_FILE_EXTENSIONS,
];

// Nom SANS extension de contenu — même convention que le desktop
// (apps/desktop/electron/vault.ts : `name: entry.name.slice(0,
// -extension.length)`), forme contre laquelle toute l'interface a été
// écrite : titres inline, onglets, autocomplétion `[[`, résolution des
// liens internes (`note.name === cible`), étiquettes du graphe. L'arbre
// natif livrait le nom AVEC extension : titres affichés « Note.md », et
// les `[[Note]]` ne matchaient plus (ouvrir un lien recréait une note ;
// graphe : 0 liens, vécu A13, 2026-10-03).
function baseNameOf(name: string): string {
  const lower = name.toLowerCase();
  const ext = KNOWN_CONTENT_EXTS.find((known) => lower.endsWith(known));
  return ext ? name.slice(0, -ext.length) : name;
}

// `FileInfo` est une union discriminée par `exists` — le champ
// `modificationTime` (en secondes, d'où le ×1000) n'existe que sur la
// branche `exists: true`, TypeScript le refuse sinon.
function modifiedAtFromInfo(info: FileSystem.FileInfo): number {
  return info.exists && info.modificationTime ? info.modificationTime * 1000 : Date.now();
}

function nameFromSafUri(uri: string): string {
  // Dernier segment de l'ID document décodé — fonctionne pour le
  // fournisseur "stockage externe primaire" d'Android (le cas courant),
  // documenté comme technique standard pour SAF+Expo. Peut se comporter
  // différemment avec un fournisseur de documents tiers (ex. un dossier
  // partagé par une autre appli) — à surveiller si des noms bizarres
  // apparaissent dans l'arborescence.
  const decoded = decodeURIComponent(uri);
  const afterLastSlash = decoded.split('/').pop() ?? decoded;
  return afterLastSlash.split(':').pop() ?? afterLastSlash;
}

// ⚠️ Android 11+ (MediaProvider) : à la création SAF, si l'extension du nom
// ne résout pas vers le MIME demandé, il AJOUTE l'extension du MIME au nom
// (« .md » demandé en text/plain → « .md.txt » sur disque, vécu fix4 :
// 1026 fichiers invisibles). Il faut demander LE MIME QUE RÉSOUT
// L'EXTENSION : .md → text/markdown ; .json → application/json ; .txt →
// text/plain ; les extensions qu'Android ne connaît pas (.mdx, .canvas,
// .chart, .excalidraw, .base) résolvent en application/octet-stream — même
// valeur demandée → aucun ajout.
function mimeForName(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith('.md')) return 'text/markdown';
  if (lower.endsWith('.json')) return 'application/json';
  if (lower.endsWith('.txt')) return 'text/plain';
  return 'application/octet-stream';
}

// ⚠️ Point à tester en priorité sur un vrai appareil : un bug documenté
// d'expo-file-system (issue GitHub #20102) fait que `readDirectoryAsync`
// sur l'URI d'un SOUS-dossier peut, sur certaines versions d'Android,
// renvoyer le contenu du dossier PARENT (celui pour lequel la permission a
// été accordée) plutôt que celui du sous-dossier demandé. Si l'arborescence
// affichée répète le même contenu à chaque niveau, c'est ce bug — la
// parade documentée est de re-dériver l'URI du sous-dossier via
// `StorageAccessFramework.getUriForDirectoryInRoot` plutôt que d'utiliser
// telle quelle l'URI renvoyée par le parcours ; pas implémenté ici tant que
// ça n'a pas été confirmé nécessaire en usage réel.
async function walkSafTree(dirUri: string, parentRelPath: string, depth = 0): Promise<VaultTreeNode[]> {
  if (depth > 40) return []; // garde-fou anti-boucle, jamais légitime à cette profondeur
  const childUris = await StorageAccessFramework.readDirectoryAsync(dirUri);
  return walkSafChildren(childUris, parentRelPath, depth);
}

// ⚠️ PAS de getInfoAsync ici : en SAF, expo-file-system legacy l'implémente
// par openInputStream — sur un DOSSIER le fournisseur répond
// « Function not implemented » (IOException non attrapée, tout le parcours
// avorte — vécu sur A13 : « les fichiers ne chargent jamais »), et sur un
// fichier isDirectory vaut TOUJOURS false. On sonde donc chaque enfant avec
// readSAFDirectoryAsync : réussite = DOSSIER (les enfants sont déjà
// récupérés, aucun aller-retour de plus), rejet = fichier.
async function walkSafChildren(childUris: string[], parentRelPath: string, depth: number, meta = false): Promise<VaultTreeNode[]> {
  if (depth > 40) return [];
  const nodes: VaultTreeNode[] = [];
  for (const uri of childUris) {
    const name = nameFromSafUri(uri);
    const relPath = parentRelPath ? `${parentRelPath}/${name}` : name;
    // Le sous-arbre .123ecriture/** (métadonnées de synchro : état, journal,
    // bases de fusion) est INDEXÉ pour readNote/writeNote mais jamais
    // renvoyé dans l'arbre visible — sans lui, loadSyncState/appendJournal/
    // saveSyncBase échouaient (« introuvable ») dès le premier cycle.
    const isMeta =
      meta ||
      relPath === '.123ecriture' ||
      relPath.startsWith('.123ecriture/') ||
      relPath === '.trash' ||
      relPath.startsWith('.trash/');
    if (name.startsWith('.') && !isMeta) continue; // masque les cachés, comme walkTree côté Electron
    let grandChildren: string[] | null = null;
    try {
      grandChildren = await StorageAccessFramework.readDirectoryAsync(uri);
    } catch {
      grandChildren = null; // fichier (un dossier illisible serait traité en fichier — coffres réels lisibles)
    }
    if (grandChildren) {
      pathIndex.set(relPath, { uri, isDirectory: true });
      const children = await walkSafChildren(grandChildren, relPath, depth + 1, isMeta);
      if (!isMeta) nodes.push({ type: 'folder', relPath, name, children });
    } else {
      if (isMeta) {
        // .json/.txt de métadonnées : indexés même sans extension reconnue.
        pathIndex.set(relPath, { uri, isDirectory: false });
        continue;
      }
      const kind = extensionKind(name);
      if (!kind) continue; // ignore les fichiers non reconnus (pièces jointes...), comme walkTree
      pathIndex.set(relPath, { uri, isDirectory: false });
      // modifiedAt inconnu en SAF (l'implémentation expo ne l'expose pas) :
      // l'arborescence ne trie jamais par date (voir reorder ci-dessous).
      nodes.push({ type: 'note', relPath, name, modifiedAt: Date.now(), kind });
    }
  }
  // Dossiers d'abord, puis notes, alphabétique — même ordre par défaut que
  // walkTree côté Electron ('fileSortMode' manuel/récent non supporté ici
  // pour l'instant, voir reorder() plus bas).
  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
    return a.name.localeCompare(b.name, 'fr');
  });
  return nodes;
}

async function refreshIndex(): Promise<VaultTreeNode[]> {
  const rootUri = await requireActiveRootUri();
  pathIndex = new Map();
  indexedRootUri = rootUri;
  cachedTree = await walkSafTree(rootUri, '');
  await persistIndex();
  return cachedTree;
}

// L'index est PERSISTE hors du coffre (documentDirectory) : un parcours SAF
// complet coute ~1 requete par entree (~1 min sur un grand coffre, thread
// JS sature, UI figee) — le rejouer a chaque remontee d'ecran ou
// redemarrage rendait l'explorateur « vide » pendant tout le parcours
// (vécu : arbre visible un instant puis vide a chaque retour sur Notes).
// Les URI SAF document sont des identifiants stables (permission d'arbre
// persistante) : au lancement, l'index recharge du disque permet de
// RECONSTRUIRE l'arbre en pur JS, sans une seule requete SAF. Un fichier
// supprime hors de l'app donnera une URI morte qui echouera per-file
// (gere) et sera purge au prochain parcours complet.
type PersistedIndex = { rootUri: string | null; entries: Record<string, { u: string; d: boolean }> };
const INDEX_PATH = `${FileSystem.documentDirectory}vault-index.json`;
let indexPersistTimer: ReturnType<typeof setTimeout> | null = null;

async function persistIndex(): Promise<void> {
  const entries: PersistedIndex['entries'] = {};
  for (const [relPath, entry] of pathIndex) entries[relPath] = { u: entry.uri, d: entry.isDirectory };
  const payload: PersistedIndex = { rootUri: indexedRootUri, entries };
  try {
    await FileSystem.writeAsStringAsync(INDEX_PATH, JSON.stringify(payload));
  } catch {
    // Cache : un echec degrade la prochaine ouverture (parcours complet).
  }
}

function scheduleIndexPersist(): void {
  if (indexPersistTimer) clearTimeout(indexPersistTimer);
  indexPersistTimer = setTimeout(() => void persistIndex(), 1500);
}

// Tente de restaurer l'index du coffre depuis le disque. Retourne true si
// l'index correspond bien a CE coffre (rootUri identique).
async function loadPersistedIndex(rootUri: string): Promise<boolean> {
  try {
    const raw = await FileSystem.readAsStringAsync(INDEX_PATH);
    const parsed = JSON.parse(raw) as PersistedIndex;
    if (parsed.rootUri !== rootUri || !parsed.entries) return false;
    pathIndex = new Map();
    for (const [relPath, entry] of Object.entries(parsed.entries)) {
      pathIndex.set(relPath, { uri: entry.u, isDirectory: entry.d });
    }
    indexedRootUri = rootUri;
    return pathIndex.size > 0;
  } catch {
    return false;
  }
}

// Reconstruit l'arbre VISIBLE depuis l'index (pur JS, instantane) — meme
// forme que walkSafChildren : dossiers d'abord, tri alphabetique fr,
// .123ecriture et .trash indexes mais jamais affiches.
function buildTreeFromIndex(): VaultTreeNode[] {
  type Builder = { folders: Map<string, Builder>; notes: VaultTreeNode[] };
  const root: Builder = { folders: new Map(), notes: [] };
  // Puits pour les chemins cachés (.123ecriture/**, .trash/**) : indexés
  // pour readNote/hash, mais jamais rendus dans l'arbre visible.
  const hidden: Builder = { folders: new Map(), notes: [] };
  const isHiddenRoot = (relPath: string): boolean =>
    relPath === '.123ecriture' || relPath.startsWith('.123ecriture/') || relPath === '.trash' || relPath.startsWith('.trash/');
  const builderFor = (parentRelPath: string, isMeta: boolean): Builder => {
    if (!parentRelPath) return isMeta ? hidden : root;
    if (isMeta || isHiddenRoot(parentRelPath)) {
      let sink = hidden;
      let acc = '';
      for (const segment of parentRelPath.split('/')) {
        acc = acc ? `${acc}/${segment}` : segment;
        let next = sink.folders.get(acc);
        if (!next) {
          next = { folders: new Map(), notes: [] };
          sink.folders.set(acc, next);
        }
        sink = next;
      }
      return sink;
    }
    let current = root;
    let acc = '';
    for (const segment of parentRelPath.split('/')) {
      acc = acc ? `${acc}/${segment}` : segment;
      let next = current.folders.get(acc);
      if (!next) {
        next = { folders: new Map(), notes: [] };
        current.folders.set(acc, next);
      }
      current = next;
    }
    return current;
  };
  // Les dossiers d'abord (y compris VIDES — ils émergent ici, pas des
  // parents de fichiers), puis les fichiers.
  for (const [relPath, entry] of pathIndex) {
    if (!entry.isDirectory) continue;
    const slash = relPath.lastIndexOf('/');
    builderFor(slash >= 0 ? relPath.slice(0, slash) : '', isHiddenRoot(relPath));
  }
  for (const [relPath, entry] of pathIndex) {
    if (entry.isDirectory) continue;
    const slash = relPath.lastIndexOf('/');
    const parentRelPath = slash >= 0 ? relPath.slice(0, slash) : '';
    const name = slash >= 0 ? relPath.slice(slash + 1) : relPath;
    const isMeta = isHiddenRoot(relPath);
    const target = builderFor(parentRelPath, isMeta);
    const kind = extensionKind(name);
    if (!kind) continue;
    target.notes.push({ type: 'note', relPath, name: baseNameOf(name), modifiedAt: Date.now(), kind });
  }
  const toNodes = (builder: Builder): VaultTreeNode[] => {
    const nodes: VaultTreeNode[] = [];
    for (const [relPath, child] of builder.folders) {
      const slash = relPath.lastIndexOf('/');
      const name = slash >= 0 ? relPath.slice(slash + 1) : relPath;
      nodes.push({ type: 'folder', relPath, name, children: toNodes(child) });
    }
    for (const note of builder.notes) nodes.push(note);
    nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
      return a.name.localeCompare(b.name, 'fr');
    });
    return nodes;
  };
  return toNodes(root);
}

// //4. 🧩 TYPES DE FICHIERS & NOMS DISPONIBLES
// ////////////////////////////////////////////////////////////////////////

const EXTENSION_FOR_KIND: Record<VaultEntryKind, string> = {
  markdown: '.mdx',
  canvas: '.canvas',
  chart: '.chart',
  excalidraw: '.excalidraw',
  // Extension de RETENU — le flux normal fournit le nom AVEC l'extension
  // choisie (`Sans titre.py`, reconnue via KNOWN_CONTENT_EXTS ci-dessus),
  // port du handler desktop (vault.ts create-note).
  code: '.js',
};

// ⚠️ Toutes ces extensions sont inconnues d'Android (sauf à demander le
// MIME qu'elles résolvent) : application/octet-stream = seule valeur qui
// n'ajoute PAS de suffixe au nom à la création SAF (voir mimeForName).
const MIME_FOR_KIND: Record<VaultEntryKind, string> = {
  markdown: 'application/octet-stream',
  canvas: 'application/octet-stream',
  chart: 'application/octet-stream',
  excalidraw: 'application/octet-stream',
  code: 'application/octet-stream',
};

// Même règle de limite de mot que TAG_PATTERN dans
// apps/desktop/electron/search.ts (précédé d'un espace/saut de ligne/
// tabulation ou début de texte) — reproduite ici plutôt que partagée, même
// convention de duplication assumée qu'entre ce fichier-là et
// apps/mobile/lib/markdownPlugins.ts (voir leurs commentaires respectifs) :
// aucun `packages/` commun aujourd'hui pour la porter une seule fois.
const TAG_PATTERN = /(^|[\s])#([\p{L}\p{N}_-]+)/gu;

function defaultContentForKind(kind: VaultEntryKind, title: string): string {
  if (kind === 'markdown') return `---\ntitle: ${title}\ncreated: ${new Date().toISOString()}\n---\n\n`;
  if (kind === 'canvas') return JSON.stringify({ nodes: [], edges: [] }, null, 2);
  if (kind === 'excalidraw') return JSON.stringify({ type: 'excalidraw', elements: [], appState: {} }, null, 2);
  if (kind === 'code') return ''; // fichier code vide, comme VS Code
  return JSON.stringify({ columns: [], rows: [], chart: null }, null, 2);
}

function findAvailableName(baseName: string, siblingNames: Set<string>): string {
  if (!siblingNames.has(baseName)) return baseName;
  const dotIndex = baseName.lastIndexOf('.');
  const stem = dotIndex === -1 ? baseName : baseName.slice(0, dotIndex);
  const ext = dotIndex === -1 ? '' : baseName.slice(dotIndex);
  for (let n = 2; n < 1000; n++) {
    const candidate = `${stem} ${n}${ext}`;
    if (!siblingNames.has(candidate)) return candidate;
  }
  throw new Error('Trop de fichiers du même nom.');
}

function siblingNamesOf(parentRelPath: string): Set<string> {
  const names = new Set<string>();
  const prefix = parentRelPath ? `${parentRelPath}/` : '';
  for (const relPath of pathIndex.keys()) {
    if (!relPath.startsWith(prefix)) continue;
    const rest = relPath.slice(prefix.length);
    if (!rest.includes('/')) names.add(rest);
  }
  return names;
}

async function resolveParentUri(parentRelPath: string | undefined): Promise<string> {
  if (!parentRelPath) return requireActiveRootUri();
  return resolveIndexed(parentRelPath).uri;
}

// Résout l'URI d'un dossier en le CRÉANT (récursivement depuis la racine)
// s'il manque à l'index — nécessaire pour écrire un fichier dont le parent
// n'existe pas encore (ex. premier pull : .123ecriture/bases/). Les
// dossiers déjà présents sur disque sont normalement dans l'index (le
// parcours indexe .123ecriture/** et les dossiers visibles), donc on ne
// crée vraiment que ce qui manque.
async function ensureSafDir(parentRelPath: string): Promise<string> {
  const rootUri = await requireActiveRootUri();
  if (!parentRelPath) return rootUri;
  let parentUri = rootUri;
  let acc = '';
  for (const seg of parentRelPath.split('/')) {
    acc = acc ? `${acc}/${seg}` : seg;
    const entry = pathIndex.get(acc);
    if (entry?.isDirectory) {
      parentUri = entry.uri;
      continue;
    }
    const newUri = await StorageAccessFramework.makeDirectoryAsync(parentUri, seg);
    pathIndex.set(acc, { uri: newUri, isDirectory: true });
    invalidateTree();
    parentUri = newUri;
  }
  return parentUri;
}

// //5. 🔌 IMPLÉMENTATION DE VaultBridge
// ////////////////////////////////////////////////////////////////////////

export const nativeVaultAdapter: VaultBridge = {
  // Délègue au coffre actif (voir nativeVaultsAdapter.ts) — même relation
  // que côté Electron, où vault:choose-folder appelle en interne
  // vaults.pickAndAddExistingVault().
  chooseFolder: async () => {
    const uri = await getActiveVaultRootUri();
    return uri;
  },

  getCurrentPath: () => getActiveVaultRootUri(),

  listTree: async () => {
    if (cachedTree) return cachedTree;
    const rootUri = await requireActiveRootUri();
    if (indexedRootUri !== rootUri) {
      // Redemarrage / changement de coffre : l'index persiste evite le
      // parcours SAF complet (voir la note au-dessus de persistIndex).
      if (await loadPersistedIndex(rootUri)) {
        cachedTree = buildTreeFromIndex();
        return cachedTree;
      }
      await refreshIndex();
      return cachedTree!;
    }
    // Coffre courant, arbre juste invalide : reconstruction instantanee
    // depuis l'index (les mutations y sont deja appliquees).
    cachedTree = buildTreeFromIndex();
    return cachedTree;
  },

  readNote: async (relPath) => {
    const { uri, isDirectory } = resolveIndexed(relPath);
    if (isDirectory) throw new Error(`« ${relPath} » est un dossier, pas une note.`);
    return readSafFileText(uri);
  },

  writeNote: async (relPath, content) => {
    const cached = pathIndex.get(relPath);
    if (cached) {
      if (cached.isDirectory) throw new Error(`« ${relPath} » est un dossier, pas une note.`);
      await writeSafFileText(cached.uri, content);
      // Les metadonnees de synchro s'ecrivent a CHAQUE cycle : les exclure
      // de l'invalidation evite de relancer un parcours d'une minute juste
      // apres (l'arbre VISIBLE n'a pas change).
      if (!relPath.startsWith('.123ecriture/')) invalidateTree();
      markVaultFileDirty(relPath);
      return;
    }
    // Fichier absent de l'index (note créée sur un autre appareil et tirée
    // ici, premières métadonnées .123ecriture d'un coffre neuf) : le créer,
    // ainsi que ses dossiers parents manquants — writeNote desktop fait de
    // même ; resolveIndexed lèverait ici « introuvable » (vécu : chaque
    // pull refusait l'écriture, v0.4.41-fix4).
    const parentRelPath = relPath.includes('/') ? relPath.slice(0, relPath.lastIndexOf('/')) : '';
    const parentUri = await ensureSafDir(parentRelPath);
    const name = relPath.slice(relPath.lastIndexOf('/') + 1);
    // ⚠️ SAF ne sait pas ÉCRASER : createFileAsync sur un nom déjà pris
    // crée un DOUBLON numéroté (« appearance (1).json »). Or l'index peut
    // ignorer un fichier pourtant présent sur le disque (index persisté
    // antérieur à sa création) — l'écriture atterrissait dans le doublon,
    // jamais relue au démarrage : l'apparence semblait se réinitialiser à
    // chaque relance (vécu A13, 2026-10-04, « appearance (1..3).json »).
    // On liste donc le parent pour retrouver l'URI EXISTANTE du fichier et
    // écrire dedans ; création seulement s'il n'existe vraiment pas.
    let uri: string | null = null;
    try {
      const children = await StorageAccessFramework.readDirectoryAsync(parentUri);
      uri = children.find((child) => nameFromSafUri(child) === name) ?? null;
    } catch {
      uri = null; // listage impossible : on retombe sur la création
    }
    if (!uri) {
      uri = await StorageAccessFramework.createFileAsync(parentUri, name, mimeForName(name));
    }
    await writeSafFileText(uri, content);
    pathIndex.set(relPath, { uri, isDirectory: false });
    if (!relPath.startsWith('.123ecriture/')) invalidateTree();
    markVaultFileDirty(relPath);
  },

  createNote: async (name, parentRelPath, kind = 'markdown') => {
    const parentUri = await resolveParentUri(parentRelPath);
    const ext = EXTENSION_FOR_KIND[kind];
    // Un nom finissant déjà par une extension de contenu reconnue (.md venu
    // d'un lien interne, par ex.) ne doit PAS recevoir '.mdx' en plus —
    // vécu : « …mondes.md.mdx » créé à la racine au clic d'un lien interne.
    const baseName = KNOWN_CONTENT_EXTS.some((known) => name.toLowerCase().endsWith(known))
      ? name
      : `${name}${ext}`;
    const finalName = findAvailableName(baseName, siblingNamesOf(parentRelPath ?? ''));
    const finalExt = KNOWN_CONTENT_EXTS.find((known) => finalName.toLowerCase().endsWith(known)) ?? ext;
    const newUri = await StorageAccessFramework.createFileAsync(parentUri, finalName, mimeForName(finalName));
    const title = finalName.slice(0, finalName.length - finalExt.length);
    await writeSafFileText(newUri, defaultContentForKind(kind, title));
    const relPath = parentRelPath ? `${parentRelPath}/${finalName}` : finalName;
    pathIndex.set(relPath, { uri: newUri, isDirectory: false });
    invalidateTree();
    markVaultFileDirty(relPath);
    // Même convention que le desktop (vault.ts:525) : le retour porte le
    // nom SANS extension.
    return { relPath, name: baseNameOf(finalName), modifiedAt: Date.now(), kind };
  },

  createFolder: async (name, parentRelPath) => {
    const parentUri = await resolveParentUri(parentRelPath);
    const finalName = findAvailableName(name, siblingNamesOf(parentRelPath ?? ''));
    const newUri = await StorageAccessFramework.makeDirectoryAsync(parentUri, finalName);
    const relPath = parentRelPath ? `${parentRelPath}/${finalName}` : finalName;
    pathIndex.set(relPath, { uri: newUri, isDirectory: true });
    invalidateTree();
    return { relPath, name: finalName };
  },

  // Aucune fonction SAF "renommer" native n'existe (voir la doc
  // expo-file-system/legacy) — copie du CONTENU vers un nouveau fichier
  // puis suppression de l'original SEULEMENT une fois la copie confirmée
  // (jamais l'inverse, pour ne pas risquer de perdre le contenu si la copie
  // échoue en cours de route). Volontairement limité aux FICHIERS : un
  // renommage de DOSSIER nécessiterait de recopier tout un sous-arbre
  // récursivement sans jamais avoir pu tester ce chemin sur un vrai
  // appareil — le risque de perte de données d'un bug non détecté dans ce
  // cas précis est trop élevé pour le tenter à l'aveugle (voir CLAUDE.md
  // § Comportement).
  rename: async (relPath, newName) => {
    const { uri, isDirectory } = resolveIndexed(relPath);
    if (isDirectory) {
      throw new Error(
        'Renommer un dossier n’est pas encore pris en charge sur Android — dis-le si tu en as vraiment besoin, ça demande un développement dédié plus prudent.',
      );
    }
    const parentRelPath = relPath.includes('/') ? relPath.slice(0, relPath.lastIndexOf('/')) : '';
    const name = relPath.slice(relPath.lastIndexOf('/') + 1);
    const parentUri = await resolveParentUri(parentRelPath || undefined);
    const content = await readSafFileText(uri);
    // Le fichier renommé lui-même ne doit pas compter comme collision :
    // sinon valider le titre SANS le modifier créait « … 2.md », puis
    // « … 2 2.md » à chaque validation (vécu : « mondes 2 2 2 2… »).
    const siblings = siblingNamesOf(parentRelPath);
    siblings.delete(relPath);
    // Comme le desktop (vault:rename) : préserve l'extension RÉELLE du
    // fichier quand le nouveau nom n'en porte pas. L'arbre (et donc le
    // champ de renommage) donne désormais des noms sans extension — sans
    // ce rattrapage, « Note » devenait un fichier sans extension,
    // invisible de l'arbre (extensionKind ne le reconnaît plus).
    const hadKnownExt = KNOWN_CONTENT_EXTS.find((known) => name.toLowerCase().endsWith(known));
    const carriesKnownExt = KNOWN_CONTENT_EXTS.some((known) => newName.toLowerCase().endsWith(known));
    const candidate = hadKnownExt && !carriesKnownExt ? `${newName}${hadKnownExt}` : newName;
    const finalName = findAvailableName(candidate, siblings);
    if (finalName === name) {
      // Nom inchangé : aucun fichier à créer/supprimer, l'état reste bon.
      return { relPath, name: baseNameOf(name), modifiedAt: Date.now(), kind: extensionKind(name) ?? 'markdown' };
    }
    const finalKind = extensionKind(finalName);
    const mimeType = finalKind ? MIME_FOR_KIND[finalKind] : mimeForName(finalName);
    const newUri = await StorageAccessFramework.createFileAsync(parentUri, finalName, mimeType);
    await writeSafFileText(newUri, content);
    await FileSystem.deleteAsync(uri, { idempotent: true });
    const newRelPath = parentRelPath ? `${parentRelPath}/${finalName}` : finalName;
    pathIndex.delete(relPath);
    pathIndex.set(newRelPath, { uri: newUri, isDirectory: false });
    invalidateTree();
    markVaultFileDirty(relPath);
    markVaultFileDirty(newRelPath);
    return { relPath: newRelPath, name: baseNameOf(finalName) };
  },

  // Même raisonnement que rename() ci-dessus : fichiers uniquement, copie
  // avant suppression, dossiers explicitement non supportés pour l'instant.
  move: async (relPath, destinationParentRelPath) => {
    const { uri, isDirectory } = resolveIndexed(relPath);
    if (isDirectory) {
      throw new Error(
        'Déplacer un dossier n’est pas encore pris en charge sur Android — dis-le si tu en as vraiment besoin.',
      );
    }
    const name = relPath.includes('/') ? relPath.slice(relPath.lastIndexOf('/') + 1) : relPath;
    const destUri = await resolveParentUri(destinationParentRelPath);
    const content = await readSafFileText(uri);
    const finalName = findAvailableName(name, siblingNamesOf(destinationParentRelPath ?? ''));
    const finalKind = extensionKind(finalName);
    const mimeType = finalKind ? MIME_FOR_KIND[finalKind] : mimeForName(finalName);
    const newUri = await StorageAccessFramework.createFileAsync(destUri, finalName, mimeType);
    await writeSafFileText(newUri, content);
    await FileSystem.deleteAsync(uri, { idempotent: true });
    const newRelPath = destinationParentRelPath ? `${destinationParentRelPath}/${finalName}` : finalName;
    pathIndex.delete(relPath);
    pathIndex.set(newRelPath, { uri: newUri, isDirectory: false });
    invalidateTree();
    markVaultFileDirty(relPath);
    markVaultFileDirty(newRelPath);
    return { relPath: newRelPath, name: baseNameOf(finalName) };
  },

  // Édition manuelle de chemin complet (voir EditPathDialog.tsx) — même
  // limite fichiers-uniquement, réutilise move()/rename() par-dessous.
  setPath: async (relPath, newRelPath) => {
    const { isDirectory } = resolveIndexed(relPath);
    if (isDirectory) {
      throw new Error('Modifier le chemin d’un dossier n’est pas encore pris en charge sur Android.');
    }
    const newParent = newRelPath.includes('/') ? newRelPath.slice(0, newRelPath.lastIndexOf('/')) : '';
    const newName = newRelPath.includes('/') ? newRelPath.slice(newRelPath.lastIndexOf('/') + 1) : newRelPath;
    const moved = await nativeVaultAdapter.move(relPath, newParent || undefined);
    // move() renvoie le nom SANS extension (convention desktop) : comparer
    // la même forme, sinon un simple déplacement déclenchait un renommage
    // parasite (« Note » vs « Note.md »).
    if (moved.name !== baseNameOf(newName)) return nativeVaultAdapter.rename(moved.relPath, newName);
    return moved;
  },

  // Suppression réellement récursive gérée par l'OS Android lui-même (un
  // seul appel natif, pas une boucle qu'on écrit soi-même) — bien plus
  // fiable que rename()/move() ci-dessus. Confirmation JS AVANT de
  // supprimer (Alert.alert, natif RN) : jamais de suppression silencieuse,
  // même règle que le dialog natif côté Electron (voir vault.ts,
  // vault:delete). `options.silent` (v0.4.25) : réservé au moteur de
  // synchro (tombestones distantes appliquées en masse) — pas de
  // confirmation par fichier. v0.4.26 : sans `options.permanent`, le
  // fichier est copié dans `.trash/` (corbeille LOCALE — la synchro ne
  // tourne pas en natif Android) avant destruction ; pas d'élagage des
  // dossiers vides, expo-file-system n'expose pas de rmdir sûr.
  delete: (relPath: string, options?: { silent?: boolean; permanent?: boolean }) =>
    new Promise((resolve) => {
      const { uri } = resolveIndexed(relPath);
      const run = () => {
        void FileSystem.deleteAsync(uri, { idempotent: true }).then(() => {
          pathIndex.delete(relPath);
          invalidateTree();
          markVaultFileDirty(relPath);
          resolve({ deleted: true });
        });
      };
      const toTrash = async () => {
        if (options?.permanent) return;
        try {
          const dot = relPath.lastIndexOf('.');
          const withoutExt = dot >= 0 ? relPath.slice(0, dot) : relPath;
          const ext = dot >= 0 ? relPath.slice(dot) : '';
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          const trashUri = `${FileSystem.documentDirectory}.trash/${timestamp}-${withoutExt.replace(/\//g, '__')}${ext}`;
          await FileSystem.makeDirectoryAsync(`${FileSystem.documentDirectory}.trash`, { intermediates: true });
          await FileSystem.copyAsync({ from: uri, to: trashUri });
        } catch {
          // Best-effort : la corbeille échouée ne doit jamais bloquer la
          // suppression demandée.
        }
      };
      const runWithTrash = () => {
        void toTrash().then(run);
      };
      if (options?.silent) {
        runWithTrash();
        return;
      }
      const { isDirectory } = resolveIndexed(relPath);
      const name = relPath.includes('/') ? relPath.slice(relPath.lastIndexOf('/') + 1) : relPath;
      Alert.alert(
        isDirectory ? 'Supprimer ce dossier ?' : 'Supprimer cette note ?',
        isDirectory
          ? `« ${name} » et tout son contenu seront déplacés vers la corbeille (.trash).`
          : `« ${name} » sera déplacée vers la corbeille (.trash).`,
        [
          { text: 'Annuler', style: 'cancel', onPress: () => resolve({ deleted: false }) },
          {
            text: 'Supprimer',
            style: 'destructive',
            onPress: runWithTrash,
          },
        ],
        { cancelable: true, onDismiss: () => resolve({ deleted: false }) },
      );
    }),

  getLastOpened: async () => {
    try {
      const path = `${FileSystem.documentDirectory}123ecriture-last-opened.txt`;
      const info = await FileSystem.getInfoAsync(path);
      if (!info.exists) return null;
      const value = await FileSystem.readAsStringAsync(path);
      return value || null;
    } catch {
      return null;
    }
  },

  setLastOpened: async (relPath) => {
    const path = `${FileSystem.documentDirectory}123ecriture-last-opened.txt`;
    await FileSystem.writeAsStringAsync(path, relPath ?? '');
  },

  // Dossiers repliés de l'explorateur — même persistance documentDirectory
  // que last-opened ci-dessus (un fichier dédié, tableau JSON), même
  // best-effort que côté Electron (vault.ts/state.json) : une lecture ou
  // écriture qui échoue dégrade le repli, jamais les données.
  getCollapsedPaths: async () => {
    try {
      const path = `${FileSystem.documentDirectory}123ecriture-collapsed.json`;
      const info = await FileSystem.getInfoAsync(path);
      if (!info.exists) return [];
      const raw = await FileSystem.readAsStringAsync(path);
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === 'string') : [];
    } catch {
      return [];
    }
  },

  setCollapsedPaths: async (relPaths) => {
    const path = `${FileSystem.documentDirectory}123ecriture-collapsed.json`;
    await FileSystem.writeAsStringAsync(path, JSON.stringify(relPaths));
  },

  // Onglets de notes ouverts — même persistance documentDirectory dédiée
  // que collapsed-paths ci-dessus, alignée sur vault:get/set-open-tabs
  // (Electron, state.json) : NotesScreen.tsx dégrade gracieusement quand
  // le bridge est absent, mais l'adaptateur natif POURVUT les méthodes
  // pour rester conforme à VaultBridge.
  getOpenTabs: async () => {
    try {
      const path = `${FileSystem.documentDirectory}123ecriture-open-tabs.json`;
      const info = await FileSystem.getInfoAsync(path);
      if (!info.exists) return [];
      const raw = await FileSystem.readAsStringAsync(path);
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === 'string') : [];
    } catch {
      return [];
    }
  },

  setOpenTabs: async (relPaths) => {
    const path = `${FileSystem.documentDirectory}123ecriture-open-tabs.json`;
    await FileSystem.writeAsStringAsync(path, JSON.stringify(relPaths));
  },

  // "Note du jour" (Calendrier) — voir CalendarScreen.tsx. Réutilise
  // createNote ; idempotent (renvoie la note existante si déjà créée
  // aujourd'hui) comme la version Electron.
  ensureDailyNote: async (dateIso) => {
    const parentRelPath = 'Journal';
    const fileName = `${dateIso}.mdx`;
    const relPath = `${parentRelPath}/${fileName}`;
    const cached = pathIndex.get(relPath);
    if (cached) {
      const info = await FileSystem.getInfoAsync(cached.uri);
      return { relPath, name: baseNameOf(fileName), modifiedAt: modifiedAtFromInfo(info), kind: 'markdown' };
    }
    if (!pathIndex.has(parentRelPath)) {
      await nativeVaultAdapter.createFolder('Journal', undefined);
    }
    return nativeVaultAdapter.createNote(dateIso, parentRelPath, 'markdown');
  },

  // Tri manuel (glisser-déposer, `.123ecriture/order.json` côté Electron) —
  // non implémenté pour l'instant sur Android : on retourne l'arborescence
  // telle quelle (toujours alphabétique) plutôt que de risquer un ordre
  // persistant mal géré. Pas d'erreur levée : c'est une dégradation
  // silencieuse ACCEPTABLE (contrairement à delete/rename/move) puisqu'elle
  // ne touche aucune donnée, juste l'ordre d'affichage.
  reorder: async () => refreshIndex(),

  // Nécessiterait expo-document-picker (nouvelle dépendance, pas encore
  // ajoutée/vérifiée) — volontairement non implémenté cette session plutôt
  // que bâclé. Retourne `null`, exactement le même contrat qu'un choix
  // annulé côté Electron (voir NotesScreen.tsx, handleInsertAttachment gère
  // déjà ce cas sans erreur).
  importAttachment: async () => {
    console.warn('[nativeVaultAdapter] importAttachment pas encore implémenté sur Android.');
    return null;
  },

  readAttachmentDataUrl: async (relPath) => {
    const { uri } = resolveIndexed(relPath);
    const tmpPath = `${FileSystem.cacheDirectory}saf-attachment-${Date.now()}`;
    try {
      await FileSystem.copyAsync({ from: uri, to: tmpPath });
      const base64 = await FileSystem.readAsStringAsync(tmpPath, { encoding: FileSystem.EncodingType.Base64 });
      const ext = relPath.toLowerCase().split('.').pop() ?? '';
      const mime =
        ext === 'png' ? 'image/png' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'gif' ? 'image/gif' : 'application/octet-stream';
      return `data:${mime};base64,${base64}`;
    } finally {
      await FileSystem.deleteAsync(tmpPath, { idempotent: true });
    }
  },

  // Duplique un FICHIER existant dans SON PROPRE dossier — même limite
  // fichiers-uniquement que rename()/move() ci-dessus (dupliquer un dossier
  // demanderait une copie récursive jamais éprouvée sur un vrai appareil).
  // Suffixe " (copie)"/" (copie 2)"... comme vault:duplicate côté Electron
  // (apps/desktop/electron/vault.ts) — findAvailableName() ci-dessus
  // suffixerait juste " 2"/" 3", moins explicite pour identifier une copie.
  duplicate: async (relPath) => {
    const { uri, isDirectory } = resolveIndexed(relPath);
    if (isDirectory) {
      throw new Error('Dupliquer un dossier n’est pas encore pris en charge sur Android.');
    }
    const parentRelPath = relPath.includes('/') ? relPath.slice(0, relPath.lastIndexOf('/')) : '';
    const parentUri = await resolveParentUri(parentRelPath || undefined);
    const segment = relPath.includes('/') ? relPath.slice(relPath.lastIndexOf('/') + 1) : relPath;
    const kind = extensionKind(segment) ?? 'markdown';
    const ext = EXTENSION_FOR_KIND[kind];
    const baseName = segment.slice(0, segment.length - ext.length);

    const siblings = siblingNamesOf(parentRelPath);
    let candidateName = `${baseName} (copie)${ext}`;
    let counter = 2;
    while (siblings.has(candidateName)) {
      candidateName = `${baseName} (copie ${counter})${ext}`;
      counter += 1;
    }

    const content = await readSafFileText(uri);
    const newUri = await StorageAccessFramework.createFileAsync(parentUri, candidateName, MIME_FOR_KIND[kind]);
    await writeSafFileText(newUri, content);
    const newRelPath = parentRelPath ? `${parentRelPath}/${candidateName}` : candidateName;
    pathIndex.set(newRelPath, { uri: newUri, isDirectory: false });
    invalidateTree();
    markVaultFileDirty(newRelPath);
    return {
      relPath: newRelPath,
      name: candidateName.slice(0, candidateName.length - ext.length),
      modifiedAt: Date.now(),
      kind,
    };
  },

  // Vue dédiée aux tags (voir NotesScreen.tsx, bascule Fichiers/Tags) — même
  // esprit que vault:list-tags côté Electron (search.ts) : reparcourt le
  // coffre à la demande (refreshIndex, jamais un index potentiellement
  // périmé) et extrait les `#tags` du CORPS de chaque note markdown
  // (frontmatter exclu, via parseFrontmatter), regroupés par tag.
  listTags: async () => {
    await refreshIndex();
    const notesByTag = new Map<string, { relPath: string; name: string }[]>();

    for (const [relPath, entry] of pathIndex) {
      if (entry.isDirectory || extensionKind(relPath) !== 'markdown') continue;
      let content: string;
      try {
        content = await readSafFileText(entry.uri);
      } catch {
        continue; // fichier illisible entre le listage et la lecture — ignoré
      }
      const { body } = parseFrontmatter(content);
      const segment = relPath.includes('/') ? relPath.slice(relPath.lastIndexOf('/') + 1) : relPath;
      const kind = extensionKind(segment);
      const name = kind ? segment.slice(0, segment.length - EXTENSION_FOR_KIND[kind].length) : segment;

      for (const match of body.matchAll(TAG_PATTERN)) {
        const tag = match[2].toLowerCase();
        const notes = notesByTag.get(tag) ?? [];
        notes.push({ relPath, name });
        notesByTag.set(tag, notes);
      }
    }

    return [...notesByTag.entries()]
      .map(([tag, notes]) => ({ tag, notes }))
      .sort((a, b) => a.tag.localeCompare(b.tag, 'fr'));
  },
};

// Utilisé par installNativeBridges.ts pour invalider l'index si le coffre
// actif change pendant que l'app tourne (changement de coffre depuis les
// Paramètres, par ex.) — évite de continuer à résoudre des relPath par
// rapport à un ancien coffre.
export function invalidateIndexIfRootChanged(currentRootUri: string | null): void {
  if (indexedRootUri !== currentRootUri) {
    pathIndex = new Map();
    indexedRootUri = currentRootUri;
    cachedTree = null;
  }
}
