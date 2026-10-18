// Modèles insérables (v0.4.44, demande « Templates ») — un modèle est une
// note (.md/.mdx) vivant dans un dossier MODÈLES/TEMPLATES (noms fr/en,
// casse ignorée). Les dossiers du coffre de l'utilisatrice suivent cette
// convention (0. ⚙️ BASE/📁 MODÈLES, …/TEMPLATES).


const TEMPLATE_FOLDER = /(^|\/)(mod[eè]les?|templates?)(\/|$)/i;

export function listTemplateNotes(tree: VaultTreeNode[]): VaultNoteNode[] {
  const out: VaultNoteNode[] = [];
  const walk = (items: VaultTreeNode[], inTemplateFolder: boolean): void => {
    for (const item of items) {
      if (item.type === 'folder') {
        walk(item.children ?? [], inTemplateFolder || TEMPLATE_FOLDER.test(item.relPath));
      } else if (inTemplateFolder) {
        out.push(item);
      }
    }
  };
  walk(tree, false);
  return out;
}
