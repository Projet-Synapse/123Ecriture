// Palette catégorielle pour les graphiques — voir la skill `dataviz`. Ordre
// FIXE, jamais cyclé/inventé à la volée : 8 teintes validées avec
// scripts/validate_palette.js de la skill contre les VRAIES couleurs de
// fond de l'app (theme.ts : #ffffff clair, #111114 sombre) — tout passe
// (bande de clarté, plancher de chroma, séparation daltonisme, plancher
// vision normale ; 3 teintes claires — aqua/jaune/magenta — sous 3:1 de
// contraste, donc toujours accompagnées d'un libellé visible en couleur de
// texte du thème, jamais la couleur de la série elle-même comme texte).
export const CHART_PALETTE_LIGHT = [
  '#2a78d6', // bleu
  '#eb6834', // orange
  '#1baf7a', // aqua
  '#eda100', // jaune
  '#e87ba4', // magenta
  '#008300', // vert
  '#4a3aa7', // violet
  '#e34948', // rouge
];

export const CHART_PALETTE_DARK = [
  '#3987e5',
  '#d95926',
  '#199e70',
  '#c98500',
  '#d55181',
  '#008300',
  '#9085e9',
  '#e66767',
];

export function getSeriesColor(index: number, colorScheme: 'light' | 'dark'): string {
  const palette = colorScheme === 'dark' ? CHART_PALETTE_DARK : CHART_PALETTE_LIGHT;
  return palette[index % palette.length];
}
