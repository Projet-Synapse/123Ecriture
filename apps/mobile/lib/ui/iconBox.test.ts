import { describe, expect, it } from 'vitest';

import { TREE_ICON_SIZE, fixedIconBoxStyle } from './iconBox';

describe('fixedIconBoxStyle — icônes de taille constante', () => {
  it('fige largeur et hauteur, sans rétrécissement possible', () => {
    const style = fixedIconBoxStyle(16);
    expect(style).toMatchObject({
      width: 16,
      height: 16,
      minWidth: 16,
      minHeight: 16,
      maxWidth: 16,
      maxHeight: 16,
      flexShrink: 0,
      flexGrow: 0,
    });
  });

  it('même boîte pour tous les types de fichiers (taille unique)', () => {
    expect(fixedIconBoxStyle(TREE_ICON_SIZE)).toEqual(fixedIconBoxStyle(16));
  });

  it('taille invalide → taille de l’explorateur', () => {
    expect(fixedIconBoxStyle(Number.NaN).width).toBe(TREE_ICON_SIZE);
    expect(fixedIconBoxStyle(0).height).toBe(TREE_ICON_SIZE);
    expect(fixedIconBoxStyle(15.6).width).toBe(16);
  });
});
