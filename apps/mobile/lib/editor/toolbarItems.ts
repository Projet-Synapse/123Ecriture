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
//
// SOMMAIRE :
//   1. Types
//   2. Construction des items de la barre des notes
//   3. Effet d'un appui
//
//////////////////////////////////////////////////////////////////////////////

import type { FormattingResult, Selection } from './mdxFormatting';
import { NOTES_TOOLBAR_ACTIONS, type NotesToolbarGroup, type ToolbarAction } from './notesToolbarActions';

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
  // Séparateur vertical entre groupes : label/id ignorés.
  divider?: boolean;
  // Action DÉLÉGUÉE : l'appelant reçoit l'item et exécute l'action.
  run?: ToolbarRun;
};

//////// 2. Construction des items de la barre des notes /////////////////////

export function buildNotesToolbarItems(groups: NotesToolbarGroup[]): ToolbarItem[] {
  const items: ToolbarItem[] = [];
  groups.forEach((group, groupIndex) => {
    if (groupIndex > 0) items.push({ id: `divider-${group.id}`, label: '', divider: true });
    const resolved = group.buttons
      .map((id) => NOTES_TOOLBAR_ACTIONS.find((action) => action.id === id))
      .filter((action): action is ToolbarAction => Boolean(action));
    const runOf = (action: ToolbarAction): ToolbarRun => ({ id: action.id, formatRun: action.run });
    if (group.collapsible) {
      items.push({
        id: `group-${group.id}`,
        label: group.label,
        subItems: resolved.map((action) => ({ id: action.id, label: action.label, run: runOf(action) })),
      });
    } else {
      resolved.forEach((action, index) => {
        if (index > 0) items.push({ id: `divider-${group.id}-${index}`, label: '', divider: true });
        items.push({ id: action.id, label: action.label, run: runOf(action) });
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
