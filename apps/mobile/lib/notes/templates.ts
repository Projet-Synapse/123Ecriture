// ✒️ 123ECRITURE — lib/notes/templates.ts — notes modèles insérables
//////////////////////////////////////////////////////////////////////////////
//
// Un modèle est une note (.md/.mdx) vivant dans un dossier
// MODÈLES/TEMPLATES (noms fr/en, casse ignorée). listTemplateNotes liste
// les modèles disponibles du coffre pour le menu d'insertion.
//
// Invariants du fichier :
//   • La détection est PAR CHEMIN (regexp sur relPath, casse ignorée) et
//     se transmet à toute la sous-arborescence : une note d'un
//     sous-dossier de MODÈLES reste un modèle.
//   • Les dossiers du coffre suivent cette convention (0. ⚙️ BASE/📁
//     MODÈLES, …/TEMPLATES) — aucun réglage supplémentaire à prévoir.
//
// SOMMAIRE :
//   1. listTemplateNotes — listing des notes modèles
//
//////////////////////////////////////////////////////////////////////////////

//////// 1. listTemplateNotes — listing des notes modèles ////////////////////

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
