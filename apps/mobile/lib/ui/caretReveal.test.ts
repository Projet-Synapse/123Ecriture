import { describe, expect, it } from 'vitest';

import { keyboardBottomPadding, revealScrollOffset } from './caretReveal';

describe('revealScrollOffset', () => {
  const base = { viewportTop: 100, viewportBottom: 500, scrollOffset: 300, margin: 40 };

  it('curseur déjà visible → rien', () => {
    expect(revealScrollOffset({ ...base, caretTop: 200, caretBottom: 220 })).toBeNull();
  });

  it('curseur sous le clavier → défile juste assez (marge comprise)', () => {
    expect(revealScrollOffset({ ...base, caretTop: 600, caretBottom: 620 })).toBe(300 + 620 - 460);
  });

  it('curseur au-dessus du haut → remonte', () => {
    expect(revealScrollOffset({ ...base, caretTop: 110, caretBottom: 130 })).toBe(300 - 30);
    expect(revealScrollOffset({ ...base, scrollOffset: 10, caretTop: 0, caretBottom: 20 })).toBe(0);
  });

  it('zone visible minuscule : la marge se réduit au lieu d’osciller', () => {
    const r = revealScrollOffset({ viewportTop: 0, viewportBottom: 30, scrollOffset: 0, margin: 48, caretTop: 50, caretBottom: 70 });
    expect(r).toBe(45);
  });
});

describe('keyboardBottomPadding', () => {
  it('ajoute la hauteur du clavier à la marge', () => {
    expect(keyboardBottomPadding(40, 0)).toBe(40);
    expect(keyboardBottomPadding(40, 300)).toBe(340);
  });
});
