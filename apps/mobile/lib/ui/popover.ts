// ✒️ 123ECRITURE — lib/ui/popover.ts — placement et fond des menus déroulants
//////////////////////////////////////////////////////////////////////////////
//
// Menus déroulants rendus en SURCOUCHE (Modal transparent + fond qui capte
// les clics), au-dessus de TOUT — plus en `position: 'absolute'` dans la
// ligne, où les lignes suivantes passaient par-dessus (zIndex limité à son
// contexte d'empilement) et où le fond des panneaux, translucide quand
// l'apparence le règle, laissait voir et cliquer les boutons derrière
// (signalé 2026-11-16, Gestion des propriétés). Fonctions PURES, testées.
//
//////////////////////////////////////////////////////////////////////////////

import { parseColor } from '../theme/explorerColors';

export type Rect = { x: number; y: number; width: number; height: number };

// Position du menu sous l'ancre, aligné à droite de l'ancre ; au-dessus si
// la place manque en bas ; toujours dans l'écran (marge `margin`).
export function placePopover(
  anchor: Rect,
  menu: { width: number; height: number },
  viewport: { width: number; height: number },
  margin = 8,
  gap = 4,
): { left: number; top: number; maxHeight: number } {
  const maxLeft = Math.max(margin, viewport.width - menu.width - margin);
  const left = Math.min(maxLeft, Math.max(margin, anchor.x + anchor.width - menu.width));
  const below = anchor.y + anchor.height + gap;
  const spaceBelow = viewport.height - below - margin;
  const spaceAbove = anchor.y - gap - margin;
  if (menu.height <= spaceBelow || spaceBelow >= spaceAbove) {
    return { left, top: below, maxHeight: Math.max(80, spaceBelow) };
  }
  const height = Math.min(menu.height, spaceAbove);
  return { left, top: Math.max(margin, anchor.y - gap - height), maxHeight: Math.max(80, spaceAbove) };
}

// Fond PLEIN : une couleur rgba (panneaux translucides) perd son alpha ;
// illisible → `fallback`.
export function solidColor(color: string | undefined, fallback: string): string {
  const rgb = parseColor(color);
  if (!rgb) return fallback;
  return '#' + [rgb.r, rgb.g, rgb.b].map((n) => Math.round(n).toString(16).padStart(2, '0')).join('');
}
