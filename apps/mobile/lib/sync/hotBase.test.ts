import { describe, expect, it } from 'vitest';
import { editQuietMsFor, preserveHotBases, quietRetryAt, splitEditHot, SYNC_EDIT_QUIET_MS, SYNC_META_EDIT_QUIET_MS } from './editQuiet';
import { planSync, type SyncBase } from './threeWay';

// Reproduit les deux cycles de l'incident du 26/10 (tâche créée sur LORDI
// qui disparaît) avec la même mécanique que runSync : plan sur les fichiers
// froids, puis nouvel état = hash locaux + bases conservées des chauds.
type F = { relPath: string; contentHash: string; modifiedAt: number };
const toBase = (files: Record<string, string>): SyncBase =>
  Object.fromEntries(Object.entries(files).map(([p, hash]) => [p, { hash }]));

function cycle(local: F[], remote: Record<string, string>, state: Record<string, string>, now: number) {
  const { cold, hotPaths } = splitEditHot(local, now);
  const plan = planSync({
    local: cold.map((f) => ({ relPath: f.relPath, hash: f.contentHash })),
    remote: Object.entries(remote).map(([relPath, hash]) => ({ relPath, hash, deleted: false, version: 1 })),
    base: toBase(state),
    allow: (p) => !hotPaths.has(p),
  });
  const next: Record<string, string> = {};
  for (const f of local) next[f.relPath] = f.contentHash;
  preserveHotBases(next, hotPaths, state);
  const kinds = Object.fromEntries(plan.actions.map((a) => [a.relPath, a.kind]));
  return { kinds, next, hotPaths };
}

describe.each([
  ['.123ecriture/tasks.json', SYNC_META_EDIT_QUIET_MS],
  ['notes/journal.md', SYNC_EDIT_QUIET_MS],
])('fichier en édition : %s', (relPath, quiet) => {
  const t0 = 1_900_000_000_000;
  const state = { [relPath]: 'B0' };
  const remote = { [relPath]: 'B0' };
  const edited: F[] = [{ relPath, contentHash: 'L1', modifiedAt: t0 }];

  it('cycle pendant le délai : rien dans le plan, base = ANCIENNE base', () => {
    const c1 = cycle(edited, remote, state, t0 + 1_000);
    expect(c1.hotPaths.has(relPath)).toBe(true);
    expect(c1.kinds[relPath]).toBeUndefined();
    expect(c1.next[relPath]).toBe('B0');
  });

  it('cycle après le délai : PUSH, jamais pull', () => {
    const c1 = cycle(edited, remote, state, t0 + 1_000);
    const c2 = cycle(edited, remote, c1.next, t0 + quiet + 1);
    expect(c2.kinds[relPath]).toBe('push');
  });

  it('cloud modifié entre-temps : conflit, jamais pull silencieux', () => {
    const c1 = cycle(edited, remote, state, t0 + 1_000);
    const c2 = cycle(edited, { [relPath]: 'R2' }, c1.next, t0 + quiet + 1);
    expect(c2.kinds[relPath]).toBe('conflict');
  });

  it('nouveau fichier jamais synchronisé, chaud : aucune base, puis push (pas de suppression fantôme)', () => {
    const c1 = cycle(edited, {}, {}, t0 + 1_000);
    expect(relPath in c1.next).toBe(false);
    expect(Object.values(c1.kinds)).not.toContain('tombstone-remote');
    const c2 = cycle(edited, {}, c1.next, t0 + quiet + 1);
    expect(c2.kinds[relPath]).toBe('push');
  });

  it('chaud avec base connue : ni tombstone ni delete-local', () => {
    const c1 = cycle(edited, remote, state, t0 + 1_000);
    expect(Object.values(c1.kinds).filter((k) => k === 'tombstone-remote' || k === 'delete-local')).toEqual([]);
  });
});

describe('délai d’édition par type de fichier', () => {
  it('5 s pour les 4 métadonnées synchronisées, 60 s pour le reste', () => {
    for (const p of ['.123ecriture/tasks.json', '.123ecriture/tasklists.json', '.123ecriture/preferences.json', '.123ecriture/appearance.json']) {
      expect(editQuietMsFor(p)).toBe(5_000);
    }
    expect(editQuietMsFor('notes/a.md')).toBe(60_000);
    expect(editQuietMsFor('.123ecriture/sync-state.json')).toBe(60_000);
  });

  it('relance planifiée au plus tard des fichiers chauds, chacun avec son délai', () => {
    const files = [
      { relPath: '.123ecriture/tasks.json', modifiedAt: 1_000_000 },
      { relPath: 'a.md', modifiedAt: 1_000_000 },
    ];
    expect(quietRetryAt(files, new Set(['.123ecriture/tasks.json']))).toBe(1_000_000 + 5_000 + 1_000);
    expect(quietRetryAt(files, new Set(['.123ecriture/tasks.json', 'a.md']))).toBe(1_000_000 + 60_000 + 1_000);
  });
});
