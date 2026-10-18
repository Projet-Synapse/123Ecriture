import { describe, expect, it } from 'vitest';

import { isEditHot, splitEditHot, SYNC_EDIT_QUIET_MS } from './editQuiet';

// LA RÈGLE M.1/M.4 de la spec (docs/sync-cycle-spec.md) : un fichier « chaud »
// (modifié il y a moins de 60 s — l'utilisatrice l'édite ou vient de le
// quitter) est EXCLU du diff du cycle : ni pull, ni push, ni conflit, ni
// tombstone. Le fichier ne peut JAMAIS être perçu comme un conflit pendant
// l'édition (vécu 17-18/10 : « conflit à chaque frappe », disparitions).
describe('isEditHot — le fichier chaud ne participe jamais au cycle', () => {
  const maintenant = 1_000_000_000;

  it('chaud à la frappe (modification il y a 1 s)', () => {
    expect(isEditHot(maintenant - 1_000, maintenant)).toBe(true);
  });

  it('chaud jusqu à la fin de la fenêtre de silence', () => {
    expect(isEditHot(maintenant - (SYNC_EDIT_QUIET_MS - 1), maintenant)).toBe(true);
  });

  it('froid après le silence : le cycle suivant le synchronise normalement', () => {
    expect(isEditHot(maintenant - SYNC_EDIT_QUIET_MS, maintenant)).toBe(false);
  });

  it('horloge décalée dans le futur : jamais bloqué éternellement', () => {
    expect(isEditHot(maintenant + 600_000, maintenant)).toBe(false);
  });
});

describe('splitEditHot — la séparation chaud/froid du diff', () => {
  const maintenant = 1_000_000_000;

  it('les chauds sont HORS du diff (ni pull, ni push, ni conflit, ni tombstone)', () => {
    const files = [
      { relPath: 'en-edition.md', modifiedAt: maintenant - 1_000 },
      { relPath: 'a-pusher.md', modifiedAt: maintenant - 300_000 },
      { relPath: 'nouveau.md', modifiedAt: maintenant - 2_000 },
    ];
    const { cold, hotPaths } = splitEditHot(files, maintenant);
    expect(cold.map((f) => f.relPath)).toEqual(['a-pusher.md']);
    expect(hotPaths).toEqual(new Set(['en-edition.md', 'nouveau.md']));
  });

  it('tout froid : le diff voit tout (cycle complet normal)', () => {
    const files = [
      { relPath: 'a.md', modifiedAt: maintenant - 999_999 },
      { relPath: 'b.md', modifiedAt: maintenant - 61_000 },
    ];
    const { cold, hotPaths } = splitEditHot(files, maintenant);
    expect(cold).toHaveLength(2);
    expect(hotPaths.size).toBe(0);
  });
});
