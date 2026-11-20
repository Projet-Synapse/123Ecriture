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
//   3. Règles chemin → template (templateForNewFile, matchingTemplateRules)
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

//////// 3. Règles chemin → template ////////////////////////////////////////

// Règles « chemin → template » (Paramètres → Templates, v0.4.100) : un
// dossier du coffre (sous-dossiers compris ; '' = tout le coffre) et le
// fichier template à appliquer aux nouveaux fichiers créés dessous.
export type TemplateRule = { folder: string; template: string };

function cleanPath(p: string): string {
  return p.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

// Lecture TOLÉRANTE du réglage (préférences d'une autre version, saisie à
// moitié faite) : entrées invalides écartées, chemins normalisés.
export function normalizeTemplateRules(raw: unknown): TemplateRule[] {
  if (!Array.isArray(raw)) return [];
  const out: TemplateRule[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const { folder, template } = item as { folder?: unknown; template?: unknown };
    if (typeof folder !== 'string' || typeof template !== 'string') continue;
    out.push({ folder: cleanPath(folder), template: cleanPath(template) });
  }
  return out;
}

// Le fichier `relPath` est-il dans `folder` (ou dessous) ? Casse ignorée,
// limite de segment respectée (`Notes` ne couvre pas `Notes-old`).
function isInside(relPath: string, folder: string): boolean {
  if (!folder) return true;
  const a = relPath.toLowerCase();
  const f = folder.toLowerCase();
  return a.startsWith(`${f}/`);
}

// Règles applicables à `newRelPath`, de la PLUS spécifique (dossier le plus
// profond) à la moins spécifique ; à profondeur égale, l'ordre de la liste.
export function matchingTemplateRules(newRelPath: string, rules: TemplateRule[]): TemplateRule[] {
  const path = cleanPath(newRelPath);
  const depth = (folder: string) => (folder ? folder.split('/').length : 0);
  return rules
    .map((rule, index) => ({ rule, index }))
    .filter(({ rule }) => rule.template && isInside(path, cleanPath(rule.folder)))
    .sort((a, b) => depth(cleanPath(b.rule.folder)) - depth(cleanPath(a.rule.folder)) || a.index - b.index)
    .map(({ rule }) => rule);
}

// Template à appliquer à un NOUVEAU fichier : seulement une note Markdown ;
// la règle de chemin la plus spécifique dont le template EXISTE encore,
// sinon le template par défaut (s'il existe), sinon aucun. Jamais pour un
// fichier créé parmi les templates eux-mêmes (créer un template ne doit pas
// le pré-remplir avec un autre).
export function templateForNewFile(args: {
  newRelPath: string;
  kind: string | undefined;
  rules: TemplateRule[];
  defaultTemplate: string | undefined;
  existingNotes: Iterable<string>;
  templateNotes: VaultNoteNode[];
}): string | null {
  if (args.kind && args.kind !== 'markdown') return null;
  if (args.templateNotes.some((t) => t.relPath === args.newRelPath)) return null;
  const existing = new Set(args.existingNotes);
  for (const rule of matchingTemplateRules(args.newRelPath, args.rules)) {
    if (existing.has(rule.template)) return rule.template;
  }
  const fallback = args.defaultTemplate?.trim();
  return fallback && existing.has(fallback) ? fallback : null;
}

// Templates proposés par « 📋 Insérer un modèle » : ceux du dossier des
// templates (ou détectés) + ceux désignés par les règles et le défaut.
export function insertableTemplates(
  tree: VaultTreeNode[],
  folder: string | undefined,
  referenced: string[],
): VaultNoteNode[] {
  const out = listTemplateNotes(tree, folder);
  const seen = new Set(out.map((n) => n.relPath));
  const wanted = new Set(referenced.filter((p) => p && !seen.has(p)));
  if (wanted.size === 0) return out;
  const walk = (items: VaultTreeNode[]) => {
    for (const item of items) {
      if (item.type === 'folder') walk(item.children ?? []);
      else if (wanted.has(item.relPath)) {
        out.push(item);
        wanted.delete(item.relPath);
      }
    }
  };
  walk(tree);
  return out;
}
