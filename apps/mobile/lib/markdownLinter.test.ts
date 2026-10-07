import { describe, expect, it } from 'vitest';

import { lintMarkdown } from './markdownLinter';

describe('lintMarkdown', () => {
  it('supprime les espaces en fin de ligne', () => {
    expect(lintMarkdown('titre   \ntexte\t\n')).toBe('titre\ntexte\n');
  });

  it('réduit les 3+ lignes vides à une seule', () => {
    expect(lintMarkdown('a\n\n\n\nb')).toBe('a\n\nb\n');
  });

  it('termine le fichier par une seule nouvelle ligne', () => {
    expect(lintMarkdown('a')).toBe('a\n');
    expect(lintMarkdown('a\n\n\n')).toBe('a\n');
  });

  it('préserve les blocs de code clôturés', () => {
    const text = '```js\nconst x = 1;   \nlet y = 2;  \n```\naprès   ';
    expect(lintMarkdown(text)).toBe('```js\nconst x = 1;   \nlet y = 2;  \n```\naprès\n');
  });

  it('gère un frontmatter en début de note', () => {
    const text = '---\ntitre: Test\n---\n\ncontenu   ';
    expect(lintMarkdown(text)).toBe('---\ntitre: Test\n---\n\ncontenu\n');
  });
});
