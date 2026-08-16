import { describe, expect, it } from 'vitest';

import { buildMonthGrid, monthLabel, toIsoDate } from './calendarDates';

describe('toIsoDate', () => {
  it('formate en AAAA-MM-JJ avec zéros de tête', () => {
    expect(toIsoDate(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(toIsoDate(new Date(2026, 10, 30))).toBe('2026-11-30');
  });
});

describe('monthLabel', () => {
  it('donne le nom du mois en français + année', () => {
    expect(monthLabel(2026, 7)).toBe('Août 2026');
  });
});

describe('buildMonthGrid', () => {
  it('renvoie toujours 42 jours (6 semaines fixes)', () => {
    expect(buildMonthGrid(2026, 7).length).toBe(42);
  });

  it('commence la grille un lundi', () => {
    // Août 2026 commence un samedi — la grille doit donc commencer le
    // lundi précédent (27 juillet 2026).
    const grid = buildMonthGrid(2026, 7);
    expect(grid[0].dateIso).toBe('2026-07-27');
    expect(grid[0].inCurrentMonth).toBe(false);
  });

  it('marque correctement le mois courant vs. les jours de bordure', () => {
    const grid = buildMonthGrid(2026, 7);
    const inMonth = grid.filter((d) => d.inCurrentMonth);
    expect(inMonth.length).toBe(31); // août a 31 jours
    expect(inMonth[0].dateIso).toBe('2026-08-01');
    expect(inMonth[inMonth.length - 1].dateIso).toBe('2026-08-31');
  });

  it('marque "aujourd’hui" via le paramètre `today` (déterministe)', () => {
    const grid = buildMonthGrid(2026, 7, new Date(2026, 7, 16));
    const today = grid.find((d) => d.isToday);
    expect(today?.dateIso).toBe('2026-08-16');
  });
});
