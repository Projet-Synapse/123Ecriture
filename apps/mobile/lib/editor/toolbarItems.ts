// ✒️ 123ECRITURE — lib/editor/toolbarItems.ts — items de la barre d'outils (logique pure)
//////////////////////////////////////////////////////////////////////////////
//
// Types et construction des items affichés par EditorToolbar.tsx, testés
// sans React Native (toolbarItems.test.ts).
//
// Invariants du fichier :
//   • Un bouton d'un groupe DÉPLIANT (ex. « Titres » → H1…H6) porte le
//     même `run` qu'un bouton à plat : l'appui remonte à l'appelant via
//     onItemRun, exactement comme une action visible directement. (Avant,
//     les sous-boutons n'avaient ni `run` ni `onPress` : ils ne faisaient
//     rien, sur toutes les plateformes.)
//   • toolbarPressEffect décide de l'effet d'un appui : déplier/replier un
//     groupe, déléguer l'action (`run`), ou appeler `onPress`.
//   • SOURCE UNIQUE pour la barre de l'éditeur ET Paramètres → Éditeur :
//     le catalogue (NOTES_TOOLBAR_CATALOG) liste tous les boutons qui
//     existent ; la barre affiche exactement les boutons des groupes, la
//     réserve de Paramètres exactement les autres (notesToolbarReserve) —
//     aucun bouton introuvable, aucune entrée fantôme (test de cohérence).
//
// SOMMAIRE :
//   1. Types
//   2. Construction des items de la barre des notes
//   3. Effet d'un appui
//   4. Catalogue et réserve (Paramètres)
//   5. Mode compact (mobile) : cible tactile et taille du menu
//
//////////////////////////////////////////////////////////////////////////////

import type { FormattingResult, Selection } from './mdxFormatting';
import {
  NOTES_TOOLBAR_ACTIONS,
  NOTES_TOOLBAR_DESCRIPTIONS,
  NOTES_TOOLBAR_SHORTCUT_LABELS,
  type NotesToolbarGroup,
  type ToolbarAction,
  type ToolbarActionId,
} from './notesToolbarActions';

//////// 1. Types /////////////////////////////////////////////////////////////

export type ToolbarRun = { id: string; formatRun?: (text: string, selection: Selection) => FormattingResult };

export type ToolbarSubItem = {
  id: string;
  label: string;
  onPress?: () => void;
  // Action DÉLÉGUÉE à l'appelant (onItemRun), comme pour un item à plat.
  run?: ToolbarRun;
};

export type ToolbarItem = {
  id: string;
  label: string;
  onPress?: () => void;
  subItems?: ToolbarSubItem[];
  // Groupe ouvert : boutons côte à côte en un seul bloc (séparateur entre
  // groupes seulement, pas entre chaque bouton).
  cluster?: ToolbarSubItem[];
  // Séparateur vertical entre groupes : label/id ignorés.
  divider?: boolean;
  // Action DÉLÉGUÉE : l'appelant reçoit l'item et exécute l'action.
  run?: ToolbarRun;
};

//////// 2. Construction des items de la barre des notes /////////////////////

export function buildNotesToolbarItems(groups: NotesToolbarGroup[]): ToolbarItem[] {
  const items: ToolbarItem[] = [];
  groups.forEach((group) => {
    const resolved = group.buttons
      .map((id) => NOTES_TOOLBAR_ACTIONS.find((action) => action.id === id))
      .filter((action): action is ToolbarAction => Boolean(action));
    // Groupe vide : rien dans la barre (ni séparateur orphelin, ni bouton
    // dépliant qui ne déplierait rien).
    if (resolved.length === 0) return;
    if (items.length > 0) items.push({ id: `divider-${group.id}`, label: '', divider: true });
    const runOf = (action: ToolbarAction): ToolbarRun => ({ id: action.id, formatRun: action.run });
    if (group.collapsible) {
      items.push({
        id: `group-${group.id}`,
        label: group.label,
        subItems: resolved.map((action) => ({ id: action.id, label: action.label, run: runOf(action) })),
      });
    } else {
      // Groupe ouvert : un bloc unique. Les séparateurs sont posés ENTRE
      // les groupes (ci-dessus), jamais entre les boutons d'un même bloc.
      items.push({
        id: `group-${group.id}`,
        label: group.label,
        cluster: resolved.map((action) => ({ id: action.id, label: action.label, run: runOf(action) })),
      });
    }
  });
  return items;
}

//////// 3. Effet d'un appui /////////////////////////////////////////////////

export type ToolbarPressEffect = 'toggle-group' | 'run' | 'press' | 'none';

export function toolbarPressEffect(item: ToolbarItem | ToolbarSubItem): ToolbarPressEffect {
  if ('subItems' in item && item.subItems) return 'toggle-group';
  if (item.run) return 'run';
  if (item.onPress) return 'press';
  return 'none';
}

//////// 4. Catalogue et réserve (Paramètres) ////////////////////////////////

export type ToolbarCatalogEntry = {
  id: ToolbarActionId;
  // Glyphe affiché sur le bouton de l'éditeur (ex. « G »).
  glyph: string;
  // Nom lisible (ex. « Gras »).
  description: string;
  shortcut?: string;
};

export const NOTES_TOOLBAR_CATALOG: ToolbarCatalogEntry[] = NOTES_TOOLBAR_ACTIONS.map((action) => ({
  id: action.id,
  glyph: action.label,
  description: NOTES_TOOLBAR_DESCRIPTIONS[action.id],
  shortcut: NOTES_TOOLBAR_SHORTCUT_LABELS[action.id],
}));

// Libellé d'une puce de Paramètres : le glyphe du bouton de la barre suivi
// de son nom, pour reconnaître d'un coup d'œil le bouton de l'éditeur.
export function notesToolbarChipLabels(): Record<string, string> {
  return Object.fromEntries(
    NOTES_TOOLBAR_CATALOG.map((entry) => [
      entry.id,
      entry.glyph === entry.description ? entry.description : `${entry.glyph}  ${entry.description}`,
    ]),
  );
}

// Boutons existants rangés dans AUCUN groupe : la réserve « hors barre ».
export function notesToolbarReserve(groups: NotesToolbarGroup[]): ToolbarActionId[] {
  const placed = new Set<string>(groups.flatMap((group) => group.buttons));
  return NOTES_TOOLBAR_CATALOG.map((entry) => entry.id).filter((id) => !placed.has(id));
}

//////// 5. Mode compact (mobile) : cible tactile et taille du menu ///////////

// Côté minimal d'un bouton en mode compact (recommandation Android : 48 dp,
// ici 40 pour garder la ligne fine ; espacement compris, le doigt tombe
// toujours sur un bouton).
export const TOOLBAR_TOUCH_TARGET = 40;
const MENU_GAP = 4;
const MENU_PADDING = 6;

// Taille du menu flottant d'un groupe : une rangée si elle tient dans
// l'écran (marges 8), sinon plusieurs rangées de la largeur disponible.
export function compactSubMenuSize(count: number, viewportWidth: number): { width: number; height: number } {
  const n = Math.max(1, count);
  const cell = TOOLBAR_TOUCH_TARGET + MENU_GAP;
  const maxWidth = Math.max(cell + 2 * MENU_PADDING, viewportWidth - 16);
  const perRow = Math.max(1, Math.min(n, Math.floor((maxWidth - 2 * MENU_PADDING - 2 + MENU_GAP) / cell)));
  const rows = Math.ceil(n / perRow);
  return {
    width: perRow * cell - MENU_GAP + 2 * MENU_PADDING + 2,
    height: rows * cell - MENU_GAP + 2 * MENU_PADDING + 2,
  };
}
