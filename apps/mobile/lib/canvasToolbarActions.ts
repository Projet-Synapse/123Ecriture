// Registre des actions de la barre d'outils Canvas — même principe que
// lib/notesToolbarActions.ts (source de vérité unique pour l'éditeur ET
// Paramètres → Éditeur), mais SANS `run` : contrairement au formatage Notes
// (fonctions pures texte→texte), `addTextCard`/`addNoteCard` sont des
// closures qui dépendent de l'état local de CanvasEditor.tsx (nodes, monde,
// contexte du coffre...). Ce fichier ne porte que les métadonnées (id,
// label, description, ordre par défaut) ; CanvasEditor.tsx fait la
// correspondance id → handler local.
export type CanvasToolbarActionId = 'add-text' | 'add-note';

export type CanvasToolbarAction = {
  id: CanvasToolbarActionId;
  label: string;
};

// Seuls les deux boutons globaux existants aujourd'hui (voir CanvasEditor.tsx,
// `headerRow`) — les actions par carte (supprimer, glisser, connecter) sont
// des interactions contextuelles, pas des entrées de barre d'outils.
export const CANVAS_TOOLBAR_ACTIONS: CanvasToolbarAction[] = [
  { id: 'add-text', label: '+ Texte' },
  { id: 'add-note', label: '+ Note' },
];

export const CANVAS_TOOLBAR_DESCRIPTIONS: Record<CanvasToolbarActionId, string> = {
  'add-text': 'Ajouter une carte texte',
  'add-note': 'Ajouter une carte note',
};

export const DEFAULT_CANVAS_TOOLBAR_ORDER: { id: CanvasToolbarActionId; visible: boolean }[] =
  CANVAS_TOOLBAR_ACTIONS.map((action) => ({ id: action.id, visible: true }));
