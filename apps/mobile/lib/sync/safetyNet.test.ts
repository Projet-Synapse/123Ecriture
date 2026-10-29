import { describe, expect, it } from 'vitest';

import {
  clearPendingReviewSyncBlock,
  loadPendingReview,
  PENDING_REVIEW_REL_PATH,
  PendingReviewUnreadableError,
} from './pendingReview';
import { collectRemoteDeletionCandidates, shouldArchiveBeforeOverwrite, shouldTripBreaker } from './safetyNet';

function fakeVault(initial: Record<string, string> = {}, failRead?: Error) {
  const files = { ...initial };
  return {
    files,
    readNote: async (p: string) => {
      if (failRead) throw failRead;
      if (!(p in files)) throw new Error(`Fichier introuvable: ${p}`);
      return files[p];
    },
    writeNote: async (p: string, c: string) => {
      files[p] = c;
    },
  };
}

describe('shouldArchiveBeforeOverwrite', () => {
  it('archive une version différente au même emplacement', () => {
    expect(shouldArchiveBeforeOverwrite({ content_hash: 'a', storage_object_path: 'u/v/x.md' }, 'b')).toBe(true);
    expect(shouldArchiveBeforeOverwrite({ content_hash: 'a', storage_object_path: null, deleted: true }, 'b')).toBe(true);
  });
  it("n'archive pas sans ligne, contenu identique ou chemin versionné", () => {
    expect(shouldArchiveBeforeOverwrite(null, 'b')).toBe(false);
    expect(shouldArchiveBeforeOverwrite({ content_hash: 'b', storage_object_path: 'x' }, 'b')).toBe(false);
    expect(shouldArchiveBeforeOverwrite({ content_hash: 'a', storage_object_path: 'u/v/x.md@a' }, 'b')).toBe(false);
  });
});

describe('collectRemoteDeletionCandidates', () => {
  it('met en revue toute pierre tombale dont le fichier existe ici, jamais les marqueurs', () => {
    const tombstones = new Map([
      ['a.md', { deletedByDevice: 'PC', deletedAt: '2026-10-29T10:00:00Z', version: 3 }],
      ['gone.md', { deletedByDevice: 'PC' }],
      ['dossier/.123ecriture-dossier', { deletedByDevice: 'PC' }],
      ['b.md', {}],
    ]);
    const local = new Map([
      ['a.md', { contentHash: 'h1' }],
      ['b.md', { contentHash: 'h2-modif' }],
      ['dossier/.123ecriture-dossier', { contentHash: 'm' }],
    ]);
    const { paths, candidates } = collectRemoteDeletionCandidates({
      tombstones,
      local,
      base: { 'a.md': 'h1', 'b.md': 'h2' },
      queuedAt: 'T',
    });
    expect([...paths].sort()).toEqual(['a.md', 'b.md']);
    expect(candidates.find((c) => c.path === 'a.md')).toMatchObject({ modified: false, deletedByDevice: 'PC', remoteVersion: 3 });
    expect(candidates.find((c) => c.path === 'b.md')).toMatchObject({ modified: true, deletedByDevice: null });
  });
});

describe('disjoncteur', () => {
  it('se déclenche à partir de 10 erreurs', () => {
    expect(shouldTripBreaker(9)).toBe(false);
    expect(shouldTripBreaker(10)).toBe(true);
  });
});

describe('pending-review.json strict', () => {
  it('fichier absent → file vide', async () => {
    await expect(loadPendingReview(fakeVault())).resolves.toEqual({});
  });
  it('JSON corrompu → PendingReviewUnreadableError (jamais traité comme vide)', async () => {
    const v = fakeVault({ [PENDING_REVIEW_REL_PATH]: '{pas du json' });
    await expect(loadPendingReview(v)).rejects.toBeInstanceOf(PendingReviewUnreadableError);
  });
  it('erreur de lecture → PendingReviewUnreadableError', async () => {
    await expect(loadPendingReview(fakeVault({}, new Error('EACCES')))).rejects.toBeInstanceOf(
      PendingReviewUnreadableError,
    );
  });
  it('lever le disjoncteur ne retire que syncBlocked', async () => {
    const review = { syncBlocked: { at: 'T', samples: ['x'] }, remoteDeletions: [{ path: 'a.md' }] };
    const v = fakeVault({ [PENDING_REVIEW_REL_PATH]: JSON.stringify(review) });
    await clearPendingReviewSyncBlock(v);
    const after = JSON.parse(v.files[PENDING_REVIEW_REL_PATH]);
    expect(after.syncBlocked).toBeUndefined();
    expect(after.remoteDeletions).toEqual([{ path: 'a.md' }]);
  });
  it("n'écrase pas une file illisible en levant le disjoncteur", async () => {
    const v = fakeVault({ [PENDING_REVIEW_REL_PATH]: '{corrompu' });
    await expect(clearPendingReviewSyncBlock(v)).rejects.toBeInstanceOf(PendingReviewUnreadableError);
    expect(v.files[PENDING_REVIEW_REL_PATH]).toBe('{corrompu');
  });
});
