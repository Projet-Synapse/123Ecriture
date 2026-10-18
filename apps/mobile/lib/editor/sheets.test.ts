import { describe, expect, it } from 'vitest';

import { buildChartSeries, maxSeriesValue, parseNumericCell } from './sheets';

describe('parseNumericCell', () => {
  it('parse un nombre simple', () => {
    expect(parseNumericCell('42')).toBe(42);
  });

  it('accepte la virgule décimale', () => {
    expect(parseNumericCell('3,5')).toBe(3.5);
  });

  it('renvoie 0 pour une cellule vide ou non numérique', () => {
    expect(parseNumericCell(undefined)).toBe(0);
    expect(parseNumericCell('')).toBe(0);
    expect(parseNumericCell('abc')).toBe(0);
  });
});

function makeSheet(overrides: Partial<SheetData> = {}): SheetData {
  return {
    columns: [
      { id: 'label', name: 'Mois' },
      { id: 'a', name: 'Série A' },
      { id: 'b', name: 'Série B' },
    ],
    rows: [
      { id: 'r1', cells: { label: 'Jan', a: '10', b: '5' } },
      { id: 'r2', cells: { label: 'Fév', a: '20', b: '15' } },
    ],
    chart: null,
    ...overrides,
  };
}

describe('buildChartSeries', () => {
  it('renvoie un tableau vide sans config de graphique', () => {
    expect(buildChartSeries(makeSheet())).toEqual([]);
  });

  it('construit une série par colonne de valeurs choisie', () => {
    const sheet = makeSheet({
      chart: { type: 'bar', labelColumnId: 'label', valueColumnIds: ['a', 'b'] },
    });
    const series = buildChartSeries(sheet);
    expect(series).toHaveLength(2);
    expect(series[0]).toEqual({
      seriesId: 'a',
      seriesName: 'Série A',
      points: [
        { label: 'Jan', value: 10 },
        { label: 'Fév', value: 20 },
      ],
    });
    expect(series[1].seriesName).toBe('Série B');
  });

  it('ignore une colonne de valeurs qui n’existe plus', () => {
    const sheet = makeSheet({
      chart: { type: 'bar', labelColumnId: 'label', valueColumnIds: ['a', 'supprimee'] },
    });
    expect(buildChartSeries(sheet).map((s) => s.seriesId)).toEqual(['a']);
  });
});

describe('maxSeriesValue', () => {
  it('trouve le maximum toutes séries confondues', () => {
    const series = buildChartSeries(
      makeSheet({ chart: { type: 'bar', labelColumnId: 'label', valueColumnIds: ['a', 'b'] } }),
    );
    expect(maxSeriesValue(series)).toBe(20);
  });

  it('renvoie 0 pour un tableau de séries vide', () => {
    expect(maxSeriesValue([])).toBe(0);
  });
});
