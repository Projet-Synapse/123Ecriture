import { isHashableRelPath } from './syncRules';
import { describe, expect, it } from 'vitest';
import { planSync, type SyncBase } from './threeWay';
import { isSyncAllowed, DEFAULT_SYNC_SETTINGS, categorize } from './syncSettings';
import { folderToMarker, markerToFolder, isFolderMarker, EMPTY_SHA256, visibleFolders } from './folderMarker';

const kinds = (p: ReturnType<typeof planSync>) => Object.fromEntries(p.actions.map((a) => [a.relPath, a.kind]));

describe('planSync — moteur à trois états', () => {
  it('nouveau local → push', () => {
    const p = planSync({ local: [{ relPath: 'a.md', hash: 'h1' }], remote: [], base: {} });
    expect(kinds(p)).toEqual({ 'a.md': 'push' });
  });

  it('nouveau distant → pull (une absence locale sans base n’est PAS une suppression)', () => {
    const p = planSync({ local: [{ relPath: 'x.md', hash: 'x' }], remote: [{ relPath: 'a.md', hash: 'h1', deleted: false, version: 1 }], base: { 'x.md': { hash: 'x' } } });
    expect(kinds(p)['a.md']).toBe('pull');
  });

  it('suppression locale → tombstone-remote avec la version attendue', () => {
    const base: SyncBase = { 'a.md': { hash: 'h1' }, 'b.md': { hash: 'h2' }, 'c.md': { hash: 'h3' }, 'd.md': { hash: 'h4' } };
    const p = planSync({
      local: [{ relPath: 'b.md', hash: 'h2' }, { relPath: 'c.md', hash: 'h3' }, { relPath: 'd.md', hash: 'h4' }],
      remote: Object.entries(base).map(([relPath, e], i) => ({ relPath, hash: e.hash, deleted: false, version: i + 1 })),
      base,
    });
    const a = p.actions.find((x) => x.relPath === 'a.md');
    expect(a?.kind).toBe('tombstone-remote');
    expect(a?.expectedVersion).toBe(1);
    expect(p.guard.suspended).toBe(false);
  });

  it('suppression locale mais modifié ailleurs → pull (jamais de destruction d’une modification)', () => {
    const p = planSync({
      local: [{ relPath: 'z.md', hash: 'z' }],
      remote: [{ relPath: 'a.md', hash: 'h2', deleted: false }, { relPath: 'z.md', hash: 'z', deleted: false }],
      base: { 'a.md': { hash: 'h1' }, 'z.md': { hash: 'z' } },
    });
    expect(kinds(p)['a.md']).toBe('pull');
  });

  it('suppression distante → delete-local si inchangé ici', () => {
    const p = planSync({
      local: [{ relPath: 'a.md', hash: 'h1' }, { relPath: 'z.md', hash: 'z' }],
      remote: [{ relPath: 'a.md', hash: 'h1', deleted: true }, { relPath: 'z.md', hash: 'z', deleted: false }],
      base: { 'a.md': { hash: 'h1' }, 'z.md': { hash: 'z' } },
    });
    expect(kinds(p)['a.md']).toBe('delete-local');
  });

  it('tombstone distante sur un fichier jamais synchronisé ici → review (aucune résurrection silencieuse)', () => {
    const p = planSync({ local: [{ relPath: 'Homelander 2.md', hash: 'h' }], remote: [{ relPath: 'Homelander 2.md', hash: 'h', deleted: true }], base: {} });
    expect(p.actions[0].kind).toBe('review');
  });

  it('suppression distante mais modifié ici → review (conservé)', () => {
    const p = planSync({
      local: [{ relPath: 'a.md', hash: 'h9' }],
      remote: [{ relPath: 'a.md', hash: 'h1', deleted: true }],
      base: { 'a.md': { hash: 'h1' } },
    });
    expect(p.actions[0]).toMatchObject({ kind: 'review' });
  });

  it('conflit : modifié des deux côtés → conflict (copie de conflit)', () => {
    const p = planSync({
      local: [{ relPath: 'a.md', hash: 'L' }],
      remote: [{ relPath: 'a.md', hash: 'R', deleted: false, version: 3 }],
      base: { 'a.md': { hash: 'B' } },
    });
    expect(p.actions[0]).toMatchObject({ kind: 'conflict', expectedVersion: 3 });
  });

  it('modification d’un seul côté n’est jamais un conflit', () => {
    const base = { 'a.md': { hash: 'B' }, 'b.md': { hash: 'B' } };
    const p = planSync({
      local: [{ relPath: 'a.md', hash: 'L' }, { relPath: 'b.md', hash: 'B' }],
      remote: [{ relPath: 'a.md', hash: 'B', deleted: false }, { relPath: 'b.md', hash: 'R', deleted: false }],
      base,
    });
    expect(kinds(p)).toEqual({ 'a.md': 'push', 'b.md': 'pull' });
  });

  it('dossier vide : synchronisé comme une entrée de type dossier', () => {
    const marker = folderToMarker('RÉSUMÉS/LOIS DU MONDE');
    expect(isFolderMarker(marker)).toBe(true);
    expect(markerToFolder(marker)).toBe('RÉSUMÉS/LOIS DU MONDE');
    const p = planSync({ local: [], remote: [{ relPath: marker, hash: EMPTY_SHA256, deleted: false, kind: 'folder' }], base: {} });
    expect(p.actions[0]).toMatchObject({ kind: 'pull', entryKind: 'folder' });
    const p2 = planSync({ local: [{ relPath: marker, hash: EMPTY_SHA256, kind: 'folder' }], remote: [], base: {} });
    expect(p2.actions[0]).toMatchObject({ kind: 'push', entryKind: 'folder' });
  });

  it('dossier local VIDE alors que la base ne l’est pas → garde-fou, aucune suppression', () => {
    const base: SyncBase = { 'a.md': { hash: '1' }, 'b.md': { hash: '2' } };
    const p = planSync({
      local: [],
      remote: [{ relPath: 'a.md', hash: '1', deleted: false }, { relPath: 'b.md', hash: '2', deleted: false }],
      base,
    });
    expect(p.guard.suspended).toBe(true);
    expect(p.actions.some((a) => a.kind === 'tombstone-remote')).toBe(false);
    expect(p.guard.deletions).toEqual(['a.md', 'b.md']);
  });

  it('trop de suppressions → garde-fou', () => {
    const base: SyncBase = {};
    const remote = [];
    for (let i = 0; i < 30; i += 1) {
      base[`n${i}.md`] = { hash: String(i) };
      remote.push({ relPath: `n${i}.md`, hash: String(i), deleted: false });
    }
    const p = planSync({ local: [{ relPath: 'n0.md', hash: '0' }], remote, base });
    expect(p.guard.suspended).toBe(true);
    expect(p.actions.filter((a) => a.kind === 'tombstone-remote')).toHaveLength(0);
  });

  it('les types désactivés sont ignorés des deux côtés', () => {
    const settings = { ...DEFAULT_SYNC_SETTINGS, types: { ...DEFAULT_SYNC_SETTINGS.types, images: false } };
    const p = planSync({
      local: [{ relPath: 'img.png', hash: 'p' }, { relPath: 'a.md', hash: 'a' }],
      remote: [],
      base: {},
      allow: (r) => isSyncAllowed(r, settings),
    });
    expect(kinds(p)).toEqual({ 'a.md': 'push' });
    expect(categorize('x/y.PNG')).toBe('images');
    expect(categorize('.123ecriture/tasks.json')).toBe('config');
  });
});

describe('dossiers reçus du cloud (régression Android 0.4.96-test.3)', () => {
  const marker = folderToMarker('L/RÉSUMÉS/🪐 LOIS DU MONDE');
  const remote = [{ relPath: marker, hash: EMPTY_SHA256, version: 1, deleted: false, kind: 'folder' as const }];
  const base = { [marker]: { hash: EMPTY_SHA256, kind: 'folder' as const } };

  it('cycle suivant avec le dossier listé : noop, aucune tombstone', () => {
    const plan = planSync({ local: [{ relPath: marker, hash: EMPTY_SHA256, kind: 'folder' }], remote, base });
    expect(plan.actions.map((a) => a.kind)).toEqual(['noop']);
  });

  it('liste des dossiers indisponible : marqueurs exclus, jamais tombstonés', () => {
    const plan = planSync({ local: [], remote, base, allow: (p) => !isFolderMarker(p) });
    expect(plan.actions.filter((a) => a.kind === 'tombstone-remote')).toEqual([]);
  });

  it('dossier supprimé ici (présent dans la base) : tombstone comme une note', () => {
    const plan = planSync({ local: [], remote, base });
    expect(plan.actions.map((a) => a.kind)).toEqual(['tombstone-remote']);
  });

  it('chemin distant hors du périmètre de hachage local : exclu du plan (pas de pull en boucle)', () => {
    const conflit = '.123ecriture/preferences (conflit Android 2026-10-23 16h25).json';
    const plan = planSync({
      local: [],
      remote: [{ relPath: conflit, hash: 'h', deleted: false }],
      base: {},
      allow: (p) => isHashableRelPath(p),
    });
    expect(plan.actions).toEqual([]);
  });

  it('visibleFolders : dossiers visibles seulement', () => {
    const idx: Record<string, boolean> = { 'A': true, 'A/n.md': false, '.trash': true, '.123ecriture/devices': true, 'A/🪐 B': true };
    expect(visibleFolders(Object.keys(idx), (p) => (p in idx ? { isDirectory: idx[p] } : undefined))).toEqual(['A', 'A/🪐 B']);
  });
});

describe('planSync — suppressions approuvées (confirmation du garde-fou)', () => {
  const N = 30;
  const files = Array.from({ length: N }, (_, i) => `n${i}.md`);
  const local = files.map((relPath) => ({ relPath, hash: 'h' }));
  const remote = files.map((relPath) => ({ relPath, hash: 'h', deleted: true }));
  const base: SyncBase = Object.fromEntries(files.map((p) => [p, { hash: 'h' }]));

  it('sans approbation : 30 tombstones distantes → garde levé, rien supprimé', () => {
    const plan = planSync({ local, remote, base });
    expect(plan.guard.suspended).toBe(true);
    expect(plan.guard.deletions).toHaveLength(N);
    expect(plan.actions.some((a) => a.kind === 'delete-local')).toBe(false);
  });

  it('toutes approuvées : garde non levé, suppressions conservées', () => {
    const plan = planSync({ local, remote, base, guard: { approved: new Set(files) } });
    expect(plan.guard.suspended).toBe(false);
    expect(plan.actions.filter((a) => a.kind === 'delete-local')).toHaveLength(N);
  });

  it('approbation partielle : seules les approuvées restent quand le garde est levé', () => {
    const approved = new Set(files.slice(0, 5));
    const plan = planSync({ local, remote, base, guard: { approved } });
    expect(plan.guard.suspended).toBe(true);
    expect(plan.guard.deletions).toHaveLength(N - 5);
    const del = plan.actions.filter((a) => a.kind === 'delete-local').map((a) => a.relPath);
    expect(new Set(del)).toEqual(approved);
  });
});
