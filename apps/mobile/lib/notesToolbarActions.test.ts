import { describe, expect, it } from 'vitest';

import { DEFAULT_NOTES_TOOLBAR_ORDER, normalizeNotesToolbarOrder } from './notesToolbarActions';

// normalizeNotesToolbarOrder — migration de l'ordre de barre stocké sur
// disque (voir PreferencesContext.tsx). Le cas réel qui a motivé le
// dédoublonnage : un ordre contenant les niveaux individuels ET le groupe
// obsolète 'heading-group' en fin (état lu dans un config.json de prod).

describe('normalizeNotesToolbarOrder', () => {
  it('développe le groupe obsolète heading-group en h1..h6', () => {
    const normalized = normalizeNotesToolbarOrder([
      { id: 'heading-group', visible: true },
      { id: 'bold', visible: false },
    ]);
    expect(normalized.slice(0, 7).map((item) => item.id)).toEqual(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'bold']);
    expect(normalized.find((item) => item.id === 'bold')?.visible).toBe(false);
  });

  it('déduplique : niveaux individuels + heading-group restant → un seul exemplaire de chaque', () => {
    // Forme exacte observée dans un config.json réel : h1/h3/h2 déjà
    // individualisés, le groupe resté en fin de liste.
    const normalized = normalizeNotesToolbarOrder([
      ...(['h1', 'h3', 'h2'] as const).map((id) => ({ id, visible: true })),
      ...(['bold', 'italic', 'code', 'quote', 'bullet', 'numbered', 'link', 'table'] as const).map((id) => ({
        id,
        visible: true,
      })),
      { id: 'heading-group', visible: true },
    ]);
    const ids = normalized.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length); // aucun doublon
    expect(ids.slice(0, 3)).toEqual(['h1', 'h3', 'h2']); // l'ordre choisi par l'utilisatrice gagne
  });

  it('ajoute en fin toute action inconnue de l’ordre stocké (futur nouveau bouton)', () => {
    const normalized = normalizeNotesToolbarOrder([{ id: 'bold', visible: true }]);
    expect(normalized.map((item) => item.id).slice(-1)).toEqual(['table']);
    expect(normalized).toHaveLength(DEFAULT_NOTES_TOOLBAR_ORDER.length);
  });
});
