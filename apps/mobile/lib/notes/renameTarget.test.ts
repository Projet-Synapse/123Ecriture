import { describe, expect, it } from 'vitest';

import {
  RenameFormatError,
  convertNoteFormat,
  formatConversionBetween,
  remapPathsAfterRename,
  resolveRenameName,
  splitRawFrontmatter,
  willConvertFormat,
} from './renameTarget';

const file = { isDirectory: false };

describe('resolveRenameName', () => {
  it('« Note.md » → « Note.mdx » : extension saisie retenue, conversion demandée', () => {
    expect(resolveRenameName('Note.md', 'Note.mdx', file)).toEqual({
      finalName: 'Note.mdx',
      displayName: 'Note',
      conversion: { from: '.md', to: '.mdx' },
    });
  });

  it('« Note.mdx » → « Note.md » : jamais « Note.md.mdx »', () => {
    expect(resolveRenameName('Note.mdx', 'Note.md', file)).toEqual({
      finalName: 'Note.md',
      displayName: 'Note',
      conversion: { from: '.mdx', to: '.md' },
    });
  });

  it('extension saisie en majuscules : normalisée', () => {
    expect(resolveRenameName('Note.md', 'Autre.MDX', file).finalName).toBe('Autre.mdx');
  });

  it('nom sans extension : extension réelle conservée (comportement historique)', () => {
    expect(resolveRenameName('Note.mdx', 'Chapitre 1', file)).toEqual({
      finalName: 'Chapitre 1.mdx',
      displayName: 'Chapitre 1',
      conversion: null,
    });
    expect(resolveRenameName('Plan.canvas', 'Carte', file).finalName).toBe('Carte.canvas');
  });

  it('nom saisi avec la même extension : pas de doublon', () => {
    expect(resolveRenameName('Note.md', 'Autre.md', file)).toEqual({ finalName: 'Autre.md', displayName: 'Autre', conversion: null });
    expect(resolveRenameName('Note.MD', 'Autre.md', file).finalName).toBe('Autre.MD');
  });

  it('note → .canvas (ou l’inverse) : refusé clairement', () => {
    expect(() => resolveRenameName('Note.md', 'Note.canvas', file)).toThrow(RenameFormatError);
    expect(() => resolveRenameName('Plan.canvas', 'Plan.md', file)).toThrow(/seules les notes \.md et \.mdx/);
  });

  it('fichiers code : changement d’extension libre, sans conversion', () => {
    expect(resolveRenameName('script.py', 'script.ts', file)).toEqual({ finalName: 'script.ts', displayName: 'script', conversion: null });
  });

  it('séparateurs retirés, nom vide refusé, dossiers inchangés', () => {
    expect(resolveRenameName('Note.md', 'a/b\\c.mdx', file).finalName).toBe('abc.mdx');
    expect(() => resolveRenameName('Note.md', '   ', file)).toThrow('Le nom ne peut pas être vide.');
    expect(resolveRenameName('Dossier', 'Notes.md', { isDirectory: true })).toEqual({
      finalName: 'Notes.md',
      displayName: 'Notes.md',
      conversion: null,
    });
  });

  it('un nom qui n’est QUE l’extension n’est pas pris pour une extension', () => {
    expect(resolveRenameName('Note.md', '.mdx', file).finalName).toBe('.mdx.md');
  });
});

describe('formatConversionBetween', () => {
  it('détecte md ⇄ mdx, ignore le reste', () => {
    expect(formatConversionBetween('a/Note.md', 'a/Note.mdx')).toEqual({ from: '.md', to: '.mdx' });
    expect(formatConversionBetween('a/Note.mdx', 'a/Autre.md')).toEqual({ from: '.mdx', to: '.md' });
    expect(formatConversionBetween('a/Note.md', 'a/Autre.md')).toBeNull();
    expect(formatConversionBetween('Plan.canvas', 'Plan2.canvas')).toBeNull();
  });
});

describe('splitRawFrontmatter', () => {
  it('frontmatter conservé octet pour octet (CRLF, BOM)', () => {
    const fm = '\uFEFF---\r\ntitre: {a}\r\ntags: [x]\r\n---\r\n';
    expect(splitRawFrontmatter(`${fm}Corps {b}`)).toEqual({ frontmatter: fm, body: 'Corps {b}' });
  });

  it('sans frontmatter fermé : tout est corps', () => {
    expect(splitRawFrontmatter('---\nnon fermé')).toEqual({ frontmatter: '', body: '---\nnon fermé' });
  });
});

describe('convertNoteFormat md → mdx', () => {
  const toMdx = (text: string) => convertNoteFormat(text, { from: '.md', to: '.mdx' });

  it('échappe accolades et chevrons isolés', () => {
    expect(toMdx('Un {mot} et 3 < 5, <3, a <= b\n')).toBe('Un \\{mot\\} et 3 \\< 5, \\<3, a \\<= b\n');
  });

  it('ne double pas les échappements existants', () => {
    expect(toMdx('déjà \\{ok\\} et \\<\n')).toBe('déjà \\{ok\\} et \\<\n');
  });

  it('commentaires HTML → commentaires MDX (multi-lignes)', () => {
    expect(toMdx('a <!-- note\nprivée --> b\n')).toBe('a {/* note\nprivée */} b\n');
  });

  it('liens automatiques et balises vides', () => {
    expect(toMdx('<https://ex.fr/a> <moi@ex.fr>\nligne<br>suite <img src="x.png"> <br/>\n')).toBe(
      '[https://ex.fr/a](https://ex.fr/a) [moi@ex.fr](mailto:moi@ex.fr)\nligne<br />suite <img src="x.png" /> <br/>\n',
    );
  });

  it('ne touche ni au code clôturé ni aux spans de code', () => {
    const text = 'Texte {a}\n```js\nconst o = {a: 1 < 2};\n```\nEt `{x} < y` puis ``a`{b}`` fin {c}\n';
    expect(toMdx(text)).toBe('Texte \\{a\\}\n```js\nconst o = {a: 1 < 2};\n```\nEt `{x} < y` puis ``a`{b}`` fin \\{c\\}\n');
  });

  it('frontmatter intact, balises HTML valides intactes', () => {
    const text = '---\ntitre: "{brut}"\n---\n<div>ok</div> {x}\n';
    expect(toMdx(text)).toBe('---\ntitre: "{brut}"\n---\n<div>ok</div> \\{x\\}\n');
  });

  it('accent grave isolé : pas pris pour du code', () => {
    expect(toMdx('l`apostrophe {a}\n\nautre ` {b}\n')).toBe('l`apostrophe \\{a\\}\n\nautre ` \\{b\\}\n');
  });
});

describe('convertNoteFormat mdx → md', () => {
  const toMd = (text: string) => convertNoteFormat(text, { from: '.mdx', to: '.md' });

  it('ne change rien d’autre que les commentaires MDX', () => {
    const text = '---\na: 1\n---\n# Titre\n<Composant x={1} />\n\\{échappé\\}\n';
    expect(toMd(text)).toBe(text);
    expect(toMd('a {/* secret */} b\n```\n{/* code */}\n```\n')).toBe('a <!-- secret --> b\n```\n{/* code */}\n```\n');
  });

  it('aller-retour md → mdx → md : commentaires retrouvés', () => {
    const md = 'x <!-- c --> y\n';
    expect(toMd(convertNoteFormat(md, { from: '.md', to: '.mdx' }))).toBe(md);
  });
});

describe('remapPathsAfterRename', () => {
  it('réécrit l’élément et le contenu d’un dossier renommé', () => {
    expect(remapPathsAfterRename(['A/Note.md', 'A/B/x.md', 'AB/y.md'], 'A/Note.md', 'A/Note.mdx')).toEqual([
      'A/Note.mdx',
      'A/B/x.md',
      'AB/y.md',
    ]);
    expect(remapPathsAfterRename(['A/B/x.md', 'AB/y.md'], 'A', 'Z')).toEqual(['Z/B/x.md', 'AB/y.md']);
  });

  it('même référence si rien ne change', () => {
    const list = ['a.md'];
    expect(remapPathsAfterRename(list, 'b.md', 'c.md')).toBe(list);
  });
});

describe('willConvertFormat', () => {
  it('vrai seulement pour md ⇄ mdx', () => {
    expect(willConvertFormat('A/Note.md', 'Note.mdx')).toBe(true);
    expect(willConvertFormat('A/Note.mdx', 'Autre.md')).toBe(true);
    expect(willConvertFormat('A/Note.md', 'Autre')).toBe(false);
    expect(willConvertFormat('A/Note.md', 'Note.canvas')).toBe(false);
    expect(willConvertFormat('A/Dossier', 'x.mdx')).toBe(false);
  });
});
