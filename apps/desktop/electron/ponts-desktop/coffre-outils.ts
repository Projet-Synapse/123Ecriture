// ✒️ 123ECRITURE — synchronisation vault/coffre-outils.ts — les outils du coffre (types, résolution, ordre, état, arborescence)
//////////////////////////////////////////////////////////////////////////////
//
// Les fonctions MÉTIER du coffre local, sans aucun handler IPC : résoudre
// un chemin DANS le coffre (borné, jamais en dehors), trier, lire/écrire
// l'ordre manuel et l'état d'interface par coffre, construire
// l'arborescence. vault.ts importe ces outils pour ses handlers.
//
// Invariants du fichier :
//   • Tout chemin passe par la résolution bornée au coffre — rien ne
//     sort du dossier, aucun chemin n'est reconstruit dynamiquement.
//   • EXTENSION_TO_KIND est la liste faisant foi partagée avec la
//     synchronisation (un fichier visible doit être synchronisable).
//   • La suppression est un DÉPLACEMENT vers .trash/ — jamais destructif
//     sauf depuis la corbeille elle-même.
//
// SOMMAIRE :
//   1. Types de fichiers et gabarits
//   2. Résolution de chemin et utilitaires
//   3. Ordre des fichiers
//   4. État par coffre
//   5. Arborescence
//
//////////////////////////////////////////////////////////////////////////////

import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';

import { readConfig } from '../config';
import * as vaults from './vaults';
import type { FileSortMode, VaultEntryKind, VaultOrder, VaultTreeNode } from '../types';
import { matchesEmbedTarget } from '../../../mobile/lib/notes/embedResolution';
import { CODE_FILE_EXTENSIONS } from '../../../mobile/lib/editor/codeLanguages';
import { normalizeRelPath } from '../../../mobile/lib/sync/relPath';


//////// 1. Types de fichiers et gabarits //////////////////////////////////

// Nom par défaut du dossier de pièces jointes — configurable depuis
// Paramètres → Gestion des fichiers et des liens (voir
// SettingsScreen.tsx/preferences.ts) ; ce fallback n'est utilisé qu'en
// l'absence de réglage stocké (ex. première utilisation, config.json
// absent).
const DEFAULT_ATTACHMENTS_FOLDER = 'attachments';

// Corbeille DU coffre, à sa racine. Dossier caché : exclu de l'explorateur
// comme tous les dossiers cachés, mais INCLUS dans la synchronisation (voir
// sync.ts walkAndHash) — la corbeille est partagée entre tous les appareils
// du compte. Restaurer = déplacer hors de .trash (le chemin d'origine est
// préservé par la structure miroir).
export const TRASH_FOLDER = '.trash';

export function getAttachmentsFolder(): string {
  return readConfig().preferences?.attachmentsFolder || DEFAULT_ATTACHMENTS_FOLDER;
}

// Paramètres → Gestion des fichiers et des liens → "Ordre des fichiers".
export function getFileSortMode(): FileSortMode {
  return readConfig().preferences?.fileSortMode ?? 'alphabetical';
}

const MIME_BY_EXTENSION: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.flac': 'audio/flac',
};

export function guessMimeType(fileName: string): string {
  return MIME_BY_EXTENSION[path.extname(fileName).toLowerCase()] ?? 'application/octet-stream';
}

// Un fichier du vault est reconnu comme "note" (feuille de l'arbre, ouvrable
// dans NotesScreen.tsx) selon son extension, qui détermine aussi son `kind`
// — pilote l'éditeur affiché côté renderer (MDX/CanvasEditor/ChartEditor,
// voir NotesScreen.tsx) et l'icône dans VaultTreeView.tsx. `.canvas` aligné
// sur JSON Canvas (https://jsoncanvas.org), `.chart` sur le format maison
// déjà utilisé par sheets.js (voir defaultContentForKind ci-dessous).
// Exportée : c'est aussi la liste faisant foi des extensions reconnues comme
// contenu de vault ailleurs dans le process principal (voir sync.ts —
// walkAndHash doit couvrir exactement les mêmes extensions que walkTree ici,
// sinon un type de fichier peut être visible dans l'arborescence mais
// invisible pour la synchro, silencieusement).
export const EXTENSION_TO_KIND: Record<string, VaultEntryKind> = {
  '.mdx': 'markdown',
  // Fichiers `.md` importés depuis Obsidian (ou tout autre éditeur
  // Markdown standard) — reconnus comme notes au même titre que `.mdx`,
  // juste avec une extension différente. Les nouvelles notes créées PAR
  // l'app restent en `.mdx` (voir KIND_TO_EXTENSION) ; `.md` n'est accepté
  // qu'en LECTURE d'un fichier déjà existant sur disque.
  '.md': 'markdown',
  '.canvas': 'canvas',
  '.chart': 'chart',
  '.excalidraw': 'excalidraw',
  // Obsidian Bases (vues de bases de données, YAML/texte) : traités comme
  // du texte markdown — sans cette entrée, les fichiers `.base` sont
  // invisibles pour l'arborescence ET pour la synchro, en silence (règle
  // générale des extensions ci-dessus).
  '.base': 'markdown',
  ...Object.fromEntries(CODE_FILE_EXTENSIONS.map((extension) => [extension, 'code' as const])),
};

export const KIND_TO_EXTENSION: Record<VaultEntryKind, string> = {
  markdown: '.mdx',
  canvas: '.canvas',
  chart: '.chart',
  excalidraw: '.excalidraw',
  // Extension de RETENU pour un fichier code créé sans extension dans son
  // nom — le flux normal (voir NotesScreen) fournit toujours le nom AVEC
  // l'extension choisie (`Sans titre.py`), extraite par create-note.
  code: '.js',
};

// Contenu initial d'un fichier fraîchement créé, selon son `kind` — gabarit
// frontmatter pour une note, structures JSON vides mais valides sinon (un
// CanvasEditor/ChartEditor vide doit pouvoir parser le fichier tel quel dès
// sa création, sans cas particulier "fichier neuf").
export function defaultContentForKind(kind: VaultEntryKind, safeName: string): string {
  if (kind === 'canvas') {
    return JSON.stringify({ nodes: [], edges: [] }, null, 2);
  }
  if (kind === 'chart') {
    return JSON.stringify(
      {
        columns: [
          { id: crypto.randomUUID(), name: 'Colonne A' },
          { id: crypto.randomUUID(), name: 'Colonne B' },
        ],
        rows: [],
        chart: null,
      },
      null,
      2,
    );
  }
  if (kind === 'excalidraw') {
    // Forme du fichier natif `.excalidraw` (https://excalidraw.com) — vide
    // mais valide, pour rester compatible si le vrai outil de dessin est
    // intégré plus tard (voir ExcalidrawEditor.tsx).
    return JSON.stringify({ type: 'excalidraw', version: 2, elements: [], appState: {} }, null, 2);
  }
  if (kind === 'code') {
    // Un fichier code naît VIDE (comme dans VS Code) : pas de gabarit — le
    // contenu dépend entièrement du langage, et un fichier vide est valide
    // dans tous.
    return '';
  }
  return `---\ntitle: ${safeName}\ncreated: ${new Date().toISOString()}\n---\n\n`;
}

//////// 2. Résolution de chemin et utilitaires ////////////////////////////

// Aucun chemin de coffre en dur ici : getVaultPath() délègue au coffre
// ACTIF du registre (vaults.ts) — un seul point de couture entre ce backend
// et le registre multi-coffres. Voir docs/ARCHITECTURE.md §5.
export function getVaultPath(): string | null {
  return vaults.getActiveVaultPath();
}

// La fenêtre est sandboxée (contextIsolation, pas de nodeIntegration) donc
// le renderer ne peut pas manipuler fs directement, mais mieux vaut quand
// même ne jamais faire confiance à un relPath IPC sans vérifier qu'il reste
// dans le vault (ex. contre un "../../etc/passwd" mal intentionné ou bugué).
export function resolveInVault(vaultPath: string, relPath: string): string {
  const root = path.resolve(vaultPath);
  const resolved = path.resolve(root, relPath);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(`Chemin hors du vault refusé : ${relPath}`);
  }
  return resolved;
}

// Dernière étape de résolution d'un embed (voir lib/embedResolution.ts) :
// parcours récursif du coffre à la recherche d'un fichier répondant à la
// cible (chemin exact, suffixe ou nom seul — matchesEmbedTarget). Même
// contention que walkNoteFiles (properties.ts) : chemins construits par
// Node depuis la racine résolue, bornés explicitement au coffre, dossiers
// cachés exclus (.trash, .123ecriture, .obsidian…). À chaque niveau les
// fichiers sont testés AVANT de descendre : la première correspondance est
// la moins profonde (comportement Obsidian en cas d'homonymes).
export async function findAttachmentByRelPath(vaultPath: string, target: string): Promise<string | null> {
  const rootAbs = path.resolve(vaultPath) + path.sep;

  async function walk(dir: string): Promise<string | null> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const fullPath = path.join(dir, entry.name);
      if (matchesEmbedTarget(path.relative(vaultPath, fullPath), target)) return fullPath;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const subDir = path.join(dir, entry.name);
      if (!(path.resolve(subDir) + path.sep).startsWith(rootAbs)) continue;
      const hit = await walk(subDir);
      if (hit) return hit;
    }
    return null;
  }

  return walk(path.resolve(vaultPath));
}

// Déplace un fichier/dossier vers `<coffre>/.trash/<relPath>` (structure
// miroir : le chemin d'origine reste lisible dans le chemin de corbeille,
// c'est ce qui permet la restauration). Même volume que la source (la
// corbeille vit DANS le coffre) donc un simple rename atomique ; collision
// (deux suppressions du même chemin à des dates différentes) dédoublonnée
// en « nom 2 » comme partout ailleurs. Ne détruit jamais rien.
export async function moveToVaultTrash(
  vaultPath: string,
  fullPath: string,
  relPath: string,
): Promise<void> {
  const normalizedRel = relPath.replace(/\\/g, '/');
  const trashTarget = path.join(vaultPath, TRASH_FOLDER, ...normalizedRel.split('/'));
  const trashParent = path.dirname(trashTarget);
  await fs.mkdir(trashParent, { recursive: true });
  let finalTarget = trashTarget;
  if (fsSync.existsSync(trashTarget)) {
    const extension = path.extname(trashTarget);
    const deduped = findAvailableName(trashParent, path.basename(trashTarget, extension), extension);
    finalTarget = path.join(trashParent, deduped);
  }
  await fs.rename(fullPath, finalTarget);
}

// Retire, en remontant depuis `startDir` jusqu'à la racine du coffre, chaque
// dossier devenu VIDE — utilisé après une suppression de synchro pour que le
// dossier conteneur disparaisse avec ses fichiers, et pas seulement ses
// fichiers. S'arrête au premier dossier non vide ; ne touche jamais la
// racine ni un dossier caché (.123ecriture…) ; best-effort (une erreur se
// contente d'arrêter la remontée).
export async function pruneEmptyAncestors(vaultPath: string, startDir: string): Promise<void> {
  const root = path.resolve(vaultPath);
  let current = path.resolve(startDir);
  while (current.startsWith(root + path.sep)) {
    const name = path.basename(current);
    if (name.startsWith('.')) return;
    let entries: fsSync.Dirent[];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    if (entries.length > 0) return;
    try {
      await fs.rmdir(current);
    } catch {
      return;
    }
    current = path.dirname(current);
  }
}

// Échappe les caractères spéciaux regex — utilisé pour retirer une
// extension de fichier (`.mdx`, `.md`...) d'un nom sans que le `.` soit
// interprété comme "n'importe quel caractère". Même utilitaire que
// occurrences.ts (dupliqué à dessein, voir le commentaire de walkAndHash
// dans sync.ts sur cette convention).
export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Trouve un nom de fichier/dossier disponible dans `dir` en suffixant
// " 2", " 3"... si `candidate` existe déjà — mêmes règles pour les notes et
// les dossiers.
export function findAvailableName(dir: string, candidate: string, extension = ''): string {
  let name = candidate;
  let counter = 2;
  while (fsSync.existsSync(path.join(dir, `${name}${extension}`))) {
    name = `${candidate} ${counter}`;
    counter += 1;
  }
  return `${name}${extension}`;
}

//////// 3. Ordre des fichiers (tri automatique + ordre manuel) ////////////

export function getOrderFilePath(vaultPath: string): string {
  return path.join(vaultPath, '.123ecriture', 'order.json');
}

// Ordre manuel des enfants d'un dossier — voir vault:reorder plus bas et
// apps/mobile/components/NotesScreen.tsx (glisser pour réordonner). Une clé
// par dossier PARENT (chemin relatif, "" pour la racine du vault), valeur =
// noms d'enfants dans l'ordre voulu. Absent/illisible = pas encore de tri
// manuel dans ce vault, on retombe sur le tri alphabétique par défaut.
export function readOrder(vaultPath: string): VaultOrder {
  try {
    return JSON.parse(fsSync.readFileSync(getOrderFilePath(vaultPath), 'utf8')) as VaultOrder;
  } catch {
    return {};
  }
}

export async function writeOrder(vaultPath: string, order: VaultOrder): Promise<VaultOrder> {
  const filePath = getOrderFilePath(vaultPath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(order, null, 2), 'utf8');
  return order;
}

//////// 4. État par coffre (state.json) ///////////////////////////////////

export function getStateFilePath(vaultPath: string): string {
  return path.join(vaultPath, '.123ecriture', 'state.json');
}

// État d'UI PAR coffre : « la dernière note ouverte » n'a de sens que dans
// le coffre où elle l'a été, pas globalement — d'où un état stocké DANS le
// coffre (`.123ecriture/state.json`) plutôt qu'une préférence app-level
// (comme fileSortMode) ; « Fichier ouvert par défaut = Dernier ouvert » est
// branché dans Paramètres → Gestion des fichiers et des liens
// (apps/mobile/components/NotesScreen.tsx).
// state.json porte TROIS choses : le dernier fichier ouvert, les dossiers
// repliés de l'explorateur ET les onglets de notes ouverts (les trois sont
// de l'état d'UI PAR coffre, qui voyage avec lui — même logique que
// lastOpened). Un seul objet lu/écrit en read-modify-write : deux
// écrivains indépendants qui réécriraient chacun LEUR champ écraseraient
// celui de l'autre. Même forme minimale que order.json/tasklists.json : un
// petit fichier dédié dans .123ecriture/ plutôt qu'alourdir un fichier
// existant.
type VaultState = {
  lastOpenedRelPath?: string | null;
  collapsedRelPaths?: string[];
  openTabRelPaths?: string[];
};

export function readVaultState(vaultPath: string): VaultState {
  try {
    const data = JSON.parse(fsSync.readFileSync(getStateFilePath(vaultPath), 'utf8')) as VaultState;
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

export async function writeVaultState(vaultPath: string, patch: VaultState): Promise<void> {
  const filePath = getStateFilePath(vaultPath);
  const next = { ...readVaultState(vaultPath), ...patch };
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(next, null, 2), 'utf8');
}

export function readLastOpened(vaultPath: string): string | null {
  return readVaultState(vaultPath).lastOpenedRelPath ?? null;
}

export async function writeLastOpened(vaultPath: string, relPath: string | null): Promise<void> {
  await writeVaultState(vaultPath, { lastOpenedRelPath: relPath });
}

// Dossiers repliés de l'explorateur (relPaths) — persistés pour retrouver
// l'arborescence telle qu'elle était laissée au redémarrage/changement de
// coffre. Les chemins obsolètes (dossier renommé/supprimé depuis) sont
// simplement ignorés au chargement côté renderer, comme dans order.json.
export function readCollapsedRelPaths(vaultPath: string): string[] {
  const collapsed = readVaultState(vaultPath).collapsedRelPaths;
  return Array.isArray(collapsed) ? collapsed.filter((p): p is string => typeof p === 'string') : [];
}

export async function writeCollapsedRelPaths(vaultPath: string, relPaths: string[]): Promise<void> {
  await writeVaultState(vaultPath, { collapsedRelPaths: relPaths });
}

// Onglets de notes ouverts (relPaths, l'ordre = l'ordre des onglets) —
// persistés pour retrouver les onglets tels qu'ils étaient laissés au
// redémarrage/changement de coffre. Les chemins obsolètes (note
// renommée/supprimée depuis) sont filtrés côté renderer à la restauration,
// comme collapsedRelPaths.
export function readOpenTabRelPaths(vaultPath: string): string[] {
  const openTabs = readVaultState(vaultPath).openTabRelPaths;
  return Array.isArray(openTabs) ? openTabs.filter((p): p is string => typeof p === 'string') : [];
}

export async function writeOpenTabRelPaths(vaultPath: string, relPaths: string[]): Promise<void> {
  await writeVaultState(vaultPath, { openTabRelPaths: relPaths });
}

//////// 5. Arborescence ///////////////////////////////////////////////////

// Arborescence complète du vault : dossiers avec leurs enfants, notes en
// feuilles. Tri par défaut : dossiers d'abord puis notes, alphabétique à
// chaque niveau — plus stable pour naviguer qu'un tri par date de
// modification. Si `order` contient une entrée pour ce dossier (voir
// readOrder), elle prime : les enfants qui y figurent sortent dans cet
// ordre-là, ceux qui n'y figurent pas (nouveaux, ou order.json pas encore
// mis à jour) restent à la suite dans leur ordre alphabétique habituel —
// pas besoin de purger les noms obsolètes (renommés/supprimés), ils sont
// simplement ignorés puisqu'introuvables dans `nodes`.
export async function walkTree(dir: string, vaultRoot: string, order: VaultOrder): Promise<VaultTreeNode[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const nodes: VaultTreeNode[] = [];

  for (const entry of entries) {
    // Ignore les dossiers/fichiers cachés (.123ecriture/ config vault,
    // .git...).
    if (entry.name.startsWith('.')) continue;
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      const children = await walkTree(fullPath, vaultRoot, order);
      nodes.push({
        type: 'folder',
        relPath: normalizeRelPath(path.relative(vaultRoot, fullPath)),
        name: entry.name,
        children,
      });
    } else if (entry.isFile() && EXTENSION_TO_KIND[path.extname(entry.name)]) {
      const stat = await fs.stat(fullPath);
      const extension = path.extname(entry.name);
      nodes.push({
        type: 'note',
        relPath: normalizeRelPath(path.relative(vaultRoot, fullPath)),
        name: entry.name.slice(0, -extension.length),
        modifiedAt: stat.mtimeMs,
        kind: EXTENSION_TO_KIND[extension],
      });
    }
  }

  const sortMode = getFileSortMode();
  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
    // "Plus récent d'abord" ne s'applique qu'aux notes (pas de mtime
    // suivi sur les dossiers eux-mêmes) — les dossiers entre eux restent
    // alphabétiques quel que soit le mode, seul un repère stable et
    // prévisible pour naviguer dedans.
    if (sortMode === 'recent' && a.type === 'note' && b.type === 'note') {
      return b.modifiedAt - a.modifiedAt;
    }
    if (sortMode === 'oldest' && a.type === 'note' && b.type === 'note') {
      return a.modifiedAt - b.modifiedAt;
    }
    return a.name.localeCompare(b.name, 'fr');
  });

  // Le tri manuel (glisser-déposer, .123ecriture/order.json) ne s'applique
  // qu'en mode 'manual' — dans les autres modes, un ordre déjà enregistré
  // reste ignoré (pas supprimé : re-choisir 'manual' le restaure tel quel)
  // pour que le mode choisi soit sans ambiguïté.
  if (sortMode === 'manual') {
    const orderKey = path.relative(vaultRoot, dir);
    const savedOrder = order?.[orderKey];
    if (savedOrder && savedOrder.length > 0) {
      const rank = new Map(savedOrder.map((name, index) => [name, index]));
      // Tri stable (garantie ES2019+) : les nœuds absents de `rank` (rang
      // Infinity, tous égaux entre eux) conservent l'ordre déjà établi
      // ci-dessus plutôt que d'être mélangés.
      nodes.sort((a, b) => (rank.get(a.name) ?? Infinity) - (rank.get(b.name) ?? Infinity));
    }
  }

  return nodes;
}
