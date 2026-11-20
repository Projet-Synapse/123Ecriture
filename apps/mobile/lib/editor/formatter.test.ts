import { describe, expect, it } from 'vitest';

import {
  DEFAULT_FORMATTING,
  formatMarkdown,
  normalizeFormattingSettings,
  testCustomRule,
  type FormattingSettings,
} from './formatter';

const NNBSP = '\u202F';
const NBSP = '\u00A0';
const all: FormattingSettings = {
  ...DEFAULT_FORMATTING,
  rules: { ...DEFAULT_FORMATTING.rules, frenchPunctuation: true, frenchQuotes: true, ellipsis: true },
};
const fmt = (text: string, s: FormattingSettings = DEFAULT_FORMATTING) => formatMarkdown(text, s).text;

describe('règles intégrées', () => {
  it('espaces de fin, lignes vides multiples, saut de ligne final, titres', () => {
    expect(fmt('##Titre  \nTexte \n\n\n\nFin\n\n\n')).toBe('## Titre\nTexte\n\nFin\n');
  });

  it('« #mot » en début de ligne reste un tag', () => {
    expect(fmt('#projet en cours\n')).toBe('#projet en cours\n');
  });

  it('typographie française', () => {
    expect(fmt('Vraiment ? Oui! Note : "texte" et « mot» ... fin\n', all)).toBe(
      `Vraiment${NNBSP}? Oui${NNBSP}! Note${NBSP}: «${NNBSP}texte${NNBSP}» et «${NNBSP}mot${NNBSP}» … fin\n`,
    );
  });

  it('n’abîme pas heures, URL, liens, embeds, code en ligne', () => {
    const src = 'À 12:30 voir https://ex.fr/a?b=1! ![[img.png]] [[Note]] [lien](https://x.fr/?q) `a ; b` champ:: valeur\n';
    const out = fmt(src, all);
    expect(out).toContain('12:30');
    expect(out).toContain('https://ex.fr/a?b=1');
    expect(out).toContain('![[img.png]]');
    expect(out).toContain('](https://x.fr/?q)');
    expect(out).toContain('`a ; b`');
    expect(out).toContain('champ:: valeur');
  });

  it('idempotent', () => {
    const once = fmt('Oui ! "a" ... ##T  \n\n\n', all);
    expect(fmt(once, all)).toBe(once);
  });
});

describe('frontmatter et blocs de code protégés', () => {
  const src = '---\ntitre: "x"   \n---\nTexte   \n```js\nconst a = 1;   \n\n\n\n```\nFin ?\n';

  it('par défaut : ni frontmatter ni code modifiés', () => {
    const out = fmt(src, all);
    expect(out.startsWith('---\ntitre: "x"   \n---\n')).toBe(true);
    expect(out).toContain('const a = 1;   \n\n\n\n```');
    expect(out).toContain('Texte\n');
    expect(out).toContain(`Fin${NNBSP}?`);
  });

  it('options : code inclus', () => {
    const out = formatMarkdown(src, { ...DEFAULT_FORMATTING, includeCode: true }).text;
    expect(out).toContain('const a = 1;\n\n```');
  });

  it('CRLF conservé', () => {
    expect(fmt('a  \r\nb\r\n')).toBe('a\r\nb\r\n');
  });
});

describe('règles personnalisées', () => {
  it('appliquées dans l’ordre, avec groupes et \\u00A0', () => {
    const s: FormattingSettings = {
      ...DEFAULT_FORMATTING,
      customRules: [
        { id: '1', name: 'TODO', pattern: '\\bTODO\\b', replacement: '- [ ]', flags: 'g', enabled: true },
        { id: '2', name: 'nombres', pattern: '(\\d) (\\d{3})', replacement: '$1\\u00A0$2', flags: '', enabled: true },
        { id: '3', name: 'off', pattern: 'a', replacement: 'b', flags: 'g', enabled: false },
      ],
    };
    expect(fmt('TODO payer 1 000 € a\n', s)).toBe(`- [ ] payer 1${NBSP}000 € a\n`);
  });

  it('regex invalide signalée, sans planter, le reste appliqué', () => {
    const s: FormattingSettings = {
      ...DEFAULT_FORMATTING,
      customRules: [{ id: 'x', name: 'cassée', pattern: '([a-', replacement: '', flags: 'g', enabled: true }],
    };
    const r = formatMarkdown('a  \n', s);
    expect(r.text).toBe('a\n');
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].name).toBe('cassée');
  });

  it('aperçu sur un exemple', () => {
    expect(testCustomRule({ pattern: 'chat', flags: 'i', replacement: 'chien' }, 'Chat et chat')).toEqual({
      ok: true,
      output: 'chien et chien',
      count: 2,
    });
    expect(testCustomRule({ pattern: 'a', flags: 'z', replacement: '' }, 'a').ok).toBe(false);
  });

  it('réglages tolérants', () => {
    const s = normalizeFormattingSettings({ rules: { ellipsis: true, inconnu: true }, customRules: [{ pattern: 'x' }, 3] });
    expect(s.rules.ellipsis).toBe(true);
    expect(s.rules.trailingSpaces).toBe(true);
    expect(s.customRules).toHaveLength(1);
    expect(s.formatOnSave).toBe(false);
  });
});
