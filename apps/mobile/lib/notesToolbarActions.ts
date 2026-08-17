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
// et par Paramètres (components/settings/EditorSection.tsx, pour proposer
// de réordonner/masquer chaque bouton). Les préférences ne stockent que des
// ids (voir apps/desktop/electron/preferences.ts) ; ce fichier est la seule
// source de vérité sur ce qu'un id représente concrètement.

export type ToolbarActionId =
  | 'heading-group'
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
  // Absent uniquement pour 'heading-group' (voir subActions) — un bouton
  // normal exécute directement `run` au clic.
  run?: (text: string, selection: Selection) => FormattingResult;
  // "Groupe" façon plugin Editing Toolbar d'Obsidian (voir
  // .claude/References/Sources.md §11) : un seul bouton dans la barre qui,
  // au clic, déploie ces sous-actions au lieu d'en exécuter une
  // directement — voir EditorToolbar.tsx. Les sous-actions ne sont PAS
  // individuellement réordonnables/masquables dans Paramètres (un seul id
  // de groupe dans `notesToolbarOrder`) : un ensemble fixe pour l'instant,
  // à revoir si un vrai besoin de personnalisation par niveau de titre
  // apparaît.
  subActions?: { id: string; label: string; run: (text: string, selection: Selection) => FormattingResult }[];
};

export const NOTES_TOOLBAR_ACTIONS: ToolbarAction[] = [
  {
    id: 'heading-group',
    label: 'H',
    subActions: ([1, 2, 3, 4, 5, 6] as const).map((level) => ({
      id: `h${level}`,
      label: `H${level}`,
      run: (text: string, sel: Selection) => applyHeading(text, sel, level),
    })),
  },
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
  'heading-group': 'Titres (H1-H6)',
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
