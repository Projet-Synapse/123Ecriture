// ✒️ 123ECRITURE — lib/notes/noteTitle.ts — où s'affiche le titre d'une note
//////////////////////////////////////////////////////////////////////////////
//
// Comme Obsidian : le titre d'une note markdown fait partie de l'ÉDITEUR
// (premier élément du contenu défilant, au-dessus des propriétés et du
// texte) ; les fichiers sans contenu défilant équivalent (canvas,
// graphiques, dessins, code) gardent le titre dans l'en-tête.
//
// Invariants du fichier :
//   • Le titre EST le nom du fichier sans extension — jamais une propriété
//     `title` du frontmatter. Le modifier = renommer le fichier.
//
//////////////////////////////////////////////////////////////////////////////

export type TitlePlacement = 'content' | 'header';

export function noteTitlePlacement(kind: VaultEntryKind): TitlePlacement {
  return kind === 'markdown' ? 'content' : 'header';
}
