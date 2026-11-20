import { describe, expect, it } from 'vitest';

import { findAlignedBlocks } from './liveDecorations';
import { createConfiguredMarkdownIt } from './markdownPlugins';
import { applyAlignment, parseAlignedBlock } from './mdxFormatting';

const sel = (start: number, end = start) => ({ start, end });

describe('applyAlignment', () => {
  it('une partie de ligne sélectionnée → tout le paragraphe est aligné', () => {
    const text = 'Avant\n\nLigne une\nLigne deux\n\nAprès';
    const r = applyAlignment(text, sel(9, 13), 'center');
    expect(r.text).toBe('Avant\n\n<p align="center">Ligne une\nLigne deux</p>\n\nAprès');
    // La sélection reste sur les mêmes mots.
    expect(r.text.slice(r.selection.start, r.selection.end)).toBe('gne ');
  });

  it('changer d’alignement remplace l’enveloppe (jamais d’imbrication)', () => {
    const r = applyAlignment('<p align="center">Texte</p>', sel(20), 'right');
    expect(r.text).toBe('<p align="right">Texte</p>');
    const d = applyAlignment('<div style="text-align: justify">Texte</div>', sel(36), 'center');
    expect(d.text).toBe('<p align="center">Texte</p>');
  });

  it('« gauche » retire l’enveloppe, curseur conservé dans le texte', () => {
    const r = applyAlignment('<p align="justify">Un texte</p>', sel(22), 'left');
    expect(r.text).toBe('Un texte');
    expect(r.selection).toEqual(sel(3));
    expect(applyAlignment('Déjà à gauche', sel(2), 'left').text).toBe('Déjà à gauche');
  });

  it('plusieurs paragraphes sélectionnés : chacun enveloppé séparément', () => {
    const text = 'Un\n\nDeux\n\nTrois';
    const r = applyAlignment(text, sel(0, text.length), 'justify');
    expect(r.text).toBe('<p align="justify">Un</p>\n\n<p align="justify">Deux</p>\n\n<p align="justify">Trois</p>');
  });

  it('titres, listes, citations, tableaux et code ne sont pas enveloppés', () => {
    for (const text of ['# Titre', '- item', '1. item', '> cité', '| a | b |', '```js']) {
      expect(applyAlignment(text, sel(1), 'center').text).toBe(text);
    }
  });

  it('curseur en fin de paragraphe : reste avant la balise fermante', () => {
    const r = applyAlignment('Texte', sel(5), 'center');
    expect(r.text).toBe('<p align="center">Texte</p>');
    expect(r.selection).toEqual(sel(23));
  });

  it('parseAlignedBlock reconnaît les deux formes', () => {
    expect(parseAlignedBlock('<p align="right">x</p>')?.align).toBe('right');
    expect(parseAlignedBlock('<div style="text-align:center;">x</div>')?.align).toBe('center');
    expect(parseAlignedBlock('<p>x</p>')).toBeNull();
  });
});

describe('rendu (aperçu) : bloc aligné', () => {
  it('produit un bloc `aligned` avec le contenu en Markdown inline', () => {
    const tokens = createConfiguredMarkdownIt().parse('<p align="center">Un **gras**\nsuite</p>\n\nNormal', {});
    expect(tokens.map((t) => t.type)).toEqual([
      'aligned_open',
      'inline',
      'aligned_close',
      'paragraph_open',
      'inline',
      'paragraph_close',
    ]);
    expect(tokens[0].meta).toEqual({ align: 'center' });
    expect(tokens[1].children?.some((child) => child.type === 'strong_open')).toBe(true);
  });

  it('balise non fermée ou autre HTML : texte normal (HTML toujours désactivé)', () => {
    const types = (src: string) => createConfiguredMarkdownIt().parse(src, {}).map((t) => t.type);
    expect(types('<p align="center">pas fermé\n\nsuite')).not.toContain('aligned_open');
    expect(types('<script>alert(1)</script>')).not.toContain('aligned_open');
  });
});

describe('live preview : findAlignedBlocks', () => {
  it('lignes du bloc et balises à masquer', () => {
    const text = 'a\n<p align="right">un\ndeux</p>\nb';
    const [block] = findAlignedBlocks(text);
    expect(block.align).toBe('right');
    expect(text.slice(block.from, block.openTo)).toBe('<p align="right">');
    expect(text.slice(block.closeFrom, block.to)).toBe('</p>');
    expect(block.lineStarts).toEqual([2, 22]);
  });

  it('bloc non fermé avant une ligne vide : ignoré', () => {
    expect(findAlignedBlocks('<p align="center">x\n\ny</p>')).toEqual([]);
  });
});
