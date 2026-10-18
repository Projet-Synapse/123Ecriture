// ✒️ 123ECRITURE — lib/editor/sheets.ts — logique du module Graphiques (tableur → séries)
//////////////////////////////////////////////////////////////////////////////
//
// Logique pure du module Graphiques (tableur → séries de graphique) —
// séparée du rendu pour rester testable, comme lib/sync/diff.ts.
//
// Invariants du fichier :
//   • Une cellule non numérique dans une colonne utilisée comme VALEURS
//     vaut 0, pas une erreur — un tableur a légitimement des cellules
//     vides ou du texte pendant qu'on le remplit ; la virgule décimale
//     (convention française) est acceptée en plus du point.
//   • buildChartSeries renvoie un tableau VIDE si la config est incomplète
//     (pas encore de colonne étiquettes/valeurs choisie) plutôt que de
//     planter.
//   • maxSeriesValue sert à l'échelle commune des barres/lignes : UN SEUL
//     axe, jamais un axe par série.
//
// SOMMAIRE :
//   1. Types des séries
//   2. Lecture des cellules et construction des séries
//   3. Échelle commune (maxSeriesValue)
//
//////////////////////////////////////////////////////////////////////////////

//////// 1. Types des séries //////////////////////////////////////////////////

export type ChartPoint = {
  label: string;
  value: number;
};

export type ChartSeries = {
  seriesId: string;
  seriesName: string;
  points: ChartPoint[];
};

//////// 2. Lecture des cellules et construction des séries ////////////////////

// Une cellule non numérique dans une colonne utilisée comme VALEURS est
// traitée comme 0, pas une erreur — un tableur a légitimement des cellules
// vides ou du texte pendant qu'on le remplit. La virgule décimale
// (convention française) est acceptée en plus du point.
export function parseNumericCell(raw: string | undefined): number {
  if (!raw) return 0;
  const normalized = raw.replace(',', '.').trim();
  const value = Number(normalized);
  return Number.isFinite(value) ? value : 0;
}

// Construit les séries de points prêts à dessiner à partir des données
// brutes de la feuille + la config du graphique choisie. Renvoie un
// tableau vide si la config est incomplète (pas encore de colonne
// étiquettes/valeurs choisie) plutôt que de planter.
export function buildChartSeries(data: SheetData): ChartSeries[] {
  const chart = data.chart;
  if (!chart || !chart.labelColumnId || chart.valueColumnIds.length === 0) return [];

  return chart.valueColumnIds
    .filter((columnId) => data.columns.some((c) => c.id === columnId))
    .map((columnId) => {
      const column = data.columns.find((c) => c.id === columnId);
      return {
        seriesId: columnId,
        seriesName: column?.name ?? '',
        points: data.rows.map((row) => ({
          label: row.cells[chart.labelColumnId as string] ?? '',
          value: parseNumericCell(row.cells[columnId]),
        })),
      };
    });
}

//////// 3. Échelle commune (maxSeriesValue) ///////////////////////////////////

// Plus grande valeur toutes séries confondues — sert à l'échelle commune
// des barres/lignes (UN SEUL axe, jamais un axe par série).
export function maxSeriesValue(series: ChartSeries[]): number {
  let max = 0;
  for (const s of series) {
    for (const point of s.points) {
      if (point.value > max) max = point.value;
    }
  }
  return max;
}
