import { describe, expect, it } from 'vitest';

import { searchDialogLayout } from './searchDialogLayout';

describe('searchDialogLayout', () => {
  it('téléphone (Galaxy A13 ~384×854) : pleine largeur avec marges, en haut', () => {
    const l = searchDialogLayout({ windowWidth: 384, windowHeight: 854, statusBarHeight: 30 });
    expect(l).toEqual({ compact: true, width: 360, maxHeight: 854 - 42 - 12, paddingTop: 42, paddingBottom: 12 });
  });

  it('clavier ouvert : la hauteur se réduit, jamais sous 160', () => {
    const l = searchDialogLayout({ windowWidth: 384, windowHeight: 854, statusBarHeight: 30, keyboardHeight: 330 });
    expect(l.paddingBottom).toBe(342);
    expect(l.maxHeight).toBe(854 - 42 - 342);
    expect(searchDialogLayout({ windowWidth: 384, windowHeight: 300, keyboardHeight: 280 }).maxHeight).toBe(160);
  });

  it('desktop : 480 max, centrée, bornée par la fenêtre', () => {
    expect(searchDialogLayout({ windowWidth: 1400, windowHeight: 900 })).toMatchObject({ compact: false, width: 480, maxHeight: 520 });
    expect(searchDialogLayout({ windowWidth: 700, windowHeight: 400 }).maxHeight).toBe(376);
  });
});
