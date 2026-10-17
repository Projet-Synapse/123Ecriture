import { describe, expect, it } from 'vitest';

import { textChangeDetail, textChangeStats } from './changeStats';

describe('textChangeStats (journal « modification », v0.4.72)', () => {
  it('fichier nouveau : tout compte en ajout, avec le total', () => {
    const stats = textChangeStats(null, 'Bonjour le monde');
    expect(stats).toEqual({ addedChars: 16, removedChars: 0, totalChars: 16 });
  });

  it('compte les ajouts et les suppressions de la modification', () => {
    const stats = textChangeStats('Les Seven protègent le monde.', 'Les Eleven protègent les Amériques.');
    expect(stats.addedChars).toBeGreaterThan(0);
    expect(stats.removedChars).toBeGreaterThan(0);
    expect(stats.totalChars).toBe('Les Eleven protègent les Amériques.'.length);
  });

  it('contenu identique : tous les compteurs à zéro (restauration repoussée)', () => {
    const stats = textChangeStats('identique', 'identique');
    expect(stats).toEqual({ addedChars: 0, removedChars: 0, totalChars: 9 });
  });

  it('le libellé parle en caractères ajoutés/supprimés et total', () => {
    const detail = textChangeDetail({ addedChars: 312, removedChars: 87, totalChars: 2534 });
    expect(detail).toBe('+312 / −87 caractères (2534 au total)');
  });
});
