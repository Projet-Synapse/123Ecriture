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
//   • Un segment caché exclut le fichier — la corbeille `.trash/` incluse
//     (elle reste locale, voir isHashableRelPath) ; extensions de
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
  // LA CORBEILLE RESTE LOCALE (comme Obsidian) : .trash/** n'est ni poussé
  // ni tiré — la suppression elle-même voyage par la tombstone, la corbeille
  // d'un appareil n'a pas à voyager. Vécu 20-21/10 : 718 lignes .trash
  // re-poussées au cloud cycle après cycle par le hachage des corbeilles.
  if (segments0IsTrash(relPath)) return false;
  if (SYNCED_META_FILES.includes(relPath)) return true;
  const segments = relPath.split('/');
  const name = segments[segments.length - 1].toLowerCase();
  const extension = name.slice(name.lastIndexOf('.'));
  const isAttachment = SYNC_ATTACHMENT_EXTENSIONS.includes(extension);
  const isContent = SYNC_CONTENT_EXTENSIONS.includes(extension);
  if (!isAttachment && !isContent) return false;
  const hasHiddenSegment = segments.some((segment) => segment.startsWith('.'));
  if (hasHiddenSegment) return false;
  return true;
}

function segments0IsTrash(relPath: string): boolean {
  return relPath === '.trash' || relPath.startsWith('.trash/');
}
