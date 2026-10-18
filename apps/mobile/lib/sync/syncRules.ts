//////////
// ✒️ 123ECRITURE — syncRules.ts
// RÈGLES DE SYNCHRONISATION PARTAGÉES (desktop + mobile) : ce qui est haché
//////////

// INTRODUCTION — Source UNIQUE des règles « qu'est-ce qui entre dans la
// synchronisation », consommée par LES DEUX marcheurs : le pont desktop
// (apps/desktop/electron/sync.ts — fs Node) et le pont mobile
// (lib/storage/nativeSyncAdapter.ts — fichiers ordinaires Android). Avant
// cette extraction, les règles étaient dupliquées de part et d'autre avec
// des divergences (les fichiers code dans .trash n'étaient hachés que d'un
// côté ; la liste blanche des métadonnées était du code mort côté desktop) —
// c'est exactement l'écart qui entretient des boucles de sync. Pur :
// aucune dépendance de plateforme (codeLanguages est déjà partagé).
//
// RÈGLES :
//   - un nom contenant un `\` n'est JAMAIS haché (résidus de contamination
//     — légal dans un nom Android, jamais dans un arbre) ;
//   - SYNCED_META_FILES : liste blanche de métadonnées .123ecriture/** qui
//     VOYAGENT avec le coffre (le reste du sous-arbre caché reste local) ;
//   - un segment caché exclut le fichier — SAUF `.trash/` (corbeille du
//     coffre, synchronisée) et SAUF la liste blanche ci-dessus ;
//   - extensions : contenu (.mdx/.md/.canvas/.chart/.excalidraw/.base +
//     fichiers code, même source CODE_FILE_EXTENSIONS que l'arborescence)
//     et pièces jointes (images/documents/audio).
//
// SOMMAIRE :
//   1. 📇 Listes partagées
//   2. ⚖️ La règle unique (isHashableRelPath)

import { CODE_FILE_EXTENSIONS } from '../editor/codeLanguages';

//////// 1. 📇 LISTES PARTAGÉES ///////////

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

export const SYNC_CONTENT_EXTENSIONS = [
  '.mdx', '.md', '.canvas', '.chart', '.excalidraw', '.base',
  ...CODE_FILE_EXTENSIONS,
];

//////// 2. ⚖️ LA RÈGLE UNIQUE (isHashableRelPath) ///////////

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
  const isTrash = segments[0] === '.trash';
  const hasHiddenSegment = segments.some((segment) => segment.startsWith('.'));
  if (hasHiddenSegment && !isTrash) return false;
  return true;
}
