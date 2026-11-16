import { describe, expect, it } from 'vitest';

import { DEFAULT_NOTES_TOOLBAR_GROUPS } from './notesToolbarActions';
import { buildNotesToolbarItems, toolbarPressEffect } from './toolbarItems';

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
