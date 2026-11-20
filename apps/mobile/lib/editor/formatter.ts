// ✒️ 123ECRITURE — lib/editor/formatter.ts — formatage automatique (façon Linter d'Obsidian)
//////////////////////////////////////////////////////////////////////////////
//
// Paramètres → Formatage (v0.4.100) : règles de mise en forme activables
// + règles personnalisées par expression régulière. Appliqué par la
// commande « ✨ Formater le fichier » (barre d'outils, menu ⋯) et, en
// option, à l'enregistrement manuel (Ctrl+S).
//
// Invariants du fichier :
//   • Module PUR (aucun import React/RN) : partagé desktop / Android,
//     testé dans formatter.test.ts.
//   • Le frontmatter (bloc `---` en tête) et le CODE (blocs ``` / ~~~ et
//     `code` en ligne) ne sont JAMAIS modifiés, sauf option explicite.
//     Liens [[…]], cibles de liens Markdown, URL et balises HTML sont
//     aussi protégés des règles de texte.
//   • Une regex personnalisée invalide est SIGNALÉE (errors) et ignorée —
//     jamais d'exception.
//   • Idempotent : formater deux fois donne le même texte.
//
// SOMMAIRE :
//   1. Réglages et règles intégrées
//   2. Protection (frontmatter, code, liens)
//   3. formatMarkdown
//   4. Règles personnalisées (compilation, test sur un exemple)
//
//////////////////////////////////////////////////////////////////////////////

//////// 1. Réglages et règles intégrées /////////////////////////////////////

export type FormattingRuleId =
  | 'trailingSpaces'
  | 'multipleBlankLines'
  | 'headingSpace'
  | 'finalNewline'
  | 'frenchPunctuation'
  | 'frenchQuotes'
  | 'ellipsis';

export type CustomFormattingRule = {
  id: string;
  name: string;
  pattern: string;
  replacement: string;
  flags: string;
  enabled: boolean;
};

export type FormattingSettings = {
  rules: Partial<Record<FormattingRuleId, boolean>>;
  customRules: CustomFormattingRule[];
  formatOnSave: boolean;
  includeFrontmatter: boolean;
  includeCode: boolean;
};

export const FORMATTING_RULES: { id: FormattingRuleId; label: string; hint: string; defaultOn: boolean }[] = [
  { id: 'trailingSpaces', label: 'Espaces en fin de ligne', hint: 'Supprime les espaces et tabulations en fin de ligne.', defaultOn: true },
  { id: 'multipleBlankLines', label: 'Lignes vides multiples', hint: 'Plusieurs lignes vides d’affilée → une seule.', defaultOn: true },
  { id: 'headingSpace', label: 'Espace après # des titres', hint: '« ##Titre » → « ## Titre » (titres de niveau 2 à 6 ; « #mot » reste un tag).', defaultOn: true },
  { id: 'finalNewline', label: 'Saut de ligne final', hint: 'Le fichier se termine par exactement un saut de ligne.', defaultOn: true },
  { id: 'frenchPunctuation', label: 'Espaces insécables (; : ! ? « »)', hint: 'Espace fine insécable avant ; ! ? et à l’intérieur de « », insécable avant :.', defaultOn: false },
  { id: 'frenchQuotes', label: 'Guillemets français', hint: '"texte" → « texte ».', defaultOn: false },
  { id: 'ellipsis', label: 'Points de suspension', hint: '... → …', defaultOn: false },
];

export const DEFAULT_FORMATTING: FormattingSettings = {
  rules: Object.fromEntries(FORMATTING_RULES.map((r) => [r.id, r.defaultOn])),
  customRules: [],
  formatOnSave: false,
  includeFrontmatter: false,
  includeCode: false,
};

// Lecture tolérante des préférences (version précédente, saisie partielle).
export function normalizeFormattingSettings(raw: unknown): FormattingSettings {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Partial<FormattingSettings>;
  const rules: Partial<Record<FormattingRuleId, boolean>> = { ...DEFAULT_FORMATTING.rules };
  if (value.rules && typeof value.rules === 'object') {
    for (const r of FORMATTING_RULES) {
      const v = (value.rules as Record<string, unknown>)[r.id];
      if (typeof v === 'boolean') rules[r.id] = v;
    }
  }
  const customRules = Array.isArray(value.customRules)
    ? value.customRules
        .filter((c): c is CustomFormattingRule => !!c && typeof c === 'object' && typeof (c as CustomFormattingRule).pattern === 'string')
        .map((c, i) => ({
          id: typeof c.id === 'string' && c.id ? c.id : `regle-${i + 1}`,
          name: typeof c.name === 'string' ? c.name : '',
          pattern: c.pattern,
          replacement: typeof c.replacement === 'string' ? c.replacement : '',
          flags: typeof c.flags === 'string' ? c.flags : 'g',
          enabled: c.enabled !== false,
        }))
    : [];
  return {
    rules,
    customRules,
    formatOnSave: value.formatOnSave === true,
    includeFrontmatter: value.includeFrontmatter === true,
    includeCode: value.includeCode === true,
  };
}

//////// 2. Protection (frontmatter, code, liens) ////////////////////////////

const FRONTMATTER = /^(\uFEFF?)---[ \t]*\r?\n(?:[\s\S]*?\r?\n)??---[ \t]*(?:\r?\n|$)/;
const FENCE = /^[ \t]{0,3}(`{3,}|~{3,})/;
// Morceaux de prose jamais touchés par les règles de TEXTE : code en ligne,
// [[liens]] / ![[embeds]], cible ](…) d'un lien Markdown, URL, balises HTML.
const INLINE_PROTECTED = /`+[^`\n]*`+|!?\[\[[^\]\n]*\]\]|\]\([^)\n]*\)|https?:\/\/[^\s)>\]]+|<[^>\n]+>/g;
const TOKEN = (i: number) => `\uE000${i}\uE001`;
const TOKEN_RE = /\uE000(\d+)\uE001/g;

type Segment = { text: string; code: boolean };

// Découpe le corps en segments prose / blocs de code clôturés.
function splitFences(body: string): Segment[] {
  const lines = body.split('\n');
  const segments: Segment[] = [];
  let current: string[] = [];
  let fence: string | null = null;
  const push = (code: boolean) => {
    if (current.length) segments.push({ text: current.join('\n'), code });
    current = [];
  };
  for (const line of lines) {
    const m = FENCE.exec(line);
    if (fence === null && m) {
      push(false);
      fence = m[1];
      current.push(line);
    } else if (fence !== null && m && m[1][0] === fence[0] && m[1].length >= fence.length && line.trim() === m[1]) {
      current.push(line);
      push(true);
      fence = null;
    } else {
      current.push(line);
    }
  }
  push(fence !== null);
  return segments;
}

function protectInline(text: string, protect: boolean): { text: string; saved: string[] } {
  if (!protect) return { text, saved: [] };
  const saved: string[] = [];
  return {
    text: text.replace(INLINE_PROTECTED, (m) => {
      saved.push(m);
      return TOKEN(saved.length - 1);
    }),
    saved,
  };
}

function restoreInline(text: string, saved: string[]): string {
  if (!saved.length) return text;
  return text.replace(TOKEN_RE, (_m, i: string) => saved[Number(i)] ?? '');
}

//////// 3. formatMarkdown /////////////////////////////////////////////////////

const NNBSP = '\u202F';
const NBSP = '\u00A0';

function applyTextRules(text: string, s: FormattingSettings): string {
  let out = text;
  if (s.rules.headingSpace) out = out.replace(/^([ \t]{0,3})(#{2,6})(?=[^#\s])/gm, '$1$2 ');
  if (s.rules.ellipsis) out = out.replace(/(^|[^.])\.{3}(?!\.)/g, '$1…');
  if (s.rules.frenchQuotes) {
    out = out.replace(/(^|[\s(\[—–-])"([^"\n]+?)"(?=$|[\s.,;:!?)\]…])/gm, `$1«${NNBSP}$2${NNBSP}»`);
  }
  if (s.rules.frenchPunctuation) {
    // Espace ordinaire (ou aucune, après un mot) avant ; ! ? → fine insécable.
    out = out.replace(/[ \u00A0]+([;!?])/g, `${NNBSP}$1`);
    out = out.replace(/([\p{L}\p{N}»)\]*_])([;!?])(?=$|[\s)\]»"'*_])/gmu, `$1${NNBSP}$2`);
    // Deux-points : seule une espace EXISTANTE devient insécable (jamais
    // d'ajout : heures 12:30, champs `clé::`, emoji :smile:).
    out = out.replace(/(\S) +:(?!:)/g, `$1${NBSP}:`);
    // Guillemets : espace fine insécable à l'intérieur.
    out = out.replace(/«[ \u00A0]*(?=\S)/g, `«${NNBSP}`);
    out = out.replace(/(\S)[ \u00A0]*»/g, `$1${NNBSP}»`);
  }
  if (s.rules.trailingSpaces) out = out.replace(/[ \t]+$/gm, '');
  return out;
}

export type FormattingError = { ruleId: string; name: string; message: string };

export function formatMarkdown(
  input: string,
  settings: FormattingSettings,
): { text: string; errors: FormattingError[] } {
  const errors: FormattingError[] = [];
  const customs = settings.customRules
    .filter((r) => r.enabled && r.pattern)
    .map((r) => {
      const compiled = compileCustomRule(r);
      if ('error' in compiled) errors.push({ ruleId: r.id, name: r.name || r.pattern, message: compiled.error });
      return 'regex' in compiled ? { regex: compiled.regex, replacement: unescapeReplacement(r.replacement) } : null;
    })
    .filter((x): x is { regex: RegExp; replacement: string } => x !== null);

  // CRLF : traité en LF puis restitué.
  const crlf = input.includes('\r\n');
  const text = crlf ? input.replace(/\r\n/g, '\n') : input;

  const fm = settings.includeFrontmatter ? null : FRONTMATTER.exec(text);
  const head = fm ? fm[0] : '';
  const body = text.slice(head.length);

  const formatProse = (prose: string) => {
    const { text: guarded, saved } = protectInline(prose, !settings.includeCode);
    let out = applyTextRules(guarded, settings);
    for (const c of customs) {
      try {
        out = out.replace(c.regex, c.replacement);
      } catch (error) {
        errors.push({ ruleId: c.regex.source, name: c.regex.source, message: String(error) });
      }
    }
    return restoreInline(out, saved);
  };

  const segments = settings.includeCode ? [{ text: body, code: false }] : splitFences(body);
  let result = segments.map((seg) => (seg.code ? seg.text : formatProse(seg.text))).join('\n');

  if (settings.rules.multipleBlankLines) {
    // Hors blocs de code : refait sur les segments de prose uniquement.
    const segs = settings.includeCode ? [{ text: result, code: false }] : splitFences(result);
    result = segs.map((seg) => (seg.code ? seg.text : seg.text.replace(/\n[ \t]*\n(?:[ \t]*\n)+/g, '\n\n'))).join('\n');
  }
  if (settings.rules.finalNewline) result = result.replace(/\s+$/, '') + '\n';

  let full = head + result;
  if (settings.includeFrontmatter && fm === null && settings.rules.trailingSpaces) full = full.replace(/[ \t]+$/gm, '');
  if (crlf) full = full.replace(/\n/g, '\r\n');
  return { text: full, errors };
}

//////// 4. Règles personnalisées (compilation, test sur un exemple) ///////////

// Drapeaux autorisés ; `g` toujours ajouté (toutes les occurrences).
export function compileCustomRule(rule: Pick<CustomFormattingRule, 'pattern' | 'flags'>): { regex: RegExp } | { error: string } {
  const flags = Array.from(new Set(`${rule.flags ?? ''}g`.replace(/[^gimsuy]/g, ''))).join('');
  if (/[^gimsuy\s]/.test(rule.flags ?? '')) return { error: `Drapeaux invalides : « ${rule.flags} » (autorisés : i m s u y).` };
  try {
    return { regex: new RegExp(rule.pattern, flags) };
  } catch (error) {
    return { error: `Motif invalide : ${error instanceof Error ? error.message : String(error)}` };
  }
}

// `\n`, `\t`, `\u00A0`… écrits dans le champ « remplacement ».
export function unescapeReplacement(value: string): string {
  return value.replace(/\\(n|t|u([0-9a-fA-F]{4}))/g, (_m, kind: string, hex?: string) =>
    kind === 'n' ? '\n' : kind === 't' ? '\t' : String.fromCharCode(parseInt(hex ?? '0', 16)),
  );
}

// Aperçu dans les Paramètres : la règle seule, sur un exemple.
export function testCustomRule(
  rule: Pick<CustomFormattingRule, 'pattern' | 'flags' | 'replacement'>,
  sample: string,
): { ok: true; output: string; count: number } | { ok: false; error: string } {
  const compiled = compileCustomRule(rule);
  if ('error' in compiled) return { ok: false, error: compiled.error };
  const count = (sample.match(compiled.regex) ?? []).length;
  return { ok: true, output: sample.replace(compiled.regex, unescapeReplacement(rule.replacement)), count };
}
