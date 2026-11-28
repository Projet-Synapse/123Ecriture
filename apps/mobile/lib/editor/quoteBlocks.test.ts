import { describe, expect, it } from 'vitest';

import { calloutAccent, findQuoteBlocks, parseCallout, quoteMarkerOf } from './liveDecorations';

describe('citations `>`', () => {
  it('repère le préfixe et la profondeur (`>` et `>>`, espaces intermédiaires)', () => {
    expect(quoteMarkerOf('> hello')).toEqual({ depth: 1, markerFrom: 0, markerTo: 2 });
    expect(quoteMarkerOf('>>x')).toEqual({ depth: 2, markerFrom: 0, markerTo: 2 });
    expect(quoteMarkerOf('> > hi')).toEqual({ depth: 2, markerFrom: 0, markerTo: 4 });
    expect(quoteMarkerOf('   > z')).toEqual({ depth: 1, markerFrom: 3, markerTo: 5 });
    expect(quoteMarkerOf('    > indented-code')).toBeNull();
    expect(quoteMarkerOf('pas une citation')).toBeNull();
  });

  it('fusionne les lignes consécutives, sépare sur une ligne vide sans `>`', () => {
    const text = '> ⛔ **Raté** — Une fiche de personnage…\n> ✅ **Réussi** — Une fiche courte…\n\n> autre bloc';
    const blocks = findQuoteBlocks(text);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].lines).toHaveLength(2);
    expect(text.slice(blocks[0].from, blocks[0].to)).toContain('Raté');
    expect(text.slice(blocks[0].from, blocks[0].to)).toContain('Réussi');
    expect(blocks[1].lines).toHaveLength(1);
  });

  it('une ligne `>` vide continue le bloc', () => {
    const text = '> a\n>\n> b';
    expect(findQuoteBlocks(text)).toHaveLength(1);
    expect(findQuoteBlocks(text)[0].lines).toHaveLength(3);
  });

  it('citations imbriquées `>>` dans le même bloc, profondeurs par ligne', () => {
    const text = '> dehors\n>> dedans';
    const [b] = findQuoteBlocks(text);
    expect(b.lines.map((l) => l.depth)).toEqual([1, 2]);
  });

  it('ignore le contenu des fences de code', () => {
    const text = '```\n> pas une citation\n```\n> vraie';
    const blocks = findQuoteBlocks(text);
    expect(blocks).toHaveLength(1);
    expect(text.slice(blocks[0].from, blocks[0].to)).toBe('> vraie');
  });

  it('callout Obsidian `> [!note] Titre`', () => {
    expect(parseCallout('[!note] Titre')).toEqual({ type: 'note', title: 'Titre', syntaxLength: 7 });
    expect(parseCallout('[!WARNING]')).toEqual({ type: 'warning', title: '', syntaxLength: 10 });
    expect(parseCallout('juste du texte')).toBeNull();
    const [b] = findQuoteBlocks('> [!note] Rappel\n> corps');
    expect(b.callout).toMatchObject({ type: 'note', title: 'Rappel' });
    expect('> [!note] Rappel'.slice(b.callout!.syntaxFrom, b.callout!.syntaxTo)).toBe('[!note]');
    expect(calloutAccent('warning', '#00f')).toBe('#d97706');
    expect(calloutAccent('danger', '#00f')).toBe('#dc2626');
    expect(calloutAccent('note', '#4f46e5')).toBe('#4f46e5');
  });
});
