//////////
// ✒️ 123ECRITURE — nativeVaultAdapter.ts
// PONT DE COFFRE NATIF (ANDROID) — FICHIERS ORDINAIRES (refonte v0.4.76)
//////////

// INTRODUCTION — Implémentation de VaultBridge sur des chemins de fichiers
// ordinaires (`/storage/emulated/0/…` via la permission « Accès à tous les
// fichiers »), rendant le mobile ÉQUIVALENT au desktop : mêmes lectures/
// écritures directes, mêmes dates de fichiers, renommage et déplacement de
// dossiers inclus. Remplace l'ancien pont Storage Access Framework, dont
// chaque contournement (index persisté, écriture sans troncature,
// permissions révocables, dossiers dupliqués) a produit des incidents
// documentés dans docs/vault-incidents.md. Le SAF ne sert plus qu'UNE fois :
// pour laisser l'utilisatrice CHOISIR un dossier existant (sélecteur
// système) — jamais pour lire ni écrire.
//
// RÈGLES (mêmes que côté desktop) :
//   - segments cachés exclus de l'arbre visible, SAUF `.trash` (corbeille
//     du coffre, synchronisée) — `.123ecriture/**` reste accessible en
//     lecture/écriture directe sans apparaître dans l'arbre ;
//   - noms contenant un `\` jamais affichés (résidus de contamination) ;
//   - suppression = déplacement vers `.trash/` (+ confirmation, sauf
//     `options.silent` réservé à la revue du moteur) ;
//   - aucune donnée n'est modifiée sans que l'opération soit réellement
//     terminée (copie avant suppression, jamais l'inverse).
//
// SOMMAIRE :
//   1. 🔑 Accès stockage (permission, racine, chemins)
//   2. 🧱 Helpers de contenu (extensions, noms disponibles, dates)
//   3. 🌳 Parcours de l'arborescence (direct, véridique)
//   4. 🔌 Implémentation de VaultBridge

import { Alert, Linking } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';

import { parseFrontmatter } from '../frontmatter';
import { CODE_FILE_EXTENSIONS } from '../codeLanguages';
import { getActiveVaultRootUri, requestAndRegisterVault } from './nativeVaultsAdapter';

//////// 1. 🔑 ACCÈS STOCKAGE (permission, racine, chemins) ///////////

// Racine du stockage partagé principal — cible unique des coffres.
const PRIMARY_ROOT = '/storage/emulated/0';

// Convertit un chemin ordinaire en URI exploitable par expo-file-system.
function fileUri(plainPath: string): string {
  return plainPath.startsWith('file://') ? plainPath : `file://${plainPath}`;
}

// Un contenu « could not be found » / permission refusée est traduit en
// message actionnable — jamais d'erreur anglaise nue remontée à l'écran.
function friendlyFsError(error: unknown, relPath: string): Error {
  const brut = error instanceof Error ? error.message : String(error);
  if (/could not be found|not exist|ENOENT/i.test(brut)) {
    return new Error(`« ${relPath} » est introuvable — l'arborescence a peut-être changé ailleurs. Rouvre l'explorateur pour rafraîchir.`);
  }
  if (/permission|denied|not writable|EACCES/i.test(brut)) {
    return new Error(`Accès refusé sur « ${relPath} » — la permission « Tous les fichiers » est-elle encore accordée à l'app ? (Paramètres → Applications → 123Ecriture → Autorisations)`);
  }
  return error instanceof Error ? error : new Error(brut);
}

// La permission « Accès à tous les fichiers » (Android 11+) est PROUVÉE par
// une opération réelle sur la racine du stockage — jamais supposée.
export async function hasAllFilesAccess(): Promise<boolean> {
  try {
    await FileSystem.readDirectoryAsync(fileUri(PRIMARY_ROOT));
    return true;
  } catch {
    return false;
  }
}

// Ouvre la page système « Tous les fichiers » de l'app (l'utilisatrice
// active l'interrupteur puis revient — la sonde ci-dessus revalide).
export async function requestAllFilesAccess(): Promise<void> {
  try {
    await Linking.sendIntent('android.settings.MANAGE_APP_ALL_FILES_ACCESS_PERMISSION', [
      { key: 'android.intent.extra.DATA', value: 'package:com.ecriture.app' },
    ]);
  } catch {
    await Linking.sendIntent('android.settings.MANAGE_ALL_FILES_ACCESS_PERMISSION');
  }
}

// Exige la permission avant toute opération du pont — message unique et
// actionnable (le même partout, pour que l'écran de diagnostic puisse
// l'identifier).
async function requireStorageAccess(): Promise<void> {
  if (!(await hasAllFilesAccess())) {
    await requestAllFilesAccess();
    if (!(await hasAllFilesAccess())) {
      throw new Error('Accès à tous les fichiers non accordé — active-le dans les réglages Android pour que 123Ecriture puisse lire ton coffre.');
    }
  }
}

// Racine du coffre ACTIF en chemin ordinaire (via le registre, qui migre
// les anciennes URI content:// — voir nativeVaultsAdapter.ts).
async function requireActiveRoot(): Promise<string> {
  const root = await getActiveVaultRootUri();
  if (!root) throw new Error('Aucun coffre sélectionné.');
  if (root.startsWith('content://')) {
    throw new Error('Ce coffre pointe encore vers une ancienne URI SAF — déconnecte puis reconnecte-le pour migrer vers le stockage direct.');
  }
  return root;
}

function vaultFileUri(relPath: string): Promise<string> {
  return requireActiveRoot().then((root) => fileUri(relPath ? `${root}/${relPath}` : root));
}

//////// 2. 🧱 HELPERS DE CONTENU (extensions, noms disponibles) ///////////

function extensionKind(name: string): VaultEntryKind | null {
  const lower = name.toLowerCase();
  if (lower.endsWith('.mdx') || lower.endsWith('.md')) return 'markdown';
  if (lower.endsWith('.canvas')) return 'canvas';
  if (lower.endsWith('.chart')) return 'chart';
  if (lower.endsWith('.excalidraw')) return 'excalidraw';
  if (CODE_FILE_EXTENSIONS.some((extension) => lower.endsWith(extension))) return 'code';
  return null;
}

const KNOWN_CONTENT_EXTS = ['.mdx', '.md', '.canvas', '.chart', '.excalidraw', '.base', ...CODE_FILE_EXTENSIONS];

// Nom SANS extension de contenu — convention desktop (titres inline,
// onglets, résolution des liens `[[Note]]`). L'arbre ne livre JAMAIS le nom
// avec extension, sinon les liens internes ne matchent plus.
function baseNameOf(name: string): string {
  const lower = name.toLowerCase();
  const ext = KNOWN_CONTENT_EXTS.find((known) => lower.endsWith(known));
  return ext ? name.slice(0, -ext.length) : name;
}

const EXTENSION_FOR_KIND: Record<VaultEntryKind, string> = {
  markdown: '.mdx',
  canvas: '.canvas',
  chart: '.chart',
  excalidraw: '.excalidraw',
  code: '.js',
};

// Même règle de mot que TAG_PATTERN desktop (search.ts) — dupliquée tant
// qu'aucun package commun n'existe (ARCHITECTURE.md §5).
const TAG_PATTERN = /(^|[\s])#([\p{L}\p{N}_-]+)/gu;

function defaultContentForKind(kind: VaultEntryKind, title: string): string {
  if (kind === 'markdown') return `---\ntitle: ${title}\ncreated: ${new Date().toISOString()}\n---\n\n`;
  if (kind === 'canvas') return JSON.stringify({ nodes: [], edges: [] }, null, 2);
  if (kind === 'excalidraw') return JSON.stringify({ type: 'excalidraw', elements: [], appState: {} }, null, 2);
  if (kind === 'code') return '';
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

// Écrit puis VÉRIFIE la taille du fichier (longueur UTF-8 du contenu). Sur
// fichiers ordinaires l'écriture tronque correctement — la vérification est
// une assurance gratuite contre toute régression de la couche basse : si la
// taille ne correspond pas, le fichier est réécrit à zéro.
async function writeTextVerified(fileUriTarget: string, content: string): Promise<void> {
  await FileSystem.writeAsStringAsync(fileUriTarget, content);
  const info = await FileSystem.getInfoAsync(fileUriTarget).catch(() => null);
  const size = info && info.exists && typeof info.size === 'number' ? info.size : null;
  if (size === null) return;
  let expected = 0;
  for (let i = 0; i < content.length; i += 1) {
    const code = content.charCodeAt(i);
    expected += code < 0x80 ? 1 : code < 0x800 ? 2 : code >= 0xd800 && code <= 0xdbff ? 4 : 3;
    if (code >= 0xd800 && code <= 0xdbff) i += 1;
  }
  if (size !== expected) await FileSystem.writeAsStringAsync(fileUriTarget, content);
}

async function listEntryNames(dirUri: string): Promise<string[]> {
  const entries = await FileSystem.readDirectoryAsync(dirUri);
  return entries.map((entry) => {
    if (!entry.includes('/')) return entry;
    const decoded = decodeURIComponent(entry.slice(entry.lastIndexOf('/') + 1));
    return decoded;
  });
}

//////// 3. 🌳 PARCOURS DE L'ARBORESCENCE (direct, véridique) ///////////

// Parcours récursif direct — chaque stat vient du disque (dates réelles),
// aucune couche intermédiaire ne peut décrire un contenu fantôme.
async function walkPlainTree(
  dirUri: string,
  parentRelPath: string,
  depth = 0,
): Promise<VaultTreeNode[]> {
  if (depth > 40) return [];
  const names = await listEntryNames(dirUri);
  const nodes: VaultTreeNode[] = [];
  for (const name of names) {
    const relPath = parentRelPath ? `${parentRelPath}/${name}` : name;
    if (name.startsWith('.')) continue; // .123ecriture, .trash… hors arbre visible
    if (name.includes('\\')) continue; // résidus de contamination : jamais affichés
    const childUri = `${dirUri}/${name}`;
    const info = await FileSystem.getInfoAsync(childUri);
    if (!info.exists) continue;
    if (info.isDirectory) {
      const children = await walkPlainTree(childUri, relPath, depth + 1);
      nodes.push({ type: 'folder', relPath, name, children });
      continue;
    }
    const kind = extensionKind(name);
    if (!kind) continue; // non reconnu (pièce jointe hors liste) : comme desktop
    nodes.push({
      type: 'note',
      relPath,
      name: baseNameOf(name),
      modifiedAt: info.modificationTime ? info.modificationTime * 1000 : Date.now(),
      kind,
    });
  }
  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
    return a.name.localeCompare(b.name, 'fr');
  });
  return nodes;
}

// Métadonnées synchronisées + pièces jointes : SOURCE UNIQUE dans
// syncRules.ts (partagé desktop+mobile) — ré-exportés ici pour les
// consommateurs existants du pont.
export { SYNCED_META_FILES, SYNC_ATTACHMENT_EXTENSIONS } from '../sync/syncRules';

//////// 4. 🔌 IMPLÉMENTATION DE VaultBridge (l'objet exposé à l'app) ///////////

// État d'UI du coffre actif (.123ecriture/state.json) — même fichier et
// même schéma que côté Electron (vault.ts) : lastOpenedRelPath,
// collapsedRelPaths, openTabRelPaths. Read-modify-write champ par champ.
type NativeVaultState = {
  lastOpenedRelPath?: string | null;
  collapsedRelPaths?: string[];
  openTabRelPaths?: string[];
};

async function readVaultStateFile(): Promise<NativeVaultState> {
  try {
    const parsed: unknown = JSON.parse(await nativeVaultAdapter.readNote('.123ecriture/state.json'));
    return parsed && typeof parsed === 'object' ? (parsed as NativeVaultState) : {};
  } catch {
    return {}; // absent (coffre neuf) ou coffre inactif : état vide
  }
}

async function patchVaultState(patch: NativeVaultState): Promise<void> {
  const next = { ...(await readVaultStateFile()), ...patch };
  await nativeVaultAdapter.writeNote('.123ecriture/state.json', JSON.stringify(next, null, 2));
}

async function readLegacyStringFile(name: string): Promise<string | null> {
  try {
    const path = `${FileSystem.documentDirectory}${name}`;
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists) return null;
    return (await FileSystem.readAsStringAsync(path)) || null;
  } catch {
    return null;
  }
}

async function readLegacyJsonArrayFile(name: string): Promise<string[]> {
  try {
    const path = `${FileSystem.documentDirectory}${name}`;
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists) return [];
    const parsed: unknown = JSON.parse(await FileSystem.readAsStringAsync(path));
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === 'string') : [];
  } catch {
    return [];
  }
}

async function writeNoteBinaryInternal(relPath: string, base64: string): Promise<void> {
  const root = await requireActiveRoot();
  const parentRelPath = relPath.includes('/') ? relPath.slice(0, relPath.lastIndexOf('/')) : '';
  const name = relPath.slice(relPath.lastIndexOf('/') + 1);
  const parentUri = fileUri(parentRelPath ? `${root}/${parentRelPath}` : root);
  await FileSystem.makeDirectoryAsync(parentUri, { intermediates: true }).catch(() => undefined);
  const siblings = new Set(await listEntryNames(parentUri));
  const finalName = findAvailableName(name, siblings);
  const target = `${parentUri}/${finalName}`;
  await FileSystem.writeAsStringAsync(target, base64, { encoding: FileSystem.EncodingType.Base64 });
  await writeTextVerified(target, base64).catch(() => undefined);
  void finalName;
}

export const nativeVaultAdapter: VaultBridge = {
  // Les parcours sont directs : rien à rafraîchir (la vérité vient du disque).
  rescan: async (): Promise<void> => undefined,

  chooseFolder: async () => {
    const existing = await getActiveVaultRootUri();
    if (existing) return existing;
    await requireStorageAccess();
    // AUCUN coffre actif : créer directement le dossier par défaut (pas de
    // sélecteur) — si le nom est pris, findAvailableName-like numérote.
    let name = '✒️ 123Ecriture';
    let candidate = `${PRIMARY_ROOT}/${name}`;
    let n = 2;
    while (await FileSystem.getInfoAsync(fileUri(candidate)).then((i) => i.exists).catch(() => false)) {
      name = `✒️ 123Ecriture ${n}`;
      candidate = `${PRIMARY_ROOT}/${name}`;
      n += 1;
    }
    await FileSystem.makeDirectoryAsync(fileUri(candidate), { intermediates: true });
    const liste = await requestAndRegisterVault(name, candidate);
    return liste.length > 0 ? liste[liste.length - 1].path : null;
  },

  getCurrentPath: () => getActiveVaultRootUri(),

  listTree: async () => {
    const root = await requireActiveRoot();
    await requireStorageAccess();
    return walkPlainTree(fileUri(root), '');
  },

  readNote: async (relPath) => {
    const target = await vaultFileUri(relPath);
    try {
      const info = await FileSystem.getInfoAsync(target);
      if (info.exists && info.isDirectory) throw new Error(`« ${relPath} » est un dossier, pas une note.`);
      return await FileSystem.readAsStringAsync(target);
    } catch (error) {
      throw friendlyFsError(error, relPath);
    }
  },

  writeNote: async (relPath, content) => {
    const root = await requireActiveRoot();
    const parentRelPath = relPath.includes('/') ? relPath.slice(0, relPath.lastIndexOf('/')) : '';
    const parentUri = fileUri(parentRelPath ? `${root}/${parentRelPath}` : root);
    await FileSystem.makeDirectoryAsync(parentUri, { intermediates: true }).catch(() => undefined);
    const target = `${parentUri}/${relPath.slice(relPath.lastIndexOf('/') + 1)}`;
    try {
      await writeTextVerified(target, content);
    } catch (error) {
      throw friendlyFsError(error, relPath);
    }
  },

  readNoteBinary: async (relPath) => {
    const target = await vaultFileUri(relPath);
    try {
      const info = await FileSystem.getInfoAsync(target);
      if (info.exists && info.isDirectory) throw new Error(`« ${relPath} » est un dossier, pas une pièce jointe.`);
      return await FileSystem.readAsStringAsync(target, { encoding: FileSystem.EncodingType.Base64 });
    } catch (error) {
      throw friendlyFsError(error, relPath);
    }
  },

  writeNoteBinary: writeNoteBinaryInternal,

  createNote: async (name, parentRelPath, kind = 'markdown') => {
    const root = await requireActiveRoot();
    const parentUri = fileUri(parentRelPath ? `${root}/${parentRelPath}` : root);
    await FileSystem.makeDirectoryAsync(parentUri, { intermediates: true }).catch(() => undefined);
    const ext = EXTENSION_FOR_KIND[kind];
    const baseName = KNOWN_CONTENT_EXTS.some((known) => name.toLowerCase().endsWith(known)) ? name : `${name}${ext}`;
    const siblings = new Set(await listEntryNames(parentUri));
    const finalName = findAvailableName(baseName, siblings);
    const finalExt = KNOWN_CONTENT_EXTS.find((known) => finalName.toLowerCase().endsWith(known)) ?? ext;
    const target = `${parentUri}/${finalName}`;
    const title = finalName.slice(0, finalName.length - finalExt.length);
    await writeTextVerified(target, defaultContentForKind(kind, title));
    const relPath = parentRelPath ? `${parentRelPath}/${finalName}` : finalName;
    return { relPath, name: baseNameOf(finalName), modifiedAt: Date.now(), kind };
  },

  createFolder: async (name, parentRelPath) => {
    const root = await requireActiveRoot();
    const parentUri = fileUri(parentRelPath ? `${root}/${parentRelPath}` : root);
    await FileSystem.makeDirectoryAsync(parentUri, { intermediates: true }).catch(() => undefined);
    const siblings = new Set(await listEntryNames(parentUri));
    const finalName = findAvailableName(name, siblings);
    const target = `${parentUri}/${finalName}`;
    await FileSystem.makeDirectoryAsync(target, { intermediates: true });
    const relPath = parentRelPath ? `${parentRelPath}/${finalName}` : finalName;
    return { relPath, name: finalName };
  },

  // Fichiers ET dossiers : moveAsync de la couche ordinaire déplace les deux
  // (l'ancien pont SAF ne savait pas — limitation disparue avec le socle).
  rename: async (relPath, newName) => {
    const root = await requireActiveRoot();
    const parentRelPath = relPath.includes('/') ? relPath.slice(0, relPath.lastIndexOf('/')) : '';
    const name = relPath.slice(relPath.lastIndexOf('/') + 1);
    const parentUri = fileUri(parentRelPath ? `${root}/${parentRelPath}` : root);
    const siblings = new Set(await listEntryNames(parentUri));
    siblings.delete(name);
    const hadKnownExt = KNOWN_CONTENT_EXTS.find((known) => name.toLowerCase().endsWith(known));
    const carriesKnownExt = KNOWN_CONTENT_EXTS.some((known) => newName.toLowerCase().endsWith(known));
    const candidate = hadKnownExt && !carriesKnownExt ? `${newName}${hadKnownExt}` : newName;
    const finalName = findAvailableName(candidate, siblings);
    if (finalName === name) {
      return { relPath, name: baseNameOf(name), modifiedAt: Date.now(), kind: extensionKind(name) ?? 'markdown' };
    }
    const target = `${parentUri}/${finalName}`;
    await FileSystem.moveAsync({ from: fileUri(`${root}/${relPath}`), to: target });
    const newRelPath = parentRelPath ? `${parentRelPath}/${finalName}` : finalName;
    return { relPath: newRelPath, name: baseNameOf(finalName) };
  },

  move: async (relPath, destinationParentRelPath) => {
    const root = await requireActiveRoot();
    const name = relPath.includes('/') ? relPath.slice(relPath.lastIndexOf('/') + 1) : relPath;
    const destUri = fileUri(destinationParentRelPath ? `${root}/${destinationParentRelPath}` : root);
    await FileSystem.makeDirectoryAsync(destUri, { intermediates: true }).catch(() => undefined);
    const siblings = new Set(await listEntryNames(destUri));
    const finalName = findAvailableName(name, siblings);
    await FileSystem.moveAsync({ from: fileUri(`${root}/${relPath}`), to: `${destUri}/${finalName}` });
    const newRelPath = destinationParentRelPath ? `${destinationParentRelPath}/${finalName}` : finalName;
    return { relPath: newRelPath, name: baseNameOf(finalName) };
  },

  setPath: async (relPath, newRelPath) => {
    const newParent = newRelPath.includes('/') ? newRelPath.slice(0, newRelPath.lastIndexOf('/')) : '';
    const newName = newRelPath.includes('/') ? newRelPath.slice(newRelPath.lastIndexOf('/') + 1) : newRelPath;
    const moved = await nativeVaultAdapter.move(relPath, newParent || undefined);
    if (moved.name !== baseNameOf(newName)) return nativeVaultAdapter.rename(moved.relPath, newName);
    return moved;
  },

  // Suppression = déplacement vers `.trash/` DU COFFRE (corbeille visible
  // et synchronisée — parité desktop), avec confirmation native sauf
  // `options.silent` (réservé à la revue du moteur, qui ne l'appelle plus
  // automatiquement depuis v0.4.73). `options.permanent` détruit réellement.
  delete: (relPath: string, options?: { silent?: boolean; permanent?: boolean }) =>
    new Promise((resolve) => {
      const run = () => {
        void (async () => {
          const root = await requireActiveRoot();
          const target = fileUri(`${root}/${relPath}`);
          if (options?.permanent) {
            await FileSystem.deleteAsync(target, { idempotent: true });
          } else {
            const dot = relPath.lastIndexOf('.');
            const withoutExt = dot >= 0 ? relPath.slice(0, dot) : relPath;
            const ext = dot >= 0 ? relPath.slice(dot) : '';
            const stamp = new Date().toISOString().replace(/[:.]/g, '-');
            const trashRelPath = `.trash/${withoutExt.replace(/\//g, '__')} ${stamp}${ext}`;
            const trashUri = fileUri(`${root}/${trashRelPath}`);
            await FileSystem.makeDirectoryAsync(fileUri(`${root}/.trash`), { intermediates: true }).catch(() => undefined);
            await FileSystem.moveAsync({ from: target, to: trashUri }).catch(async () => {
              await FileSystem.copyAsync({ from: target, to: trashUri });
              await FileSystem.deleteAsync(target, { idempotent: true });
            });
          }
          resolve({ deleted: true });
        })().catch(() => resolve({ deleted: false }));
      };
      if (options?.silent) {
        run();
        return;
      }
      const name = relPath.includes('/') ? relPath.slice(relPath.lastIndexOf('/') + 1) : relPath;
      Alert.alert(
        'Supprimer ?',
        `« ${name} » sera déplacé vers la corbeille du coffre (.trash).`,
        [
          { text: 'Annuler', style: 'cancel', onPress: () => resolve({ deleted: false }) },
          { text: 'Supprimer', style: 'destructive', onPress: run },
        ],
        { cancelable: true, onDismiss: () => resolve({ deleted: false }) },
      );
    }),

  // Corbeille du coffre (parité desktop v0.4.26) : contenu de `.trash/`,
  // du plus récent au plus ancien — IMPORTÉ sur mobile depuis la refonte
  // (l'ancien pont ne pouvait pas le faire : corbeille hors coffre).
  listTrash: async () => {
    const root = await requireActiveRoot();
    const trashUri = fileUri(`${root}/.trash`);
    const names = await listEntryNames(trashUri).catch(() => []);
    const out: { relPath: string; sizeBytes: number; modifiedAt: string }[] = [];
    for (const name of names) {
      const info = await FileSystem.getInfoAsync(`${trashUri}/${name}`).catch(() => null);
      if (!info || !info.exists || info.isDirectory) continue;
      out.push({
        relPath: `.trash/${name}`,
        sizeBytes: typeof info.size === 'number' ? info.size : 0,
        modifiedAt: info.modificationTime ? new Date(info.modificationTime * 1000).toISOString() : new Date(0).toISOString(),
      });
    }
    return out.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  },

  getLastOpened: async () => {
    const state = await readVaultStateFile();
    if (state.lastOpenedRelPath !== undefined) return state.lastOpenedRelPath ?? null;
    return readLegacyStringFile('123ecriture-last-opened.txt');
  },

  setLastOpened: async (relPath) => {
    await patchVaultState({ lastOpenedRelPath: relPath });
  },

  getCollapsedPaths: async () => {
    const state = await readVaultStateFile();
    if (state.collapsedRelPaths !== undefined) return state.collapsedRelPaths;
    return readLegacyJsonArrayFile('123ecriture-collapsed.json');
  },

  setCollapsedPaths: async (relPaths) => {
    await patchVaultState({ collapsedRelPaths: relPaths });
  },

  getOpenTabs: async () => {
    const state = await readVaultStateFile();
    if (state.openTabRelPaths !== undefined) return state.openTabRelPaths;
    return readLegacyJsonArrayFile('123ecriture-open-tabs.json');
  },

  setOpenTabs: async (relPaths) => {
    await patchVaultState({ openTabRelPaths: relPaths });
  },

  ensureDailyNote: async (dateIso) => {
    const parentRelPath = 'Journal';
    const relPath = `${parentRelPath}/${dateIso}.mdx`;
    const root = await requireActiveRoot();
    const info = await FileSystem.getInfoAsync(fileUri(`${root}/${relPath}`)).catch(() => null);
    if (info?.exists) {
      return {
        relPath,
        name: dateIso,
        modifiedAt: info.modificationTime ? info.modificationTime * 1000 : Date.now(),
        kind: 'markdown' as const,
      };
    }
    return nativeVaultAdapter.createNote(dateIso, parentRelPath, 'markdown');
  },

  // Tri manuel (glisser-déposer, `.123ecriture/order.json` côté Electron) —
  // non implémenté sur Android : l'ordre reste alphabétique (dégradation
  // d'affichage assumée, aucune donnée touchée).
  reorder: async () => nativeVaultAdapter.listTree(),

  importAttachment: async () => {
    const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
    if (result.canceled) return null;
    const asset = result.assets?.[0];
    if (!asset) return null;

    let folder = 'attachments';
    try {
      const prefs = (await window.preferences?.get()) as Partial<Preferences> | null;
      if (prefs?.attachmentsFolder && typeof prefs.attachmentsFolder === 'string') folder = prefs.attachmentsFolder;
    } catch {
      // Préférences indisponibles : le dossier par défaut convient.
    }

    const extension = asset.name.includes('.') ? asset.name.slice(asset.name.lastIndexOf('.')) : '';
    const stem = extension ? asset.name.slice(0, asset.name.length - extension.length) : asset.name;
    const base64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
    const root = await requireActiveRoot();
    const parentUri = fileUri(`${root}/${folder}`);
    await FileSystem.makeDirectoryAsync(parentUri, { intermediates: true }).catch(() => undefined);
    const siblings = new Set(await listEntryNames(parentUri));
    let name = asset.name;
    let relPath = `${folder}/${name}`;
    let counter = 2;
    while (siblings.has(name)) {
      name = `${stem} (${counter})${extension}`;
      relPath = `${folder}/${name}`;
      counter += 1;
    }
    await FileSystem.writeAsStringAsync(`${parentUri}/${name}`, base64, { encoding: FileSystem.EncodingType.Base64 });
    return { relPath, name };
  },

  readAttachmentDataUrl: async (relPath) => {
    const target = await vaultFileUri(relPath);
    const base64 = await FileSystem.readAsStringAsync(target, { encoding: FileSystem.EncodingType.Base64 });
    const ext = relPath.toLowerCase().split('.').pop() ?? '';
    const mime =
      ext === 'png' ? 'image/png' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'gif' ? 'image/gif' : 'application/octet-stream';
    return `data:${mime};base64,${base64}`;
  },

  // Fichiers ET dossiers (copyAsync récursif sur fichiers ordinaires) —
  // limitation « fichiers uniquement » de l'ancien pont disparue.
  duplicate: async (relPath) => {
    const root = await requireActiveRoot();
    const parentRelPath = relPath.includes('/') ? relPath.slice(0, relPath.lastIndexOf('/')) : '';
    const segment = relPath.includes('/') ? relPath.slice(relPath.lastIndexOf('/') + 1) : relPath;
    const kind = extensionKind(segment) ?? 'markdown';
    const parentUri = fileUri(parentRelPath ? `${root}/${parentRelPath}` : root);
    const siblings = new Set(await listEntryNames(parentUri));
    let candidate = `${segment} (copie)`;
    let counter = 2;
    while (siblings.has(candidate)) {
      candidate = `${segment} (copie ${counter})`;
      counter += 1;
    }
    await FileSystem.copyAsync({ from: fileUri(`${root}/${relPath}`), to: `${parentUri}/${candidate}` });
    const newRelPath = parentRelPath ? `${parentRelPath}/${candidate}` : candidate;
    return {
      relPath: newRelPath,
      name: baseNameOf(candidate),
      modifiedAt: Date.now(),
      kind: extensionKind(candidate) ?? kind,
    };
  },

  listTags: async () => {
    const tree = await nativeVaultAdapter.listTree();
    const notesByTag = new Map<string, { relPath: string; name: string }[]>();
    const stack = [...tree];
    while (stack.length) {
      const node = stack.pop()!;
      if (node.type === 'folder') {
        stack.push(...node.children);
        continue;
      }
      let content: string;
      try {
        content = await nativeVaultAdapter.readNote(node.relPath);
      } catch {
        continue; // illisible entre le listage et la lecture — ignoré
      }
      const { body } = parseFrontmatter(content);
      for (const match of body.matchAll(TAG_PATTERN)) {
        const tag = match[2].toLowerCase();
        const notes = notesByTag.get(tag) ?? [];
        notes.push({ relPath: node.relPath, name: node.name });
        notesByTag.set(tag, notes);
      }
    }
    return [...notesByTag.entries()].map(([tag, notes]) => ({ tag, notes })).sort((a, b) => a.tag.localeCompare(b.tag, 'fr'));
  },

  // Dates RÉELLES du disque (parité desktop) — la création n'est pas
  // exposée par Android : fallback sur la modification, documenté.
  getTimestamps: async (relPath) => {
    const target = await vaultFileUri(relPath);
    const info = await FileSystem.getInfoAsync(target);
    if (!info.exists) throw new Error(`« ${relPath} » est introuvable.`);
    const modifiedAt = info.modificationTime ? info.modificationTime * 1000 : Date.now();
    return { createdAt: modifiedAt, modifiedAt };
  },
};
