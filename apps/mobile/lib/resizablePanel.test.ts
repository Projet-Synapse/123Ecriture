import { describe, expect, it } from 'vitest';

import { clampWidth, computeDragWidth, shouldCollapseOnRelease } from './resizablePanel';

describe('clampWidth', () => {
  it('laisse une valeur dans les bornes inchangée', () => {
    expect(clampWidth(200, 100, 400)).toBe(200);
  });

  it('remonte une valeur trop petite au minimum', () => {
    expect(clampWidth(10, 100, 400)).toBe(100);
  });

  it('redescend une valeur trop grande au maximum', () => {
    expect(clampWidth(9000, 100, 400)).toBe(400);
  });
});

describe('shouldCollapseOnRelease', () => {
  it('replie sous la moitié du minimum', () => {
    expect(shouldCollapseOnRelease(40, 100)).toBe(true);
  });

  it('ne replie pas au-dessus du seuil', () => {
    expect(shouldCollapseOnRelease(60, 100)).toBe(false);
  });
});

describe('computeDragWidth', () => {
  it('agrandit vers la droite quand edge=1 et le curseur avance', () => {
    expect(computeDragWidth(200, 500, 560, 1, 100, 400)).toBe(260);
  });

  it('inverse le sens quand edge=-1 (poignée sur le bord gauche)', () => {
    expect(computeDragWidth(200, 500, 560, -1, 100, 400)).toBe(140);
  });

  it('reste bloqué au minimum même si le curseur va plus loin', () => {
    expect(computeDragWidth(200, 500, 100, 1, 100, 400)).toBe(100);
  });
});
