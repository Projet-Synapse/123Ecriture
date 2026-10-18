// ✒️ 123ECRITURE — lib/editor/chartPalette.ts — palette catégorielle des graphiques
//////////////////////////////////////////////////////////////////////////////
//
// Palette catégorielle pour les graphiques (voir la skill `dataviz`).
//
// Invariants du fichier :
//   • Ordre FIXE, jamais cyclé ni inventé à la volée : 8 teintes validées
//     par scripts/validate_palette.js de la skill contre les VRAIES
//     couleurs de fond de l'app (theme.ts : #ffffff clair, #111114
//     sombre) — tout passe (bande de clarté, plancher de chroma,
//     séparation daltonisme, plancher vision normale).
//   • Les 3 teintes claires (aqua/jaune/magenta) sont sous 3:1 de
//     contraste sur le fond : elles servent aux séries, jamais à du
//     texte — un libellé coloré utilise la couleur de texte du thème,
//     pas la couleur de la série elle-même.
//   • getSeriesColor boucle modulo la palette : chaque série reçoit une
//     teinte déterministe selon son index.
//
//////////////////////////////////////////////////////////////////////////////

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
