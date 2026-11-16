// ✒️ 123ECRITURE — lib/notes/renameTarget.ts — renommage avec changement de format
//////////////////////////////////////////////////////////////////////////////
//
// Logique PURE (testée, voir renameTarget.test.ts) du renommage d'un
// élément de l'explorateur, partagée par TOUS les adaptateurs : desktop
// (apps/desktop/electron/ponts-desktop/vault.ts, `vault:rename`), web
// (webVaultAdapter.ts), Android SAF (nativeVaultAdapter.ts), Android
// natif (nativeVaultFsAdapter.ts) et cloud (cloudVaultCore.ts).
//
// Invariants du fichier :
//   • Le nom saisi l'emporte : s'il se termine par une extension de note
//     connue (.md / .mdx), c'est CELLE-LÀ qui est utilisée — jamais
//     « Note.mdx.md » ni « Note.md.mdx ». Sans extension connue, l'extension
//     réelle de l'ancien fichier est conservée (comportement historique).
//   • Seuls .md ⇄ .mdx se convertissent ; changer une note en .canvas,
//     .chart… (ou l'inverse) est refusé avec un message clair plutôt que de
//     produire un fichier illisible. Les fichiers code (.py, .ts…) peuvent
//     changer d'extension entre eux (texte brut, rien à convertir).
//   • Conversion md → mdx : seul ce qui casserait la compilation MDX est
//     échappé (accolades, chevrons isolés, commentaires HTML, liens
//     automatiques, balises vides non fermées) — HORS blocs et spans de
//     code. mdx → md : rien ne change, sauf les commentaires MDX
//     `{/* … */}` redevenus `<!-- … -->`. Le frontmatter est conservé
//     OCTET POUR OCTET dans les deux sens.
//
// SOMMAIRE :
//   1. Nom final — resolveRenameName, formatConversionBetween
//   2. Conversion du contenu — convertNoteFormat
//   3. Chemins mémorisés (favoris) — remapPathsAfterRename
//
//////////////////////////////////////////////////////////////////////////////

import { CODE_FILE_EXTENSIONS } from '../editor/codeLanguages';

//////// 1. Nom final — resolveRenameName, formatConversionBetween /////////

export type NoteFormatExt = '.md' | '.mdx';
export type FormatConversion = { from: NoteFormatExt; to: NoteFormatExt };

export const NOTE_FORMAT_EXTS: readonly NoteFormatExt[] = ['.mdx', '.md'];
const OTHER_CONTENT_EXTS = ['.canvas', '.chart', '.excalidraw', '.base'];

// Plus longue d'abord : `.mdx` doit être testé avant `.md`.
function knownExts(): string[] {
  return [...NOTE_FORMAT_EXTS, ...OTHER_CONTENT_EXTS, ...CODE_FILE_EXTENSIONS].sort((a, b) => b.length - a.length);
}

export function knownExtensionOf(name: string): string | null {
  const lower = name.toLowerCase();
  return knownExts().find((ext) => lower.endsWith(ext) && lower.length > ext.length) ?? null;
}

function isNoteFormat(ext: string | null): ext is NoteFormatExt {
  return ext !== null && (NOTE_FORMAT_EXTS as readonly string[]).includes(ext.toLowerCase());
}

function isCodeExt(ext: string | null): boolean {
  return ext !== null && CODE_FILE_EXTENSIONS.includes(ext.toLowerCase());
}

// Extension « réelle » (comme path.extname) : utilisée quand l'ancien nom
// ne porte aucune extension connue (pièce jointe, fichier inconnu).
function rawExtensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot) : '';
}

export class RenameFormatError extends Error {}

export type RenameResolution = {
  // Nom complet sur le disque (avec extension).
  finalName: string;
  // Nom affiché (sans extension pour un fichier).
  displayName: string;
  // Conversion de contenu à appliquer après le déplacement (null : aucune).
  conversion: FormatConversion | null;
};

export function resolveRenameName(oldName: string, typedName: string, options: { isDirectory: boolean }): RenameResolution {
  // Un nom ne contient jamais de séparateur : un renommage reste un
  // renommage, pas un déplacement déguisé.
  const trimmed = (typedName ?? '').trim().replace(/[/\\]/g, '');
  if (!trimmed) throw new Error('Le nom ne peut pas être vide.');
  if (options.isDirectory) return { finalName: trimmed, displayName: trimmed, conversion: null };

  const oldKnown = knownExtensionOf(oldName);
  const oldExt = oldKnown ? oldName.slice(oldName.length - oldKnown.length) : rawExtensionOf(oldName);
  const typedKnown = knownExtensionOf(trimmed);

  // 1. Le nom saisi porte déjà l'extension actuelle (casse ignorée).
  if (oldExt && trimmed.toLowerCase().endsWith(oldExt.toLowerCase()) && trimmed.length > oldExt.length) {
    const base = trimmed.slice(0, trimmed.length - oldExt.length);
    return { finalName: `${base}${oldExt}`, displayName: base, conversion: null };
  }

  // 2. Le nom saisi porte une AUTRE extension connue.
  if (typedKnown) {
    const base = trimmed.slice(0, trimmed.length - typedKnown.length);
    if (isNoteFormat(oldKnown) && isNoteFormat(typedKnown)) {
      const to = typedKnown.toLowerCase() as NoteFormatExt;
      return {
        finalName: `${base}${to}`,
        displayName: base,
        conversion: { from: oldKnown.toLowerCase() as NoteFormatExt, to },
      };
    }
    if (isCodeExt(oldKnown) && isCodeExt(typedKnown)) {
      return { finalName: trimmed, displayName: base, conversion: null };
    }
    if (oldKnown) {
      throw new RenameFormatError(
        `Impossible de convertir « ${oldKnown} » en « ${typedKnown.toLowerCase()} » : seules les notes .md et .mdx se convertissent l'une en l'autre.`,
      );
    }
  }

  // 3. Pas d'extension connue saisie : l'extension réelle est conservée.
  return { finalName: `${trimmed}${oldExt}`, displayName: trimmed, conversion: null };
}

// Conversion impliquée par un changement de chemin (null : même format).
export function formatConversionBetween(oldRelPath: string, newRelPath: string): FormatConversion | null {
  const from = knownExtensionOf(oldRelPath)?.toLowerCase() ?? null;
  const to = knownExtensionOf(newRelPath)?.toLowerCase() ?? null;
  if (!isNoteFormat(from) || !isNoteFormat(to) || from === to) return null;
  return { from, to };
}

// Le renommage de `relPath` en `typedName` changera-t-il le format ?
// (Pré-vérification côté interface ; un nom refusé renvoie false — c'est
// l'adaptateur qui lèvera l'erreur.)
export function willConvertFormat(relPath: string, typedName: string): boolean {
  const name = relPath.slice(relPath.lastIndexOf('/') + 1);
  if (!knownExtensionOf(name)) return false;
  try {
    return resolveRenameName(name, typedName, { isDirectory: false }).conversion !== null;
  } catch {
    return false;
  }
}

//////// 2. Conversion du contenu — convertNoteFormat ////////////////////////

// Frontmatter YAML en tête (`---` … `---`/`...`), renvoyé TEL QUEL, fin de
// ligne comprise ; le reste est le corps converti.
export function splitRawFrontmatter(content: string): { frontmatter: string; body: string } {
  const bom = content.startsWith('\uFEFF') ? '\uFEFF' : '';
  const text = content.slice(bom.length);
  const opening = /^---[ \t]*\r?\n/.exec(text);
  if (!opening) return { frontmatter: '', body: content };
  const closing = /^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/m;
  const rest = text.slice(opening[0].length);
  const match = closing.exec(rest);
  if (!match) return { frontmatter: '', body: content };
  const end = bom.length + opening[0].length + match.index + match[0].length;
  return { frontmatter: content.slice(0, end), body: content.slice(end) };
}

const VOID_TAGS = 'area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr';
const FENCE = /^( {0,3})(`{3,}|~{3,})/;

// Applique `transform` au texte HORS code (blocs clôturés et spans `…`).
function mapOutsideCode(body: string, transform: (text: string) => string): string {
  const lines = body.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const out: string[] = [];
  let fence: string | null = null;
  let buffer = '';
  const flush = () => {
    if (buffer) out.push(mapOutsideInlineCode(buffer, transform));
    buffer = '';
  };
  for (const line of lines) {
    const match = FENCE.exec(line);
    if (fence) {
      out.push(line);
      if (match && match[2][0] === fence[0] && match[2].length >= fence.length && line.trim() === match[2]) fence = null;
      continue;
    }
    if (match) {
      flush();
      fence = match[2];
      out.push(line);
      continue;
    }
    buffer += line;
  }
  flush();
  return out.join('');
}

// Span de code CommonMark : une suite de n accents graves, un contenu, puis
// une suite d'EXACTEMENT n accents graves (jamais au-delà d'une ligne vide).
// Balayage manuel : pas d'assertion arrière dans les regex (moteur Hermes).
function mapOutsideInlineCode(text: string, transform: (text: string) => string): string {
  let result = '';
  let plainStart = 0;
  let i = 0;
  while (i < text.length) {
    if (text[i] !== '`') {
      i += 1;
      continue;
    }
    let runEnd = i;
    while (text[runEnd] === '`') runEnd += 1;
    const size = runEnd - i;
    let j = runEnd;
    let closeAt = -1;
    while (j < text.length) {
      if (text[j] === '\n' && /^\n[ \t]*\n/.test(text.slice(j))) break;
      if (text[j] !== '`') {
        j += 1;
        continue;
      }
      let k = j;
      while (text[k] === '`') k += 1;
      if (k - j === size) {
        closeAt = k;
        break;
      }
      j = k;
    }
    if (closeAt === -1) {
      i = runEnd;
      continue;
    }
    result += transform(text.slice(plainStart, i)) + text.slice(i, closeAt);
    plainStart = closeAt;
    i = closeAt;
  }
  return result + transform(text.slice(plainStart));
}

// Échappe accolades et chevrons isolés, sans toucher à ce qui est déjà
// échappé (`\{` reste `\{`).
function escapeForMdx(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '\\') {
      out += ch + (text[i + 1] ?? '');
      i += 1;
    } else if (ch === '{' || ch === '}') out += `\\${ch}`;
    else if (ch === '<' && !/[A-Za-z/>]/.test(text[i + 1] ?? '')) out += '\\<';
    else out += ch;
  }
  return out;
}

function markdownToMdx(text: string): string {
  // Commentaires HTML → commentaires MDX (multi-lignes compris).
  const comments: string[] = [];
  let working = text.replace(/<!--([\s\S]*?)-->/g, (_all, inner: string) => {
    comments.push(`{/*${inner.replace(/\*\//g, '* /')}*/}`);
    return `\uE000${comments.length - 1}\uE000`;
  });
  // Liens automatiques <https://…> / <a@b.c> → liens Markdown.
  working = working.replace(/<((?:https?|ftp|mailto):[^\s<>]+)>/gi, (_all, url: string) => `[${url}](${url})`);
  working = working.replace(/<([^\s<>@]+@[^\s<>@]+\.[^\s<>@]+)>/g, (_all, mail: string) => `[${mail}](mailto:${mail})`);
  // Balises vides HTML non fermées (<br>, <img …>) → auto-fermantes.
  working = working.replace(new RegExp(`<(${VOID_TAGS})\\b([^<>]*)>`, 'gi'), (all, tag: string, attrs: string) => {
    const trimmed = attrs.replace(/\s+$/, '');
    return trimmed.endsWith('/') ? all : `<${tag}${trimmed} />`;
  });
  // Accolades (expressions JS en MDX) et chevron qui n'ouvre pas une
  // balise (ni lettre, ni `/`, ni `>`) — sauf déjà échappés.
  working = escapeForMdx(working);
  return working.replace(/\uE000(\d+)\uE000/g, (_all, i: string) => comments[Number(i)]);
}

function mdxToMarkdown(text: string): string {
  return text.replace(/\{\/\*([\s\S]*?)\*\/\}/g, (_all, inner: string) => `<!--${inner.replace(/--/g, '- -')}-->`);
}

export function convertNoteFormat(content: string, conversion: FormatConversion): string {
  if (conversion.from === conversion.to) return content;
  const { frontmatter, body } = splitRawFrontmatter(content);
  const transform = conversion.to === '.mdx' ? markdownToMdx : mdxToMarkdown;
  return frontmatter + mapOutsideCode(body, transform);
}

//////// 3. Chemins mémorisés (favoris) — remapPathsAfterRename //////////////

// Réécrit les chemins touchés par un renommage/déplacement : l'élément
// lui-même ET tout ce qu'un dossier renommé contient. Même liste renvoyée
// si rien ne change (stabilité de référence pour React).
export function remapPathsAfterRename(paths: string[], oldRelPath: string, newRelPath: string): string[] {
  if (oldRelPath === newRelPath) return paths;
  let changed = false;
  const next = paths.map((p) => {
    if (p === oldRelPath) {
      changed = true;
      return newRelPath;
    }
    if (p.startsWith(`${oldRelPath}/`)) {
      changed = true;
      return `${newRelPath}${p.slice(oldRelPath.length)}`;
    }
    return p;
  });
  return changed ? next : paths;
}
