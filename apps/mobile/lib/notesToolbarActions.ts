import {
  applyHeading,
  insertLink,
  insertTable,
  toggleLinePrefix,
  toggleNumberedList,
  wrapSelection,
  type FormattingResult,
  type Selection,
} from './mdxFormatting';

// Registre unique des actions de la barre de formatage Notes — utilisé à la
// fois par l'éditeur (components/NotesScreen.tsx, pour exécuter l'action)
// et par Paramètres (components/PersonalizationCard.tsx, pour proposer de
// réordonner/masquer chaque bouton). Les préférences ne stockent que des
// ids (voir apps/desktop/electron/preferences.js) ; ce fichier est la seule
// source de vérité sur ce qu'un id représente concrètement.

export type ToolbarActionId =
  | 'h1'
  | 'h2'
  | 'h3'
  | 'bold'
  | 'italic'
  | 'code'
  | 'quote'
  | 'bullet'
  | 'numbered'
  | 'link'
  | 'table';

export type ToolbarAction = {
  id: ToolbarActionId;
  label: string;
  run: (text: string, selection: Selection) => FormattingResult;
};

export const NOTES_TOOLBAR_ACTIONS: ToolbarAction[] = [
  { id: 'h1', label: 'H1', run: (text, sel) => applyHeading(text, sel, 1) },
  { id: 'h2', label: 'H2', run: (text, sel) => applyHeading(text, sel, 2) },
  { id: 'h3', label: 'H3', run: (text, sel) => applyHeading(text, sel, 3) },
  { id: 'bold', label: 'G', run: (text, sel) => wrapSelection(text, sel, '**') },
  { id: 'italic', label: 'I', run: (text, sel) => wrapSelection(text, sel, '_') },
  { id: 'code', label: '</>', run: (text, sel) => wrapSelection(text, sel, '`') },
  { id: 'quote', label: '❝', run: (text, sel) => toggleLinePrefix(text, sel, '> ') },
  { id: 'bullet', label: '•', run: (text, sel) => toggleLinePrefix(text, sel, '- ') },
  { id: 'numbered', label: '1.', run: (text, sel) => toggleNumberedList(text, sel) },
  { id: 'link', label: '🔗', run: (text, sel) => insertLink(text, sel) },
  { id: 'table', label: '▦', run: (text, sel) => insertTable(text, sel) },
];

// Libellés lisibles pour la liste de réorganisation dans Paramètres (plus
// explicites que les glyphes courts affichés sur les boutons eux-mêmes).
export const NOTES_TOOLBAR_DESCRIPTIONS: Record<ToolbarActionId, string> = {
  h1: 'Titre H1',
  h2: 'Titre H2',
  h3: 'Titre H3',
  bold: 'Gras',
  italic: 'Italique',
  code: 'Code',
  quote: 'Citation',
  bullet: 'Liste à puces',
  numbered: 'Liste numérotée',
  link: 'Lien',
  table: 'Tableau',
};

export const DEFAULT_NOTES_TOOLBAR_ORDER: { id: ToolbarActionId; visible: boolean }[] =
  NOTES_TOOLBAR_ACTIONS.map((action) => ({ id: action.id, visible: true }));
