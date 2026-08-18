// Logique PURE (sans DOM ni React) du redimensionnement au curseur des
// barres latérales (voir components/ResizeHandle.tsx,
// lib/useResizablePanel.ts) — séparée pour rester testable simplement,
// même esprit que lib/liveDecorations.ts / lib/mdxFormatting.ts.

// Empêche la largeur de dépasser les bornes pendant le glisser.
export function clampWidth(width: number, min: number, max: number): number {
  return Math.min(Math.max(width, min), max);
}

// Repli automatique "au curseur" : si on relâche la poignée avec une
// largeur tombée sous la moitié du minimum, on considère que l'intention
// était de masquer le panneau plutôt que de le laisser à une largeur
// inutilisable. Un simple clic sur le chevron reste le chemin explicite
// pour replier/déplier sans avoir à viser ce seuil au pixel près.
export function shouldCollapseOnRelease(width: number, min: number): boolean {
  return width < min / 2;
}

// Nouvelle largeur pendant le glisser : `edge` inverse le sens du delta
// selon quel bord du panneau porte la poignée (ex. l'explorateur s'élargit
// vers la DROITE quand on tire la poignée vers la droite — edge=1 — alors
// que le panneau droit s'élargit vers la GAUCHE — edge=-1).
export function computeDragWidth(
  startWidth: number,
  startX: number,
  currentX: number,
  edge: 1 | -1,
  min: number,
  max: number,
): number {
  return clampWidth(startWidth + (currentX - startX) * edge, min, max);
}
