import { describe, expect, it } from 'vitest';

import {
  DEFAULT_NOTES_TOOLBAR_GROUPS,
  NOTES_TOOLBAR_ACTION_IDS,
  NOTES_TOOLBAR_ACTIONS,
  NOTES_TOOLBAR_DESCRIPTIONS,
  normalizeNotesToolbarGroups,
  type ToolbarActionId,
} from './notesToolbarActions';
import {
  buildNotesToolbarItems,
  compactSubMenuSize,
  TOOLBAR_TOUCH_TARGET,
  NOTES_TOOLBAR_CATALOG,
  notesToolbarChipLabels,
  notesToolbarReserve,
  toolbarPressEffect,
} from './toolbarItems';

describe('buildNotesToolbarItems', () => {
  it('les sous-boutons d’un groupe dépliant (Titres → H1…H6) portent une action', () => {
    const items = buildNotesToolbarItems([
      { id: 'titres', label: 'Titres', collapsible: true, buttons: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] },
    ]);
    expect(items).toHaveLength(1);
    const group = items[0];
    expect(group.subItems?.map((sub) => sub.id)).toEqual(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
    for (const sub of group.subItems ?? []) {
      expect(sub.run?.id).toBe(sub.id);
      expect(typeof sub.run?.formatRun).toBe('function');
      expect(toolbarPressEffect(sub)).toBe('run');
    }
    expect(group.subItems?.[1].run?.formatRun?.('Titre', { start: 0, end: 0 }).text).toBe('## Titre');
  });

  it('boutons à plat et séparateurs inchangés', () => {
    const items = buildNotesToolbarItems([
      { id: 'a', label: 'A', collapsible: false, buttons: ['bold', 'italic'] },
      { id: 'b', label: 'B', collapsible: false, buttons: ['link'] },
    ]);
    expect(items.map((item) => item.id)).toEqual(['bold', 'divider-a-1', 'italic', 'divider-b', 'link']);
    expect(items[0].run?.id).toBe('bold');
    expect(items[1].divider).toBe(true);
  });

  it('groupes par défaut : aucun bouton sans action', () => {
    const items = buildNotesToolbarItems(DEFAULT_NOTES_TOOLBAR_GROUPS);
    const leaves = items.flatMap((item) => (item.subItems ? item.subItems : item.divider ? [] : [item]));
    expect(leaves.length).toBeGreaterThan(0);
    expect(leaves.every((leaf) => toolbarPressEffect(leaf) === 'run')).toBe(true);
  });

  it('ignore les identifiants inconnus', () => {
    const items = buildNotesToolbarItems([{ id: 'x', label: 'X', collapsible: true, buttons: ['h1', 'nope' as never] }]);
    expect(items[0].subItems?.map((sub) => sub.id)).toEqual(['h1']);
  });
});

describe('toolbarPressEffect', () => {
  it('groupe → dépliage, run → délégation, onPress → appel, sinon rien', () => {
    expect(toolbarPressEffect({ id: 'g', label: 'G', subItems: [] })).toBe('toggle-group');
    expect(toolbarPressEffect({ id: 'b', label: 'B', run: { id: 'bold' } })).toBe('run');
    expect(toolbarPressEffect({ id: 'p', label: 'P', onPress: () => undefined })).toBe('press');
    expect(toolbarPressEffect({ id: 'n', label: 'N' })).toBe('none');
  });
});

describe('cohérence Paramètres ↔ barre de l’éditeur', () => {
  const leavesOf = (groups: Parameters<typeof buildNotesToolbarItems>[0]) =>
    buildNotesToolbarItems(groups)
      .flatMap((item) => (item.subItems ? item.subItems : item.divider ? [] : [item]))
      .map((leaf) => leaf.id);

  it('chaque bouton existant a un nom, un glyphe, et figure une seule fois dans les groupes par défaut', () => {
    const ids = NOTES_TOOLBAR_ACTIONS.map((action) => action.id);
    expect(NOTES_TOOLBAR_CATALOG.map((entry) => entry.id)).toEqual(ids);
    for (const entry of NOTES_TOOLBAR_CATALOG) {
      expect(entry.description, entry.id).toBeTruthy();
      expect(entry.glyph, entry.id).toBeTruthy();
    }
    expect(Object.keys(NOTES_TOOLBAR_DESCRIPTIONS).sort()).toEqual([...ids].sort());
    const placed = DEFAULT_NOTES_TOOLBAR_GROUPS.flatMap((group) => group.buttons);
    expect([...placed].sort()).toEqual([...ids].sort());
    expect(new Set(placed).size).toBe(placed.length);
  });

  it('barre = boutons des groupes, réserve = tous les autres (partition exacte)', () => {
    const groups = normalizeNotesToolbarGroups(
      [
        { id: 'a', label: 'A', collapsible: true, buttons: ['h1', 'h2'] },
        { id: 'vide', label: 'Vide', collapsible: false, buttons: [] },
        { id: 'b', label: 'B', collapsible: false, buttons: ['bold', 'link'] },
      ],
      NOTES_TOOLBAR_ACTION_IDS,
    );
    const shown = leavesOf(groups);
    const reserve = notesToolbarReserve(groups);
    expect(shown).toEqual(['h1', 'h2', 'bold', 'link']);
    expect([...shown, ...reserve].sort()).toEqual([...NOTES_TOOLBAR_ACTION_IDS].sort());
    expect(shown.filter((id) => (reserve as string[]).includes(id))).toEqual([]);
    // Groupe vide : aucun séparateur orphelin.
    expect(buildNotesToolbarItems(groups).filter((item) => item.divider).map((item) => item.id)).toEqual([
      'divider-b',
      'divider-b-1',
    ]);
  });

  it('entrées fantômes (id inconnu) et doublons retirés', () => {
    const groups = normalizeNotesToolbarGroups(
      [
        { id: 'a', label: 'A', collapsible: false, buttons: ['heading-group' as never, 'bold', 'bold'] },
        { id: 'b', label: 'B', collapsible: false, buttons: ['bold', 'nope' as never, 'italic'] },
      ],
      NOTES_TOOLBAR_ACTION_IDS,
    );
    expect(groups.map((group) => group.buttons)).toEqual([['bold'], ['italic']]);
  });

  it('migration : bouton nouveau ajouté visible, bouton masqué par l’utilisatrice reste masqué', () => {
    const stored = [{ id: 'a', label: 'A', collapsible: false, buttons: ['bold'] as ToolbarActionId[] }];
    // Préférences d'avant le champ `notesToolbarKnownButtons` : tout ce qui
    // manque est nouveau → visible (comportement d'avant).
    expect(normalizeNotesToolbarGroups(stored)[0].buttons).toEqual([
      'bold',
      ...NOTES_TOOLBAR_ACTION_IDS.filter((id) => id !== 'bold'),
    ]);
    // Tous connus sauf 'lint' (bouton « nouveau ») : seul lint revient.
    const known = NOTES_TOOLBAR_ACTION_IDS.filter((id) => id !== 'lint');
    expect(normalizeNotesToolbarGroups(stored, known)[0].buttons).toEqual(['bold', 'lint']);
    // Tous connus : rien n'est rajouté, le masquage tient.
    expect(normalizeNotesToolbarGroups(stored, NOTES_TOOLBAR_ACTION_IDS)[0].buttons).toEqual(['bold']);
  });

  it('libellés de Paramètres = glyphe du bouton + nom', () => {
    const labels = notesToolbarChipLabels();
    expect(labels.bold).toBe('G  Gras');
    expect(Object.keys(labels)).toEqual(NOTES_TOOLBAR_ACTION_IDS);
  });
});

describe('mode compact (mobile)', () => {
  it('menu d’un groupe : une rangée quand elle tient dans l’écran', () => {
    const size = compactSubMenuSize(6, 400);
    expect(size.height).toBe(TOOLBAR_TOUCH_TARGET + 14);
    expect(size.width).toBeLessThanOrEqual(400 - 16);
    expect(size.width).toBeGreaterThanOrEqual(6 * TOOLBAR_TOUCH_TARGET);
  });

  it('écran étroit : plusieurs rangées, jamais plus large que l’écran', () => {
    const size = compactSubMenuSize(6, 200);
    expect(size.width).toBeLessThanOrEqual(200 - 16);
    expect(size.height).toBeGreaterThan(TOOLBAR_TOUCH_TARGET + 14);
  });

  it('cible tactile d’au moins 40', () => {
    expect(TOOLBAR_TOUCH_TARGET).toBeGreaterThanOrEqual(40);
    expect(compactSubMenuSize(0, 400).width).toBeGreaterThan(TOOLBAR_TOUCH_TARGET);
  });
});
