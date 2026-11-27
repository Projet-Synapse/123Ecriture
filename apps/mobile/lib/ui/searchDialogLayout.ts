// ✒️ 123ECRITURE — lib/ui/searchDialogLayout.ts — dimensions de la boîte de recherche
//////////////////////////////////////////////////////////////////////////////
//
// Calcul pur (testé) de la place de la boîte de recherche (SearchDialog) :
//   • écran étroit (téléphone, < 600 px) : PLEINE LARGEUR avec marges,
//     collée en HAUT (sous la barre d'état), hauteur bornée par le
//     clavier ouvert (#247) — champ, liste et « Fermer » restent visibles ;
//   • écran large : boîte centrée de 480 px max, jamais plus large que la
//     fenêtre moins les marges.
// Avant v0.4.100 la boîte faisait 480 px fixes : sur un Galaxy A13
// (~384 px de large) elle débordait des deux côtés.
//
//////////////////////////////////////////////////////////////////////////////

export const SEARCH_DIALOG_COMPACT_BREAKPOINT = 600;
const MARGIN = 12;

export type SearchDialogLayout = {
  compact: boolean;
  width: number;
  maxHeight: number;
  paddingTop: number;
  paddingBottom: number;
};

export function searchDialogLayout(input: {
  windowWidth: number;
  windowHeight: number;
  keyboardHeight?: number;
  statusBarHeight?: number;
}): SearchDialogLayout {
  const keyboard = Math.max(0, input.keyboardHeight ?? 0);
  const compact = input.windowWidth < SEARCH_DIALOG_COMPACT_BREAKPOINT;
  const width = Math.max(0, compact ? input.windowWidth - 2 * MARGIN : Math.min(480, input.windowWidth - 2 * MARGIN));
  const paddingTop = compact ? Math.max(0, input.statusBarHeight ?? 0) + MARGIN : MARGIN;
  const paddingBottom = keyboard + MARGIN;
  const available = input.windowHeight - paddingTop - paddingBottom;
  const maxHeight = Math.max(160, compact ? available : Math.min(520, available));
  return { compact, width, maxHeight, paddingTop, paddingBottom };
}
