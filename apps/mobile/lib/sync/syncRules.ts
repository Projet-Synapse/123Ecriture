// ✒️ 123ECRITURE — lib/sync/syncRules.ts — règles de synchronisation partagées (desktop + mobile)
//////////////////////////////////////////////////////////////////////////////
//
// Source UNIQUE de la règle « qu'est-ce qui entre dans la
// synchronisation », consommée par LES DEUX marcheurs : le pont desktop
// (apps/desktop/electron/sync.ts — fs Node) et le pont mobile
// (lib/storage/nativeSyncAdapter.ts — fichiers ordinaires Android). Des
// règles dupliquées de part et d'autre divergent fatalement (fichiers code
// dans .trash hachés d'un seul côté, liste blanche des métadonnées morte
// côté desktop) — c'est exactement l'écart qui entretient des boucles de
// synchronisation.
//
// Invariants du fichier :
//   • Toute évolution de la règle se fait ICI, jamais dans une liste
//     locale d'un marcheur — les tests de parité verrouillent l'égalité
//     des deux côtés.
//   • Un nom contenant un `\` n'est JAMAIS haché (résidus de contamination
//     — légal dans un nom Android, jamais dans un arbre).
//   • SYNCED_META_FILES : liste blanche de métadonnées .123ecriture/**
//     qui VOYAGENT avec le coffre (le reste du sous-arbre caché reste
//     local).
//   • Un segment caché exclut le fichier — SAUF `.trash/` (corbeille du
//     coffre, synchronisée) et SAUF la liste blanche ; extensions de
//     contenu (même source CODE_FILE_EXTENSIONS que l'arborescence) et
//     pièces jointes (images/documents/audio) incluses.
//
// SOMMAIRE :
//   1. Les listes partagées (métadonnées voyageantes, extensions)
//   2. La règle unique (isHashableRelPath)
//
//////////////////////////////////////////////////////////////////////////////

//////// 1. Les listes partagées (métadonnées voyageantes, extensions) ///////////

import { CODE_FILE_EXTENSIONS } from '../editor/codeLanguages';

export const SYNCED_META_FILES = [
  '.123ecriture/appearance.json',
  '.123ecriture/tasks.json',
  '.123ecriture/tasklists.json',
  '.123ecriture/events.json',
  '.123ecriture/preferences.json',
];

export const SYNC_ATTACHMENT_EXTENSIONS = [
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.heic',
  '.pdf', '.txt', '.csv',
  '.mp3', '.wav', '.ogg', '.m4a', '.mp4', '.webm',
];

// Les extensions de contenu partagent la même source CODE_FILE_EXTENSIONS
// que l'arborescence de l'éditeur : un fichier affiché dans l'app est
// toujours un fichier synchronisable, et réciproquement.
export const SYNC_CONTENT_EXTENSIONS = [
  '.mdx', '.md', '.canvas', '.chart', '.excalidraw', '.base',
  ...CODE_FILE_EXTENSIONS,
];

//////// 2. La règle unique (isHashableRelPath) ///////////

export function isHashableRelPath(relPath: string): boolean {
  // Résidus de contamination (le `\` est légal dans un nom Android, pas
  // dans un arbre) : jamais hachés, jamais poussés, purge manuelle.
  if (relPath.includes('\\')) return false;
  if (SYNCED_META_FILES.includes(relPath)) return true;
  const segments = relPath.split('/');
  const name = segments[segments.length - 1].toLowerCase();
  const extension = name.slice(name.lastIndexOf('.'));
  const isAttachment = SYNC_ATTACHMENT_EXTENSIONS.includes(extension);
  const isContent = SYNC_CONTENT_EXTENSIONS.includes(extension);
  if (!isAttachment && !isContent) return false;
  // `.trash/` n'est PLUS synchronisé : la corbeille reste locale à chaque
  // appareil (mettre à la corbeille = suppression propagée normalement).
  if (segments.some((segment) => segment.startsWith('.'))) return false;
  return true;
}

//////// 3. La surveillance desktop (shouldWatchTrigger) ///////////

// Un événement du watcher desktop (chemin relatif, séparateurs `/` ou `\`)
// doit-il déclencher un cycle ? Contenu visible et `.trash/` : oui. Dans
// `.123ecriture/`, SEULES les métadonnées synchronisées (SYNCED_META_FILES :
// tâches, listes, préférences, apparence) — jamais sync-journal, sync-state,
// bases/, devices/, *.conflict-*.json : ce sont des écritures du moteur, les
// laisser passer relancerait la synchro en boucle. Autres dossiers cachés :
// non.
export function shouldWatchTrigger(filename: string): boolean {
  const rel = filename.split('\\').join('/').replace(/^\/+/, '');
  if (!rel) return false;
  if (SYNCED_META_FILES.includes(rel)) return true;
  const parts = rel.split('/');
  if (parts[0] === '.trash') return true;
  return !parts.some((p) => p.startsWith('.'));
}
