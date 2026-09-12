import { describe, expect, it } from 'vitest';

import { scrollTargetForItem } from './useScrollIntoView';

// Seule la fonction pure est testée (voir le commentaire de tête du
// fichier) — le hook lui-même exige un vrai ScrollView.

describe('scrollTargetForItem', () => {
  const item = { y: 200, height: 40 };

  it('retourne null quand viewport inconnu (avant le premier layout)', () => {
    expect(scrollTargetForItem(item, 0, 0)).toBeNull();
  });

  it('retourne null quand l’élément est déjà entièrement visible', () => {
    expect(scrollTargetForItem(item, 0, 300)).toBeNull();
    expect(scrollTargetForItem(item, 180, 300)).toBeNull(); // à cheval sur le bas, mais complet
  });

  it('remonte la liste quand l’élément est AU-DESSUS de la zone visible', () => {
    // scroll 300, viewport 300 (visible 300-600) : item en 200 doit remonter à 200
    expect(scrollTargetForItem(item, 300, 300)).toBe(200);
  });

  it('descend la liste juste ce qu’il faut quand l’élément est EN DESSOUS', () => {
    // scroll 0, viewport 100 : item 200+40=240 > 100 → aligner le bas de l’item sur le bas du viewport
    expect(scrollTargetForItem(item, 0, 100)).toBe(140);
  });
});
