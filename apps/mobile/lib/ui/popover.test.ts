import { describe, expect, it } from 'vitest';

import { placePopover, solidColor } from './popover';

const viewport = { width: 1000, height: 700 };
const menu = { width: 170, height: 340 };

describe('placePopover', () => {
  it('sous l’ancre, aligné à droite', () => {
    expect(placePopover({ x: 600, y: 100, width: 120, height: 30 }, menu, viewport)).toEqual({ left: 550, top: 134, maxHeight: 558 });
  });
  it('au-dessus quand la place manque en bas', () => {
    const p = placePopover({ x: 600, y: 600, width: 120, height: 30 }, menu, viewport);
    expect(p.top).toBe(600 - 4 - 340);
  });
  it('jamais hors de l’écran à gauche ni à droite', () => {
    expect(placePopover({ x: 0, y: 10, width: 40, height: 30 }, menu, viewport).left).toBe(8);
    expect(placePopover({ x: 990, y: 10, width: 40, height: 30 }, menu, viewport).left).toBe(1000 - 170 - 8);
  });
});

describe('solidColor', () => {
  it('retire l’alpha des panneaux translucides', () => {
    expect(solidColor('rgba(28, 28, 34, 0.6)', '#fff')).toBe('#1c1c22');
    expect(solidColor('#f5f5f7', '#fff')).toBe('#f5f5f7');
    expect(solidColor(undefined, '#ffffff')).toBe('#ffffff');
  });
});
