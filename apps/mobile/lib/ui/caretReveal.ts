// ✒️ 123ECRITURE — lib/ui/caretReveal.ts — garder le curseur au-dessus du clavier
//////////////////////////////////////////////////////////////////////////////
//
// Android (edge-to-edge) : le clavier se superpose à l'app sans la
// redimensionner. L'éditeur WebView est en hauteur auto dans un ScrollView
// natif (NativeReadingScroll) : c'est ce ScrollView qui doit défiler pour
// garder le curseur visible, et réserver en bas la hauteur du clavier
// (sinon la fin du fichier reste dessous).
//
// La WebView remonte la position du curseur (message `caret`) ; elle la
// convertit en coordonnées FENÊTRE et appelle `reveal` fourni par le
// ScrollView englobant via CaretRevealContext.
//
//////////////////////////////////////////////////////////////////////////////

import { createContext } from 'react';

export type RevealCaret = (windowTop: number, windowBottom: number) => void;

export const CaretRevealContext = createContext<RevealCaret | null>(null);

// Marge gardée entre le curseur et le haut du clavier / du ScrollView.
export const CARET_MARGIN = 48;

// Espacement bas du contenu : la marge habituelle + la hauteur du clavier
// (de quoi faire remonter la dernière ligne au-dessus du clavier).
export function keyboardBottomPadding(base: number, keyboardHeight: number): number {
  return base + Math.max(0, keyboardHeight);
}

// Nouveau décalage de défilement pour que [caretTop, caretBottom] (fenêtre)
// tienne dans [viewportTop, viewportBottom] (fenêtre, déjà amputé du
// clavier), ou null si déjà visible.
export function revealScrollOffset(input: {
  caretTop: number;
  caretBottom: number;
  viewportTop: number;
  viewportBottom: number;
  scrollOffset: number;
  margin?: number;
}): number | null {
  const margin = input.margin ?? CARET_MARGIN;
  const room = input.viewportBottom - input.viewportTop;
  const m = Math.max(0, Math.min(margin, (room - (input.caretBottom - input.caretTop)) / 2));
  if (input.caretBottom > input.viewportBottom - m) {
    return Math.max(0, input.scrollOffset + input.caretBottom - (input.viewportBottom - m));
  }
  if (input.caretTop < input.viewportTop + m) {
    return Math.max(0, input.scrollOffset - (input.viewportTop + m - input.caretTop));
  }
  return null;
}
