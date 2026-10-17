import { describe, expect, it } from 'vitest';

import { SYNC_EDIT_QUIET_MS, isEditHot, splitEditHot } from './editQuiet';

describe('isEditHot (période de silence « fichier ouvert »)', () => {
  const maintenant = 1_000_000_000;

  it('est chaud juste après la modification (frappe en cours)', () => {
    expect(isEditHot(maintenant - 1_000, maintenant)).toBe(true);
  });

  it('est chaud à la limite interne de la fenêtre', () => {
    expect(isEditHot(maintenant - (SYNC_EDIT_QUIET_MS - 1), maintenant)).toBe(true);
  });

  it('est froid une fois la fenêtre de silence écoulée (fichier quitté)', () => {
    expect(isEditHot(maintenant - SYNC_EDIT_QUIET_MS, maintenant)).toBe(false);
    expect(isEditHot(maintenant - SYNC_EDIT_QUIET_MS - 5_000, maintenant)).toBe(false);
  });

  it('un horodatage futur (horloge décalée) n\'est jamais chaud — pas de blocage éternel', () => {
    expect(isEditHot(maintenant + 10 * 60_000, maintenant)).toBe(false);
  });
});

describe('splitEditHot', () => {
  const maintenant = 1_000_000_000;

  it('sépare les fichiers chauds (différés) des froids (synchronisés)', () => {
    const files = [
      { relPath: 'a.md', modifiedAt: maintenant - 1_000 }, // chaud
      { relPath: 'b.md', modifiedAt: maintenant - 120_000 }, // froid
      { relPath: 'c.md', modifiedAt: maintenant - 30_000 }, // chaud
    ];
    const { cold, hotPaths } = splitEditHot(files, maintenant);
    expect(cold.map((f) => f.relPath)).toEqual(['b.md']);
    expect(hotPaths).toEqual(new Set(['a.md', 'c.md']));
  });

  it('aucun fichier chaud → tout part en synchronisation', () => {
    const files = [{ relPath: 'x.md', modifiedAt: maintenant - 999_999 }];
    const { cold, hotPaths } = splitEditHot(files, maintenant);
    expect(cold).toHaveLength(1);
    expect(hotPaths.size).toBe(0);
  });
});
