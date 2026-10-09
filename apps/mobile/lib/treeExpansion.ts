// Collecte des chemins de dossiers d'un arbre de coffre — logique extraite
// de NotesScreen.tsx pour être testée unitairement.

// Tous les relPaths de dossiers (dossiers imbriqués compris) — consommé par
// le mode d'ouverture « Tous fermés » de l'explorateur (préférence
// `explorerExpandMode`, voir NotesScreen.tsx) : replier chaque dossier
// rend l'arbre entièrement replié, seuls les dossiers de premier niveau
// restent visibles.
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
