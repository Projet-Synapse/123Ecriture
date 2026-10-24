import { describe, expect, it } from 'vitest';
import { indexedModifiedAt, splitEditHot , noteLocalWrite } from './editQuiet';

import { planSync } from './threeWay';
import { EMPTY_SHA256 } from './folderMarker';

describe('mtime Android et période de silence', () => {
  it('fichiers à mtime réel ancien ou inconnu (0) : jamais « en cours d’édition »', () => {
    const now = 1_800_000_000_000;
    const files = [
      { relPath: 'a.md', modifiedAt: indexedModifiedAt({ mtime: now - 3_600_000 }) },
      { relPath: 'b.md', modifiedAt: indexedModifiedAt({}) },
      { relPath: 'c.md', modifiedAt: indexedModifiedAt(undefined) },
      { relPath: 'd.md', modifiedAt: indexedModifiedAt({ mtime: now - 5_000 }) },
    ];
    const { cold, hotPaths } = splitEditHot(files, now);
    expect(cold.map((f) => f.relPath)).toEqual(['a.md', 'b.md', 'c.md']);
    expect([...hotPaths]).toEqual(['d.md']);
  });
});

describe('analyse d’impact test.8', () => {
  it('note sauvegardée par l’éditeur il y a 5 s, index sans mtime : reste « en cours d’édition »', () => {
    const now = 1_900_000_000_000;
    noteLocalWrite('en-cours.md', now - 5_000);
    const files = [{ relPath: 'en-cours.md', modifiedAt: indexedModifiedAt({}, 'en-cours.md') }];
    expect([...splitEditHot(files, now).hotPaths]).toEqual(['en-cours.md']);
    expect(splitEditHot(files, now + 120_000).cold).toHaveLength(1);
  });

  it('liste des dossiers inconnue (allow exclut les marqueurs) : aucune suppression de dossier', () => {
    const m = 'A/B/.123ecriture-dossier';
    const plan = planSync({
      local: [],
      remote: [{ relPath: m, hash: EMPTY_SHA256, kind: 'folder', deleted: false, updatedAt: '', version: 1 }],
      base: { [m]: { hash: EMPTY_SHA256, kind: 'folder' } },
      allow: (p) => !p.endsWith('.123ecriture-dossier'),
    });
    expect(plan.actions).toEqual([]);
  });

  it('marqueur cloud absent ici et hors base : toujours tiré (aucune garde d’édition)', () => {
    const m = 'A/C/.123ecriture-dossier';
    const plan = planSync({
      local: [],
      remote: [{ relPath: m, hash: EMPTY_SHA256, kind: 'folder', deleted: false, updatedAt: '', version: 1 }],
      base: {},
      allow: () => true,
    });
    expect(plan.actions.map((a) => a.kind)).toEqual(['pull']);
  });
});
