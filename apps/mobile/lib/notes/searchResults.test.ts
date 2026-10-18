import { describe, expect, it } from 'vitest';

import { splitMatchSegments } from './searchResults';

// splitMatchSegments — pur, testé séparément du rendu RN (SearchDialog.tsx/
// CommandPalette.tsx appliquent le style, ici on ne vérifie que le découpage).

describe('splitMatchSegments', () => {
  it('marque toutes les occurrences, insensible à la casse', () => {
    expect(splitMatchSegments('Rapport mars — rapport final', 'rapport')).toEqual([
      { text: 'Rapport', isMatch: true },
      { text: ' mars — ', isMatch: false },
      { text: 'rapport', isMatch: true },
      { text: ' final', isMatch: false },
    ]);
  });

  it('requête vide → un seul segment non marqué', () => {
    expect(splitMatchSegments('Recette de crêpes', '')).toEqual([{ text: 'Recette de crêpes', isMatch: false }]);
    expect(splitMatchSegments('Recette de crêpes', '   ')).toEqual([{ text: 'Recette de crêpes', isMatch: false }]);
  });

  it('aucune occurrence → texte entier non marqué', () => {
    expect(splitMatchSegments('Chapitre 1', 'zzz')).toEqual([{ text: 'Chapitre 1', isMatch: false }]);
  });

  it('texte entièrement couvert par la requête → un seul segment marqué', () => {
    expect(splitMatchSegments('note', 'NOTE')).toEqual([{ text: 'note', isMatch: true }]);
  });

  it('occurrences qui se touchent (pas de segment vide entre)', () => {
    expect(splitMatchSegments('abab', 'ab')).toEqual([
      { text: 'ab', isMatch: true },
      { text: 'ab', isMatch: true },
    ]);
  });
});
