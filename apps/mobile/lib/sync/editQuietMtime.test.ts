import { describe, expect, it } from 'vitest';
import { indexedModifiedAt, splitEditHot , noteLocalWrite , quietRetryAt } from './editQuiet';

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
describe('relance après édition (tasklists.json différé)', () => {
  it('donne l’instant où le dernier fichier chaud redevient silencieux', () => {
    const files = [
      { relPath: '.123ecriture/tasklists.json', modifiedAt: 1_000_000 },
      { relPath: '.123ecriture/preferences.json', modifiedAt: 1_005_000 },
      { relPath: 'froid.md', modifiedAt: 9_999_999 },
    ];
    const hot = new Set(['.123ecriture/tasklists.json', '.123ecriture/preferences.json']);
    expect(quietRetryAt(files, hot)).toBe(1_005_000 + 60_000 + 1_000);
    expect(quietRetryAt(files, new Set())).toBeUndefined();
  });
});
