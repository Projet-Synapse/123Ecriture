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
// fois par l'éditeur (components/NotesScreen.tsx, pour exécuter l'action et
// câbler les raccourcis clavier, voir `shortcut` ci-dessous) et par
// Paramètres (components/settings/EditorSection.tsx, pour proposer de
// réordonner/masquer chaque bouton). Les préférences ne stockent que des
// ids (voir apps/desktop/electron/preferences.ts) ; ce fichier est la seule
// source de vérité sur ce qu'un id représente concrètement.

export type ToolbarActionId =
  | 'h1'
  | 'h2'
  | 'h3'
  | 'h4'
  | 'h5'
  | 'h6'
  | 'bold'
  | 'italic'
  | 'code'
  | 'quote'
  | 'bullet'
  | 'numbered'
  | 'link'
  | 'table'
  | 'attach'
  | 'undo'
  | 'redo';

export type ToolbarAction = {
  id: ToolbarActionId;
  label: string;
  run: (text: string, selection: Selection) => FormattingResult;
  // Raccourci clavier CodeMirror (syntaxe `@codemirror/view` — 'Mod' = Cmd
  // sur macOS / Ctrl ailleurs) câblé dans MdxEditor.tsx et affiché dans
  // Paramètres → Éditeur (voir NOTES_TOOLBAR_SHORTCUT_LABELS).
  shortcut?: string;
};

// Historique : les 6 niveaux de titre vivaient sous un seul bouton "H" qui
// déployait un sous-menu (voir EditorToolbar.tsx, mécanisme `subItems`,
// encore utilisé par ce composant mais plus par Notes). Éclatés en 6 actions
// individuelles pour que chaque niveau soit réordonnable/masquable à part
// dans Paramètres (ex. quelqu'un qui n'utilise jamais H5/H6) — voir aussi
// `normalizeNotesToolbarOrder` plus bas pour la migration d'un ordre déjà
// enregistré avec l'ancien id 'heading-group'.
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
  { id: 'code', label: '</>', run: (text, sel) => wrapSelection(text, sel, '`'), shortcut: 'Mod-e' },
  // Mod-Shift-7/8/9 : suite mnémotechnique liste numérotée/à puces/citation
  // (7/8 reprennent la convention Google Docs/Word pour les listes).
  { id: 'quote', label: '❝', run: (text, sel) => toggleLinePrefix(text, sel, '> '), shortcut: 'Mod-Shift-9' },
  { id: 'bullet', label: '•', run: (text, sel) => toggleLinePrefix(text, sel, '- '), shortcut: 'Mod-Shift-8' },
  { id: 'numbered', label: '1.', run: (text, sel) => toggleNumberedList(text, sel), shortcut: 'Mod-Shift-7' },
  { id: 'link', label: '🔗', run: (text, sel) => insertLink(text, sel), shortcut: 'Mod-k' },
  // Mod-Shift-T : T comme Tableau — dernier inséré, aucun conflit avec la
  // suite Mod-Shift-7/8/9 ni avec les raccourcis navigateur utiles (web,
  // Ctrl+T ouvre un onglet MAIS l'éditeur intercepte via Prec.highest /
  // preventDefault avant ; en Electron, fenêtre de l'app, pas d'onglets).
  { id: 'table', label: '▦', run: (text, sel) => insertTable(text, sel), shortcut: 'Mod-Shift-t' },
  // Pièce jointe : PAS une transformation de texte (ouvre le sélecteur de
  // fichier et insère ![[nom]] au curseur) — NotesScreen branche l'id sur
  // handleInsertAttachment ; run ici reste identitaire pour le type.
  { id: 'attach', label: '📎', run: (text, sel) => ({ text, selection: sel }) },
  // Annuler/Rétablir : commandes CodeMirror natives (EditorView) — idem,
  // NotesScreen branche sur undo/redo de @codemirror/commands.
  { id: 'undo', label: '↩', run: (text, sel) => ({ text, selection: sel }) },
  { id: 'redo', label: '↪', run: (text, sel) => ({ text, selection: sel }) },
];

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
  code: 'Code',
  quote: 'Citation',
  bullet: 'Liste à puces',
  numbered: 'Liste numérotée',
  link: 'Lien',
  table: 'Tableau',
  attach: 'Pièce jointe',
  undo: 'Annuler',
  redo: 'Rétablir',
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

// Migration d'un ordre déjà enregistré sur disque (voir PreferencesContext,
// chargé via window.preferences) : une préférence sauvegardée AVANT
// l'éclatement du groupe "H" contient encore l'id 'heading-group' au lieu
// des 6 ids h1..h6. Sans cette conversion, ce bouton disparaîtrait
// silencieusement de la barre (NOTES_TOOLBAR_ACTIONS ne le connaît plus) —
// on le remplace par les 6 niveaux, à la même position, avec la même
// visibilité. Ajoute aussi en fin de liste toute action absente de l'ordre
// stocké (même logique que le merge `{...DEFAULT_PREFERENCES, ...stored}` :
// un futur nouveau bouton doit apparaître visible plutôt que masqué).
//
// Dédoublonnage : un ordre réel observé en prod contenait les niveaux
// individuels ET le groupe restant en fin ([h1, h3, h2, …, heading-group]) —
// l'expansion dupliquait alors h1/h2/h3 (boutons en double dans la barre +
// warning React "two children with the same key"). On garde la PREMIÈRE
// occurrence (celle que l'utilisatrice a positionnée elle-même), la
// position du groupe n'apportant rien par définition.
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


// //3. 🗂️ GROUPES DE LA BARRE D'OUTILS (v0.4.43)
// ////////////////////////////////////////////////////////////////////////
// La barre est composée de CONTENEURS ordonnés : chaque groupe a un nom,
// peut être dépliant (un bouton qui déploie ses boutons au survol/appui)
// ou déplié en permanence (boutons côte à côte), et porte ses boutons dans
// l'ordre. Un boutonAbsent des groupes = masqué de la barre (choix façon
// Obsidian : on choisit ce qui est présent) — il reste proposé dans la
// réserve de Paramètres pour être (re)placé par glisser-déposer.

export type NotesToolbarGroup = {
  id: string;
  label: string;
  // Dépliant : un seul bouton (libellé du groupe) qui déploie sa rangée au
  // survol (PC) / à l'appui (tactile). Non dépliant : boutons côte à côte.
  collapsible: boolean;
  buttons: ToolbarActionId[];
};

export const DEFAULT_NOTES_TOOLBAR_GROUPS: NotesToolbarGroup[] = [
  { id: 'titres', label: 'Titres', collapsible: true, buttons: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] },
  { id: 'mise-en-forme', label: 'Mise en forme', collapsible: false, buttons: ['undo', 'redo', 'bold', 'italic', 'code', 'quote'] },
  { id: 'listes-liens', label: 'Listes & liens', collapsible: false, buttons: ['bullet', 'numbered', 'link'] },
  { id: 'divers', label: 'Divers', collapsible: false, buttons: ['table', 'attach'] },
];

// Migration : construit les groupes depuis l'ANCIEN ordre plat ({id,
// visible, group?}) en respectant les choix de l'utilisatrice — boutons
// masqués restés hors barre, noms de groupes d'alors devenus de vrais
// groupes dépliants, boutons nouveaux (attach/undo/redo) ajoutés au
// dernier groupe. Appelée par PreferencesContext quand la préférence
// notesToolbarGroups n'existe pas encore sur disque.
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

// Complète les groupes stockés : tout bouton d'action inconnu des groupes
// (nouvelle version) rejoint le dernier groupe — même contrat que
// normalizeNotesToolbarOrder pour l'ancien format.
export function normalizeNotesToolbarGroups(groups: NotesToolbarGroup[]): NotesToolbarGroup[] {
  const placed = new Set(groups.flatMap((group) => group.buttons));
  const missing = NOTES_TOOLBAR_ACTIONS.filter((action) => !placed.has(action.id));
  if (missing.length === 0) return groups;
  const next = groups.map((group) => ({ ...group, buttons: [...group.buttons] }));
  const last = next[next.length - 1];
  if (last) last.buttons.push(...missing.map((action) => action.id));
  else next.push({ id: 'divers', label: 'Divers', collapsible: false, buttons: missing.map((action) => action.id) });
  return next;
}
