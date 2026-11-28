// ✒️ 123ECRITURE — lib/editor/notesToolbarActions.ts — registre de la barre de formatage Notes
//////////////////////////////////////////////////////////////////////////////
//
// Registre unique des actions de la barre de formatage Notes — utilisé à
// la fois par l'éditeur (components/NotesScreen.tsx, pour exécuter
// l'action et câbler les raccourcis clavier) et par Paramètres
// (components/settings/EditorSection.tsx, pour proposer de réordonner/
// masquer chaque bouton).
//
// Invariants du fichier :
//   • Les préférences ne stockent que des ids (voir
//     apps/desktop/electron/preferences.ts) ; ce fichier est la seule
//     source de vérité sur ce qu'un id représente concrètement.
//   • Les actions SANS transformation de texte (attach/undo/redo/
//     template/lint) gardent un `run` identitaire pour le type — l'id est
//     branché sur le vrai handler côté NotesScreen.
//   • Toute normalisation d'ordre ou de groupes ajoute en bout les
//     actions inconnues de la préférence stockée, VISIBLES : un futur
//     bouton doit apparaître plutôt que manquer, et une action existante
//     ne disparaît jamais en silence.
//
// SOMMAIRE :
//   1. Le registre des actions (ids, run, raccourcis clavier)
//   2. Libellés et raccourcis lisibles pour Paramètres
//   3. Normalisation de l'ordre plat (migration 'heading-group')
//   4. Groupes de la barre d'outils (conteneurs ordonnés)
//
//////////////////////////////////////////////////////////////////////////////

import {
  applyAlignment,
  applyHeading,
  insertLink,
  insertTable,
  toggleLinePrefix,
  toggleNumberedList,
  toggleWrap,
  wrapSelection,
  type FormattingResult,
  type Selection,
} from './mdxFormatting';

//////// 1. Le registre des actions (ids, run, raccourcis clavier) /////////////

export type ToolbarActionId =
  | 'h1'
  | 'h2'
  | 'h3'
  | 'h4'
  | 'h5'
  | 'h6'
  | 'bold'
  | 'italic'
  | 'strike'
  | 'underline'
  | 'code'
  | 'quote'
  | 'bullet'
  | 'numbered'
  | 'link'
  | 'table'
  | 'attach'
  | 'undo'
  | 'redo'
  | 'template'
  | 'lint'
  | 'align-left'
  | 'align-center'
  | 'align-right'
  | 'align-justify';

export type ToolbarAction = {
  id: ToolbarActionId;
  label: string;
  run: (text: string, selection: Selection) => FormattingResult;
  // Raccourci clavier CodeMirror (syntaxe `@codemirror/view` — 'Mod' = Cmd
  // sur macOS / Ctrl ailleurs) câblé dans MdxEditor.tsx et affiché dans
  // Paramètres → Éditeur (voir NOTES_TOOLBAR_SHORTCUT_LABELS).
  shortcut?: string;
};

// Les 6 niveaux de titre sont des actions INDIVIDUELLES (pas un bouton
// "H" à sous-menu — le mécanisme `subItems` d'EditorToolbar.tsx reste
// utilisé par ce composant mais plus par Notes) pour que chaque niveau
// soit réordonnable/masquable à part dans Paramètres (ex. quelqu'un qui
// n'utilise jamais H5/H6) — voir `normalizeNotesToolbarOrder` plus bas
// pour la migration d'un ordre déjà enregistré avec l'ancien id
// 'heading-group'.
const HEADING_ACTIONS: ToolbarAction[] = ([1, 2, 3, 4, 5, 6] as const).map((level) => ({
  id: `h${level}` as ToolbarActionId,
  label: `H${level}`,
  run: (text: string, sel: Selection) => applyHeading(text, sel, level),
  shortcut: `Mod-${level}`,
}));

export const NOTES_TOOLBAR_ACTIONS: ToolbarAction[] = [
  ...HEADING_ACTIONS,
  { id: 'bold', label: 'G', run: (text, sel) => wrapSelection(text, sel, '**'), shortcut: 'Mod-b' },
  { id: 'italic', label: 'I', run: (text, sel) => wrapSelection(text, sel, '_'), shortcut: 'Mod-i' },
  // Barré (GFM, compris par Obsidian) et souligné (HTML <u>, seul moyen en
  // Markdown, rendu par Obsidian) — bascules. Mod-u : remplace le
  // « annuler la sélection » de CodeMirror (rarement utilisé) ; Mod-Shift-x
  // est libre (Électron/Chromium n'y associent rien).
  { id: 'strike', label: 'S̶', run: (text, sel) => toggleWrap(text, sel, '~~', '~~'), shortcut: 'Mod-Shift-x' },
  { id: 'underline', label: 'U̲', run: (text, sel) => toggleWrap(text, sel, '<u>', '</u>'), shortcut: 'Mod-u' },
  { id: 'code', label: '</>', run: (text, sel) => wrapSelection(text, sel, '`'), shortcut: 'Mod-e' },
  // Mod-Shift-7/8/9 : suite mnémotechnique liste numérotée/à puces/citation
  // (7/8 reprennent la convention Google Docs/Word pour les listes).
  { id: 'quote', label: '❝', run: (text, sel) => toggleLinePrefix(text, sel, '> '), shortcut: 'Mod-Shift-9' },
  { id: 'bullet', label: '•', run: (text, sel) => toggleLinePrefix(text, sel, '- '), shortcut: 'Mod-Shift-8' },
  { id: 'numbered', label: '1.', run: (text, sel) => toggleNumberedList(text, sel), shortcut: 'Mod-Shift-7' },
  { id: 'link', label: '🔗', run: (text, sel) => insertLink(text, sel), shortcut: 'Mod-k' },
  // Mod-Shift-T : T comme Tableau — aucun conflit avec la suite
  // Mod-Shift-7/8/9 ni avec les raccourcis navigateur utiles : l'éditeur
  // intercepte via Prec.highest / preventDefault avant (en Electron,
  // fenêtre de l'app, pas d'onglets).
  { id: 'table', label: '▦', run: (text, sel) => insertTable(text, sel), shortcut: 'Mod-Shift-t' },
  // Pièce jointe : PAS une transformation de texte (ouvre le sélecteur de
  // fichier et insère ![[nom]] au curseur) — NotesScreen branche l'id sur
  // handleInsertAttachment ; run ici reste identitaire pour le type.
  { id: 'attach', label: '📎', run: (text, sel) => ({ text, selection: sel }) },
  // Annuler/Rétablir : commandes CodeMirror natives (EditorView) — idem,
  // NotesScreen branche sur undo/redo de @codemirror/commands.
  { id: 'undo', label: '↩', run: (text, sel) => ({ text, selection: sel }) },
  { id: 'redo', label: '↪', run: (text, sel) => ({ text, selection: sel }) },
  // Modèle : ouvre le sélecteur de modèles du coffre (NotesScreen branche
  // l'id sur showTemplateMenu) — pas une transformation de texte.
  { id: 'template', label: '📋', run: (text, sel) => ({ text, selection: sel }) },
  // Linter : normalisation conservatrice (voir lib/markdownLinter.ts) —
  // branché sur handleChangeContent(lintMarkdown(...)) côté NotesScreen.
  { id: 'lint', label: '✨', run: (text, sel) => ({ text, selection: sel }) },
  // Alignement du/des paragraphe(s) visé(s) : enveloppe HTML compatible
  // Obsidian (voir applyAlignment). « Gauche » retire l'enveloppe.
  // Pas de raccourci : Ctrl+Maj+R/I/J sont pris par Electron/Chromium
  // (rechargement, outils de développement) et Ctrl+E est déjà « code ».
  { id: 'align-left', label: '⇤', run: (text, sel) => applyAlignment(text, sel, 'left') },
  { id: 'align-center', label: '↔', run: (text, sel) => applyAlignment(text, sel, 'center') },
  { id: 'align-right', label: '⇥', run: (text, sel) => applyAlignment(text, sel, 'right') },
  { id: 'align-justify', label: '☰', run: (text, sel) => applyAlignment(text, sel, 'justify') },
];

//////// 2. Libellés et raccourcis lisibles pour Paramètres ////////////////////

// Libellés lisibles pour la liste de réorganisation dans Paramètres (plus
// explicites que les glyphes courts affichés sur les boutons eux-mêmes).
export const NOTES_TOOLBAR_DESCRIPTIONS: Record<ToolbarActionId, string> = {
  h1: 'Titre 1',
  h2: 'Titre 2',
  h3: 'Titre 3',
  h4: 'Titre 4',
  h5: 'Titre 5',
  h6: 'Titre 6',
  bold: 'Gras',
  italic: 'Italique',
  strike: 'Barré',
  underline: 'Souligné',
  code: 'Code',
  quote: 'Citation',
  bullet: 'Liste à puces',
  numbered: 'Liste numérotée',
  link: 'Lien',
  table: 'Tableau',
  attach: 'Pièce jointe',
  undo: 'Annuler',
  redo: 'Rétablir',
  template: 'Insérer un modèle',
  lint: 'Formater le fichier',
  'align-left': 'Aligner à gauche',
  'align-center': 'Centrer',
  'align-right': 'Aligner à droite',
  'align-justify': 'Justifier',
};

// Affichage humain du raccourci (⌘/Ctrl selon la plateforme) pour Paramètres
// → Éditeur — 'Mod' de CodeMirror ne se traduit pas tout seul en glyphe.
function formatShortcutLabel(shortcut: string): string {
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform ?? '');
  const modKey = isMac ? '⌘' : 'Ctrl';
  return shortcut
    .split('-')
    .map((part) => (part === 'Mod' ? modKey : part === 'Shift' ? 'Maj' : part))
    .join('+');
}

export const NOTES_TOOLBAR_SHORTCUT_LABELS: Partial<Record<ToolbarActionId, string>> = Object.fromEntries(
  NOTES_TOOLBAR_ACTIONS.filter((action) => action.shortcut).map((action) => [
    action.id,
    formatShortcutLabel(action.shortcut as string),
  ]),
);

export const DEFAULT_NOTES_TOOLBAR_ORDER: { id: ToolbarActionId; visible: boolean }[] =
  NOTES_TOOLBAR_ACTIONS.map((action) => ({ id: action.id, visible: true }));

//////// 3. Normalisation de l'ordre plat (migration 'heading-group') //////////

// Migration d'un ordre déjà enregistré sur disque (voir
// PreferencesContext, chargé via window.preferences) : une préférence
// sauvegardée avant l'éclatement du groupe "H" contient encore l'id
// 'heading-group' au lieu des 6 ids h1..h6. Sans cette conversion, ce
// bouton disparaîtrait silencieusement de la barre
// (NOTES_TOOLBAR_ACTIONS ne le connaît plus) — il est remplacé par les 6
// niveaux, à la même position, avec la même visibilité. Ajoute aussi en
// fin de liste toute action absente de l'ordre stocké (même logique que
// le merge `{...DEFAULT_PREFERENCES, ...stored}` : un futur nouveau
// bouton doit apparaître visible plutôt que masqué).
//
// Dédoublonnage obligatoire : un ordre contenant à la fois les niveaux
// individuels ET le groupe restant ([h1, h3, h2, …, heading-group])
// dupliquerait h1/h2/h3 à l'expansion (boutons en double dans la barre +
// warning React "two children with the same key"). On garde la PREMIÈRE
// occurrence (celle que l'utilisateur a positionnée), la position du
// groupe n'apportant rien par définition.
export function normalizeNotesToolbarOrder(order: ToolbarItemConfig[]): ToolbarItemConfig[] {
  const expanded: ToolbarItemConfig[] = [];
  // Set<string> (pas ToolbarActionId) : `item.id` vient du disque, qui
  // tolère des ids inconnus/obsolètes ('heading-group' ou pire).
  const seen = new Set<string>();
  const pushUnique = (item: ToolbarItemConfig) => {
    if (seen.has(item.id)) return;
    seen.add(item.id);
    expanded.push(item);
  };
  for (const item of order) {
    if ((item.id as string) === 'heading-group') {
      HEADING_ACTIONS.forEach((heading) => pushUnique({ id: heading.id, visible: item.visible }));
    } else {
      pushUnique(item);
    }
  }
  for (const action of NOTES_TOOLBAR_ACTIONS) {
    if (!seen.has(action.id)) {
      seen.add(action.id);
      expanded.push({ id: action.id, visible: true });
    }
  }
  return expanded;
}


//////// 4. Groupes de la barre d'outils (conteneurs ordonnés) //////////////////

// La barre est composée de CONTENEURS ordonnés : chaque groupe a un nom,
// peut être dépliant (un bouton qui déploie son menu au clic/tap seulement)
// ou ouvert (boutons côte à côte en un bloc, séparateur entre groupes),
// et porte ses boutons dans l'ordre. Un bouton absent des groupes = masqué
// de la barre (choix façon Obsidian : on choisit ce qui est présent) — il
// reste proposé dans la réserve de Paramètres pour être (re)placé.

export type NotesToolbarGroup = {
  id: string;
  label: string;
  // Dépliant : un seul bouton (libellé du groupe) qui déploie son menu au
  // clic/tap (pas au survol). Non dépliant : boutons côte à côte en un bloc.
  collapsible: boolean;
  buttons: ToolbarActionId[];
};

export const DEFAULT_NOTES_TOOLBAR_GROUPS: NotesToolbarGroup[] = [
  { id: 'titres', label: 'Titres', collapsible: true, buttons: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] },
  { id: 'mise-en-forme', label: 'Mise en forme', collapsible: false, buttons: ['undo', 'redo', 'bold', 'italic', 'strike', 'underline', 'code', 'quote'] },
  { id: 'listes-liens', label: 'Listes & liens', collapsible: false, buttons: ['bullet', 'numbered', 'link'] },
  // Modèle et Linter : présents dans la barre depuis toujours (ajoutés en
  // bout par la normalisation) — désormais écrits ici, pour que les
  // défauts décrivent la barre réellement affichée.
  { id: 'divers', label: 'Divers', collapsible: false, buttons: ['table', 'attach', 'template', 'lint'] },
  {
    id: 'alignement',
    label: 'Alignement',
    collapsible: true,
    buttons: ['align-left', 'align-center', 'align-right', 'align-justify'],
  },
];

// Tous les ids de bouton existants (ordre du registre).
export const NOTES_TOOLBAR_ACTION_IDS: ToolbarActionId[] = NOTES_TOOLBAR_ACTIONS.map((action) => action.id);

// Migration : construit les groupes depuis l'ANCIEN ordre plat ({id,
// visible, group?}) — boutons masqués restés hors barre, noms de groupes
// d'alors devenus de vrais groupes dépliants, boutons nouveaux
// (attach/undo/redo) ajoutés au dernier groupe. Appelée par
// PreferencesContext quand la préférence notesToolbarGroups n'existe pas
// encore sur disque.
export function migrateNotesToolbarGroups(order: ToolbarItemConfig[] | undefined): NotesToolbarGroup[] {
  if (!order || order.length === 0) return DEFAULT_NOTES_TOOLBAR_GROUPS.map((group) => ({ ...group, buttons: [...group.buttons] }));
  const groups: NotesToolbarGroup[] = [];
  const byLabel = new Map<string, NotesToolbarGroup>();
  const groupFor = (label: string, collapsible: boolean): NotesToolbarGroup => {
    const existing = byLabel.get(label);
    if (existing) return existing;
    const group: NotesToolbarGroup = { id: label.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'groupe', label, collapsible, buttons: [] };
    groups.push(group);
    byLabel.set(label, group);
    return group;
  };
  for (const item of order) {
    if (!item.visible) continue; // masqué → hors barre (réserve Paramètres)
    const oldGroup = (item as { group?: string }).group?.trim();
    const target = oldGroup ? groupFor(oldGroup, true) : groupFor('Divers', false);
    if (!target.buttons.includes(item.id as ToolbarActionId)) target.buttons.push(item.id as ToolbarActionId);
  }
  // Boutons inconnus de l'ancien ordre (nouveautés de version) : dernier
  // groupe, visibles — un futur bouton doit apparaître plutôt que manquer.
  for (const action of NOTES_TOOLBAR_ACTIONS) {
    if (!groups.some((group) => group.buttons.includes(action.id))) {
      const last = groups[groups.length - 1];
      if (last) last.buttons.push(action.id);
      else groups.push({ id: 'divers', label: 'Divers', collapsible: false, buttons: [action.id] });
    }
  }
  return groups.filter((group) => group.buttons.length > 0 || groups.length === 1);
}

// Met les groupes stockés en accord avec les boutons qui EXISTENT, pour que
// Paramètres et la barre de l'éditeur montrent exactement la même chose :
//   • id inconnu (bouton retiré d'une version, 'heading-group'…) : enlevé —
//     jamais d'entrée fantôme dans Paramètres ;
//   • bouton présent dans deux groupes : gardé à sa première place ;
//   • bouton NOUVEAU (absent de `knownButtons`, la liste des boutons
//     existants lors du dernier enregistrement) : ajouté VISIBLE au
//     dernier groupe ;
//   • bouton déjà connu mais rangé hors barre par l'utilisatrice : reste
//     masqué. (Avant, tout bouton hors groupe revenait au chargement
//     suivant : on ne pouvait rien masquer durablement.)
// Sans `knownButtons` (préférences d'avant ce champ) : tout bouton absent
// est considéré comme nouveau — c'était déjà ce qui s'affichait.
export function normalizeNotesToolbarGroups(
  groups: NotesToolbarGroup[],
  knownButtons?: readonly string[],
): NotesToolbarGroup[] {
  const existing = new Set<string>(NOTES_TOOLBAR_ACTION_IDS);
  const placed = new Set<string>();
  const next = groups.map((group) => ({
    ...group,
    buttons: group.buttons.filter((id) => {
      if (!existing.has(id) || placed.has(id)) return false;
      placed.add(id);
      return true;
    }),
  }));
  const known = new Set(knownButtons ?? []);
  const missing = NOTES_TOOLBAR_ACTION_IDS.filter((id) => !placed.has(id) && !known.has(id));
  for (const id of missing) {
    // Bouton nouveau : dans SON groupe par défaut (ex. « Alignement ») —
    // le groupe est recréé s'il n'existe pas chez l'utilisatrice ; à
    // défaut, dans le dernier groupe.
    const home = DEFAULT_NOTES_TOOLBAR_GROUPS.find((group) => group.buttons.includes(id));
    const target =
      (home && next.find((group) => group.id === home.id)) ??
      (home ? (next[next.push({ ...home, buttons: [] }) - 1] as NotesToolbarGroup) : next[next.length - 1]);
    if (target) target.buttons.push(id);
    else next.push({ id: 'divers', label: 'Divers', collapsible: false, buttons: [id] });
  }
  return next;
}
