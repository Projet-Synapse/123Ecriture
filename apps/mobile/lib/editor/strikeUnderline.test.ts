import { describe, expect, it } from 'vitest';

import { findLiveMatches, findStrikeAndUnderline } from './liveDecorations';
import { createConfiguredMarkdownIt } from './markdownPlugins';
import { toggleWrap } from './mdxFormatting';
import { NOTES_TOOLBAR_ACTIONS } from './notesToolbarActions';

const sel = (start: number, end = start) => ({ start, end });
const strike = (text: string, s: { start: number; end: number }) => toggleWrap(text, s, '~~', '~~');
const underline = (text: string, s: { start: number; end: number }) => toggleWrap(text, s, '<u>', '</u>');

describe('toggleWrap (barré / souligné)', () => {
  it('ajoute autour de la sélection, la sélection suit le texte', () => {
    const r = underline('un mot ici', sel(3, 6));
    expect(r.text).toBe('un <u>mot</u> ici');
    expect(r.text.slice(r.selection.start, r.selection.end)).toBe('mot');
  });

  it('re-cliquer retire (marqueurs autour ou inclus dans la sélection)', () => {
    expect(underline('un <u>mot</u> ici', sel(6, 9)).text).toBe('un mot ici');
    expect(strike('un ~~mot~~ ici', sel(3, 10)).text).toBe('un mot ici');
  });

  it('au curseur : insère une paire vide, ou démarque la zone où il se trouve', () => {
    const empty = strike('ab', sel(1));
    expect(empty.text).toBe('a~~~~b');
    expect(empty.selection).toEqual(sel(3));
    const inside = strike('x ~~barré~~ y', sel(6));
    expect(inside.text).toBe('x barré y');
    expect(inside.selection).toEqual(sel(4));
  });

  it('boutons et raccourcis de la barre', () => {
    const byId = Object.fromEntries(NOTES_TOOLBAR_ACTIONS.map((a) => [a.id, a]));
    expect(byId.strike.shortcut).toBe('Mod-Shift-x');
    expect(byId.underline.shortcut).toBe('Mod-u');
    expect(byId.strike.run('mot', sel(0, 3)).text).toBe('~~mot~~');
    expect(byId.underline.run('mot', sel(0, 3)).text).toBe('<u>mot</u>');
    const shortcuts = NOTES_TOOLBAR_ACTIONS.map((a) => a.shortcut).filter(Boolean);
    expect(new Set(shortcuts).size).toBe(shortcuts.length); // aucun conflit interne
  });
});

describe('live preview', () => {
  it('repère ~~…~~ et <u>…</u> (marqueurs de longueurs différentes)', () => {
    const [s, u] = findStrikeAndUnderline('a ~~b~~ c <u>d</u>');
    expect(s).toMatchObject({ type: 'strike', from: 2, to: 7, markerLength: 2 });
    expect(u).toMatchObject({ type: 'underline', from: 10, to: 18, markerLength: 3, closeLength: 4 });
  });

  it('contenu stylé = entre les marqueurs', () => {
    const text = 'x <u>souligné</u>';
    const match = findLiveMatches(text).find((m) => m.kind === 'mark');
    expect(match && match.kind === 'mark' && text.slice(match.contentSpans[0].from, match.contentSpans[0].to)).toBe(
      'souligné',
    );
  });

  it('~~ ~~ avec espaces au bord : pas barré', () => {
    expect(findStrikeAndUnderline('~~ a ~~')).toEqual([]);
  });
});

describe('aperçu', () => {
  const inlineTypes = (src: string) =>
    (createConfiguredMarkdownIt().parse(src, {})[1].children ?? [])
      .filter((t) => !(t.type === 'text' && t.content === ''))
      .map((t) => t.type);

  it('<u> rendu en souligné, contenu toujours en Markdown', () => {
    expect(inlineTypes('a <u>b **c**</u> d')).toEqual([
      'text',
      'underline_open',
      'text',
      'strong_open',
      'text',
      'strong_close',
      'underline_close',
      'text',
    ]);
  });

  it('balise orpheline : texte brut', () => {
    expect(inlineTypes('a <u>b')).not.toContain('underline_open');
    expect(inlineTypes('a </u> b')).not.toContain('underline_close');
  });

  it('barré GFM reconnu', () => {
    expect(inlineTypes('~~x~~')).toContain('s_open');
  });
});
