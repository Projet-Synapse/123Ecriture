import { describe, expect, it } from 'vitest';

import { NOTES_TOOLBAR_ACTIONS, normalizeNotesToolbarOrder } from './notesToolbarActions';

describe('NOTES_TOOLBAR_ACTIONS', () => {
  it('ne définit aucun raccourci en double (chaque combinaison ne doit gagner qu’une action)', () => {
    const shortcuts = NOTES_TOOLBAR_ACTIONS.filter((action) => action.shortcut).map((action) => action.shortcut);
    expect(new Set(shortcuts).size).toBe(shortcuts.length);
  });

  it("l'action barré entoure la sélection de ~~ (même mécanisme que gras/italique)", () => {
    const strikethrough = NOTES_TOOLBAR_ACTIONS.find((action) => action.id === 'strikethrough');
    expect(strikethrough).toBeDefined();
    const result = strikethrough!.run('texte à barrer', { start: 8, end: 14 });
    expect(result.text).toBe('texte à ~~barrer~~');
  });
});

describe('normalizeNotesToolbarOrder', () => {
  it('ajoute en fin de liste une action manquante d’un ordre déjà enregistré (ex. bouton ajouté après coup)', () => {
    const storedBeforeStrikethroughExisted = NOTES_TOOLBAR_ACTIONS.filter((action) => action.id !== 'strikethrough').map(
      (action) => ({ id: action.id, visible: true }),
    );
    const normalized = normalizeNotesToolbarOrder(storedBeforeStrikethroughExisted);
    expect(normalized.some((item) => item.id === 'strikethrough')).toBe(true);
    expect(normalized[normalized.length - 1].id).toBe('strikethrough');
  });
});
