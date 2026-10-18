// ✒️ 123ECRITURE — lib/notes/treeExpansion.ts — chemins de dossiers d'un arbre de coffre
//////////////////////////////////////////////////////////////////////////////
//
// Collecte des chemins de dossiers d'un arbre de coffre — logique extraite
// de NotesScreen.tsx pour être testée unitairement.
//
// Invariants du fichier :
//   • Fonction pure : l'arbre entre, la liste de relPaths sort — aucune
//     dépendance à React ni au DOM.
//   • TOUS les dossiers figurent dans le résultat, imbriqués compris :
//     consommé par le mode d'ouverture « Tous fermés » de l'explorateur
//     (préférence `explorerExpandMode`, voir NotesScreen.tsx) — replier
//     chaque dossier rend l'arbre entièrement replié, seuls les dossiers
//     de premier niveau restent visibles.
//
// SOMMAIRE :
//   1. collectFolderRelPaths — tous les relPaths de dossiers
//
//////////////////////////////////////////////////////////////////////////////

//////// 1. collectFolderRelPaths — tous les relPaths de dossiers ////////////

export function collectFolderRelPaths(nodes: VaultTreeNode[]): string[] {
  const paths: string[] = [];
  const walk = (list: VaultTreeNode[]) => {
    for (const node of list) {
      if (node.type === 'folder') {
        paths.push(node.relPath);
        if (node.children.length > 0) walk(node.children);
      }
    }
  };
  walk(nodes);
  return paths;
}
