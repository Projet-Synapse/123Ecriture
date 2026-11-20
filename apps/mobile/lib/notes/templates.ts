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
// Paramètres → Templates (v0.4.99) : dossier des modèles explicite
// (vide = détection automatique ci-dessus) et modèle par défaut appliqué
// aux nouveaux fichiers, avec les variables {{title}}, {{date}}, {{time}}
// (formats {{date:YYYY-MM-DD}}, {{time:HH:mm}}) — mêmes noms qu'Obsidian.
//
// SOMMAIRE :
//   1. listTemplateNotes — listing des notes modèles
//   2. renderTemplate — variables
//   3. defaultTemplateFor — modèle par défaut d'un nouveau fichier
//
//////////////////////////////////////////////////////////////////////////////

//////// 1. listTemplateNotes — listing des notes modèles ////////////////////

// Le nom du dossier peut être précédé d'un emoji / d'une puce (« 📁
// MODÈLES ») — avant, ce cas, pourtant la convention du coffre, n'était
// pas reconnu.
const TEMPLATE_FOLDER = /(^|\/)[^/\p{L}\p{N}]*(mod[eè]les?|templates?)\s*(\/|$)/iu;

// `folder` : dossier choisi dans Paramètres → Templates ('' ou absent =
// détection automatique MODÈLES/TEMPLATES). Seules les notes (.md/.mdx)
// sont des modèles.
export function listTemplateNotes(tree: VaultTreeNode[], folder?: string): VaultNoteNode[] {
  const chosen = normalizeFolder(folder);
  const isTemplateFolder = (relPath: string) =>
    chosen ? relPath.toLowerCase() === chosen.toLowerCase() : TEMPLATE_FOLDER.test(relPath);
  const out: VaultNoteNode[] = [];
  const walk = (items: VaultTreeNode[], inTemplateFolder: boolean): void => {
    for (const item of items) {
      if (item.type === 'folder') {
        walk(item.children ?? [], inTemplateFolder || isTemplateFolder(item.relPath));
      } else if (inTemplateFolder && (item.kind === 'markdown' || /\.mdx?$/i.test(item.relPath))) {
        out.push(item);
      }
    }
  };
  walk(tree, false);
  return out;
}

function normalizeFolder(folder?: string): string {
  return (folder ?? '').trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

//////// 2. renderTemplate — variables ////////////////////////////////////////

const pad = (n: number) => String(n).padStart(2, '0');
function formatDate(date: Date, format: string): string {
  return format.replace(/YYYY|MM|DD|HH|mm|ss/g, (token) => {
    switch (token) {
      case 'YYYY':
        return String(date.getFullYear());
      case 'MM':
        return pad(date.getMonth() + 1);
      case 'DD':
        return pad(date.getDate());
      case 'HH':
        return pad(date.getHours());
      case 'mm':
        return pad(date.getMinutes());
      default:
        return pad(date.getSeconds());
    }
  });
}

// {{title}} → nom de la note (sans extension) ; {{date}} → AAAA-MM-JJ ;
// {{time}} → HH:mm ; {{date:FORMAT}} / {{time:FORMAT}} (YYYY MM DD HH mm
// ss). Espaces tolérés ({{ title }}), casse ignorée. Le reste est intact.
export function renderTemplate(template: string, vars: { title: string; now?: Date }): string {
  const now = vars.now ?? new Date();
  return template.replace(/\{\{\s*(title|date|time)\s*(?::\s*([^}]*?))?\s*\}\}/gi, (_m, name: string, format?: string) => {
    const key = name.toLowerCase();
    if (key === 'title') return vars.title;
    if (key === 'date') return formatDate(now, format?.trim() || 'YYYY-MM-DD');
    return formatDate(now, format?.trim() || 'HH:mm');
  });
}

//////// 3. defaultTemplateFor — modèle par défaut d'un nouveau fichier ///////

// Modèle à appliquer à un NOUVEAU fichier : seulement une note Markdown,
// seulement si le réglage désigne un modèle qui existe encore, jamais un
// fichier créé DANS le dossier des modèles (créer un modèle ne doit pas le
// pré-remplir avec un autre).
export function defaultTemplateFor(args: {
  templateRelPath: string | undefined;
  newRelPath: string;
  kind: string | undefined;
  templates: VaultNoteNode[];
}): string | null {
  const wanted = args.templateRelPath?.trim();
  if (!wanted) return null;
  if (args.kind && args.kind !== 'markdown') return null;
  if (!args.templates.some((t) => t.relPath === wanted)) return null;
  if (args.templates.some((t) => t.relPath === args.newRelPath)) return null;
  return wanted;
}
