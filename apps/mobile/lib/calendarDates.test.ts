import { describe, expect, it } from 'vitest';

import { buildMonthGrid, compareTimes, monthLabel, normalizeTimeInput, shiftIsoDate, toIsoDate } from './calendarDates';

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

describe('normalizeTimeInput', () => {
  it('complète les saisies courtes en HH:MM', () => {
    expect(normalizeTimeInput('9:00')).toBe('09:00');
    expect(normalizeTimeInput('9')).toBe('09:00');
    expect(normalizeTimeInput('9:5')).toBe('09:05');
    expect(normalizeTimeInput('  23h07 ')).toBe('23:07');
  });

  it('garde une heure déjà normale telle quelle', () => {
    expect(normalizeTimeInput('10:30')).toBe('10:30');
  });

  it('rejette ce qui n’est pas une heure valide', () => {
    expect(normalizeTimeInput('24:00')).toBeNull();
    expect(normalizeTimeInput('12:60')).toBeNull();
    expect(normalizeTimeInput('matin')).toBeNull();
    expect(normalizeTimeInput('')).toBeNull();
    expect(normalizeTimeInput('9:00:30')).toBeNull();
  });
});

describe('compareTimes', () => {
  it('compare numériquement — 9:00 passe avant 10:00 (lexiquement faux)', () => {
    expect(compareTimes('09:00', '10:00')).toBeLessThan(0);
    expect(compareTimes('9:00', '10:00')).toBeLessThan(0);
  });

  it('null (pas d’heure) passe après toute heure', () => {
    expect(compareTimes(null, '08:00')).toBeGreaterThan(0);
    expect(compareTimes('23:59', null)).toBeLessThan(0);
    expect(compareTimes(null, null)).toBe(0);
  });

  it('les vieilles valeurs malformées ne crashent pas et restent après les heures valides', () => {
    expect(compareTimes('n/a', '08:00')).toBeGreaterThan(0);
    expect(compareTimes('n/a', null)).toBeLessThan(0);
    expect(compareTimes('n/a', 'n/a')).toBe(0);
  });
});

describe('shiftIsoDate', () => {
  it('décale de N jours, y compris en fin de mois et d’année', () => {
    expect(shiftIsoDate('2026-09-10', 1)).toBe('2026-09-11');
    expect(shiftIsoDate('2026-09-01', -1)).toBe('2026-08-31');
    expect(shiftIsoDate('2026-12-31', 1)).toBe('2027-01-01');
    // 2028 est bissextile — le 28 février + 1 jour = 29 février.
    expect(shiftIsoDate('2028-02-28', 1)).toBe('2028-02-29');
  });
});
