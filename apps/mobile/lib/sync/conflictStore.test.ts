import { describe, expect, it, vi } from 'vitest';

import type { PendingConflict } from './conflictQueue';
import type { ResolverDeps } from './conflictResolver';
import { createConflictStore } from './conflictStore';

vi.mock('expo', () => ({ requireOptionalNativeModule: () => null }));
vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));
const mergeControl = vi.hoisted(() => ({ forceConflict: false }));
vi.mock('./merge', async (orig) => {
  const real = await orig<typeof import('./merge')>();
  return {
    ...real,
    tryThreeWayMerge: (b: string, l: string, r: string) =>
      mergeControl.forceConflict ? { kind: 'conflict' as const } : real.tryThreeWayMerge(b, l, r),
  };
});

function memoryVault(files: Record<string, string>) {
  return {
    files,
    readNote: vi.fn(async (p: string) => {
      if (!(p in files)) throw new Error(`absent ${p}`);
      return files[p];
    }),
    writeNote: vi.fn(async (p: string, c: string) => {
      files[p] = c;
    }),
    readNoteBinary: vi.fn(async (p: string) => files[p]),
    writeNoteBinary: vi.fn(async (p: string, c: string) => {
      files[p] = c;
    }),
    delete: vi.fn(async (p: string) => {
      delete files[p];
    }),
  };
}

function setup(files: Record<string, string>, remote = 'distant') {
  const vault = memoryVault(files);
  let disk: string | null = null;
  const refs: Record<string, string> = {};
  const backups: string[] = [];
  const deps: ResolverDeps = {
    vault: vault as unknown as ResolverDeps['vault'],
    isBinary: (p) => p.endsWith('.png'),
    downloadText: async () => remote,
    downloadBinary: async () => 'QUJD',
    loadBase: async () => 'ligne 1\nligne 2\nligne 3\n',
    saveBase: async () => undefined,
    setReference: async (p, h) => {
      refs[p] = h;
    },
    ignoreRemote: () => undefined,
    backup: async (p) => {
      backups.push(p);
    },
  };
  const store = createConflictStore({
    read: async () => disk,
    write: async (raw) => {
      disk = raw;
    },
    resolverDeps: async () => deps,
    takenPaths: async () => Object.keys(files),
  });
  return { store, vault, refs, backups, disk: () => disk };
}

const pull = (over: Partial<PendingConflict> = {}): PendingConflict => ({
  id: 'p1',
  origin: 'pull',
  reason: 'same-path',
  existing: { relPath: 'a.md', sizeBytes: 5, modifiedAt: null, device: 'cet appareil' },
  incoming: { relPath: 'a.md', sizeBytes: 7, modifiedAt: null, device: 'cloud', contentHash: 'h', remoteVaultId: 'v' },
  isText: true,
  createdAt: '2026-10-23T10:00:00.000Z',
  ...over,
});

describe('conflictStore', () => {
  it('persiste la file et la relit (jamais résolue en silence)', async () => {
    const { store, disk } = setup({ 'a.md': 'local' });
    await store.enqueue([pull()]);
    expect(JSON.parse(disk()!).conflicts).toHaveLength(1);
    await store.load();
    expect(store.getQueue().conflicts.map((c) => c.id)).toEqual(['p1']);
    expect([...(await store.frozenPaths())]).toEqual(['a.md']);
  });

  it('remplacer : écrit le distant, sauvegarde cachée, adopte la référence', async () => {
    const { store, vault, refs, backups } = setup({ 'a.md': 'local' });
    await store.enqueue([pull()]);
    const res = await store.resolve('p1', { choice: 'replace' });
    expect(res).toEqual({ resolved: 1, failed: [] });
    expect(vault.files['a.md']).toBe('distant');
    expect(backups).toEqual(['a.md']);
    expect(refs).toEqual({ 'a.md': 'h' });
    expect(store.getQueue().conflicts).toHaveLength(0);
  });

  it('fusion propre : 3 voies sur la base', async () => {
    const { store, vault } = setup({ 'a.md': 'ligne 1 local\nligne 2\nligne 3\n' }, 'ligne 1\nligne 2\nligne 3 distant\n');
    await store.enqueue([pull()]);
    await store.resolve('p1', { choice: 'merge' });
    expect(vault.files['a.md']).toBe('ligne 1 local\nligne 2\nligne 3 distant\n');
  });

  it('fusion en chevauchement : erreur visible, conflit conservé, rien écrit', async () => {
    const { store, vault } = setup({ 'a.md': 'ligne 1 A\nligne 2\nligne 3\n' }, 'ligne 1 B\nligne 2\nligne 3\n');
    await store.enqueue([pull()]);
    mergeControl.forceConflict = true;
    const res = await store.resolve('p1', { choice: 'merge' }).finally(() => (mergeControl.forceConflict = false));
    expect(res.resolved).toBe(0);
    expect(res.failed[0].message).toMatch(/Fusion impossible/);
    expect(vault.files['a.md']).toBe('ligne 1 A\nligne 2\nligne 3\n');
    expect(store.getQueue().conflicts).toHaveLength(1);
  });

  it('import annulé : copie mise de côté supprimée, existant intact', async () => {
    const { store, vault } = setup({ 'att/x.png': 'OLD', '.123ecriture/conflicts-staged/i1-x.png': 'NEW' });
    await store.enqueue([
      pull({
        id: 'i1',
        origin: 'import',
        isText: false,
        existing: { relPath: 'att/x.png', sizeBytes: 3, modifiedAt: null, device: 'cet appareil' },
        incoming: { relPath: 'att/x.png', sizeBytes: 3, modifiedAt: null, device: 'import', stagedRelPath: '.123ecriture/conflicts-staged/i1-x.png' },
      }),
    ]);
    await store.resolve('i1', { choice: 'cancel' });
    expect(vault.files).toEqual({ 'att/x.png': 'OLD' });
  });

  it('appliquer à tous : garder les deux pour chacun, binaire non fusionnable reste en file', async () => {
    const { store, vault } = setup({ 'a.md': 'A', 'b.md': 'B', 'c.png': 'C' });
    await store.enqueue([
      pull(),
      pull({ id: 'p2', existing: { ...pull().existing, relPath: 'b.md' }, incoming: { ...pull().incoming, relPath: 'b.md' }, createdAt: '2026-10-23T10:00:01.000Z' }),
      pull({ id: 'p3', isText: false, existing: { ...pull().existing, relPath: 'c.png' }, incoming: { ...pull().incoming, relPath: 'c.png' }, createdAt: '2026-10-23T10:00:02.000Z' }),
    ]);
    const all = await store.resolve('p1', { choice: 'keep-both' }, true);
    expect(all.resolved).toBe(3);
    expect(Object.keys(vault.files).sort()).toEqual(['a (conflit).md', 'a.md', 'b (conflit).md', 'b.md', 'c (conflit).png', 'c.png']);

    const second = setup({ 'a.md': 'ligne 1\nligne 2\nligne 3\n', 'c.png': 'C' });
    await second.store.enqueue([pull(), pull({ id: 'p3', isText: false, existing: { ...pull().existing, relPath: 'c.png' }, incoming: { ...pull().incoming, relPath: 'c.png' }, createdAt: '2026-10-23T10:00:02.000Z' })]);
    const merged = await second.store.resolve('p1', { choice: 'merge' }, true);
    expect(merged.resolved).toBe(1);
    expect(second.store.getQueue().conflicts.map((c) => c.id)).toEqual(['p3']);
  });

  it('nom refusé annulé : la ligne distante est ignorée tant que son hash ne change pas', async () => {
    const { store } = setup({});
    await store.enqueue([
      pull({ id: 'n1', reason: 'invalid-name', existing: { ...pull().existing, relPath: 'a꞉b.md', sizeBytes: null }, incoming: { ...pull().incoming, relPath: 'a:b.md' } }),
    ]);
    await store.resolve('n1', { choice: 'cancel' });
    expect(await store.ignoredRemote()).toEqual({ 'a:b.md': 'h' });
  });
});
