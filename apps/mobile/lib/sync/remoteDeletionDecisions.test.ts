import { describe, expect, it, vi } from 'vitest';

import { approveRemoteDeletions, refuseRemoteDeletions } from './remoteDeletionDecisions';
import {
  PENDING_REVIEW_REL_PATH,
  PendingReviewUnreadableError,
  loadPendingReview,
  reconcileRemoteDeletions,
  type RemoteDeletionReview,
} from './pendingReview';

function memVault(initial: Record<string, string>) {
  const files = { ...initial };
  return {
    files,
    readNote: vi.fn(async (p: string) => {
      if (!(p in files)) throw new Error('Élément introuvable.');
      return files[p];
    }),
    writeNote: vi.fn(async (p: string, c: string) => {
      files[p] = c;
    }),
    delete: vi.fn(async (p: string) => {
      if (p === 'boom.md') throw new Error('disque');
      files['.trash/' + p] = files[p];
      delete files[p];
    }),
  };
}

const entry = (path: string): RemoteDeletionReview => ({ path, modified: false, at: '2026-10-23T00:00:00Z' });
const queue = (...paths: string[]) => JSON.stringify({ remoteDeletions: paths.map(entry) });

describe('reconcileRemoteDeletions', () => {
  it('garde la date d’origine, ajoute les nouvelles, retire les résolues', () => {
    const existing = [entry('a.md'), entry('gone.md')];
    const candidates = [{ ...entry('a.md'), at: 'later', deletedByDevice: 'PC' }, { ...entry('b.md'), at: 'now' }];
    const { entries, added } = reconcileRemoteDeletions(existing, candidates, new Set(['a.md', 'b.md']));
    expect(entries.map((e) => e.path)).toEqual(['a.md', 'b.md']);
    expect(entries[0]).toMatchObject({ at: '2026-10-23T00:00:00Z', deletedByDevice: 'PC' });
    expect(added.map((e) => e.path)).toEqual(['b.md']);
  });
});

describe('loadPendingReview', () => {
  it('absent → file vide', async () => {
    expect(await loadPendingReview(memVault({}))).toEqual({});
  });
  it('corrompu → erreur explicite (jamais {} qui serait écrasé)', async () => {
    await expect(loadPendingReview(memVault({ [PENDING_REVIEW_REL_PATH]: '{oups' }))).rejects.toBeInstanceOf(
      PendingReviewUnreadableError,
    );
  });
  it('lecture en échec autre que « introuvable » → erreur', async () => {
    const v = memVault({});
    v.readNote.mockRejectedValueOnce(new Error('permission SAF perdue'));
    await expect(loadPendingReview(v)).rejects.toBeInstanceOf(PendingReviewUnreadableError);
  });
});

describe('décisions', () => {
  it('approuver : corbeille locale, seules les réussites quittent la file', async () => {
    const v = memVault({ 'a.md': 'A', 'boom.md': 'B', [PENDING_REVIEW_REL_PATH]: queue('a.md', 'boom.md') });
    const out = await approveRemoteDeletions(
      { vault: v, restoreRemote: vi.fn(), legacyUndelete: vi.fn() },
      ['a.md', 'boom.md'],
    );
    expect(out.done).toEqual(['a.md']);
    expect(out.failures[0].path).toBe('boom.md');
    expect(v.files['.trash/a.md']).toBe('A');
    expect(JSON.parse(v.files[PENDING_REVIEW_REL_PATH]).remoteDeletions.map((e: RemoteDeletionReview) => e.path)).toEqual([
      'boom.md',
    ]);
  });

  it('refuser : restore_file, repli legacy si RPC absente, fichier local intact', async () => {
    const v = memVault({ 'a.md': 'A', 'b.md': 'B', [PENDING_REVIEW_REL_PATH]: queue('a.md', 'b.md') });
    const restoreRemote = vi.fn(async (p: string) =>
      p === 'a.md' ? { ok: true, conflict: false, currentVersion: 3, currentHash: 'h', deleted: false } : null,
    );
    const legacyUndelete = vi.fn(async () => undefined);
    const out = await refuseRemoteDeletions({ vault: v, restoreRemote, legacyUndelete }, ['a.md', 'b.md']);
    expect(out.done.sort()).toEqual(['a.md', 'b.md']);
    expect(legacyUndelete).toHaveBeenCalledWith(['b.md']);
    expect(v.delete).not.toHaveBeenCalled();
    expect(JSON.parse(v.files[PENDING_REVIEW_REL_PATH]).remoteDeletions).toEqual([]);
  });

  it('refuser : une erreur réseau laisse l’entrée en file', async () => {
    const v = memVault({ 'a.md': 'A', [PENDING_REVIEW_REL_PATH]: queue('a.md') });
    const out = await refuseRemoteDeletions(
      { vault: v, restoreRemote: vi.fn(async () => Promise.reject(new Error('réseau'))), legacyUndelete: vi.fn() },
      ['a.md'],
    );
    expect(out.failures).toHaveLength(1);
    expect(v.writeNote).not.toHaveBeenCalled();
  });
});
