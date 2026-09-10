import { describe, expect, it } from 'vitest';

import { buildWikilinkCandidates } from './wikilinkAutocomplete';

// buildWikilinkCandidates — pur, testé séparément de la source CodeMirror
// (la mécanique d'apply/curseur est le même idiome déjà éprouvé de
// occurrenceAutocomplete.ts).

describe('buildWikilinkCandidates', () => {
  const notes = ['Rapport mars', 'Rapport final', 'Recette de crêpes', 'Notes'];

  it('filtre par sous-chaîne insensible à la casse et referme le lien', () => {
    expect(buildWikilinkCandidates(notes, 'rap')).toEqual([
      { name: 'Rapport final', applyText: 'Rapport final]]' },
      { name: 'Rapport mars', applyText: 'Rapport mars]]' },
    ]);
  });

  it('met les correspondances par préfixe avant les simples sous-chaînes', () => {
    const candidates = buildWikilinkCandidates(['Courgettes', 'Recette de courgettes'], 'c');
    expect(candidates.map((c) => c.name)).toEqual(['Courgettes', 'Recette de courgettes']);
  });

  it('fragment vide après [[ → toutes les notes', () => {
    const candidates = buildWikilinkCandidates(notes, '');
    expect(candidates.map((c) => c.name)).toEqual(['Notes', 'Rapport final', 'Rapport mars', 'Recette de crêpes']);
  });

  it('exclut le nom déjà tapé exactement (rien à compléter)', () => {
    expect(buildWikilinkCandidates(notes, 'Notes')).toEqual([]);
    expect(buildWikilinkCandidates(notes, 'notes')).toEqual([]);
  });

  it('conserve l’alias déjà tapée : [[Rap|brouillon → Rapport…|brouillon]]', () => {
    const candidates = buildWikilinkCandidates(notes, 'Rap|brouillon');
    expect(candidates[0]).toEqual({ name: 'Rapport final', applyText: 'Rapport final|brouillon]]' });
  });

  it('dédoublonne les notes de dossiers différents portant le même nom', () => {
    expect(buildWikilinkCandidates(['Journal', 'Journal'], 'Jou')).toEqual([
      { name: 'Journal', applyText: 'Journal]]' },
    ]);
  });

  it('aucune correspondance → liste vide (la source ne proposera rien)', () => {
    expect(buildWikilinkCandidates(notes, 'zzz')).toEqual([]);
  });
});
