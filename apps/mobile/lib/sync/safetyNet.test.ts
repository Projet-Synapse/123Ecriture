import { describe, expect, it } from 'vitest';

import {
  clearPendingReviewSyncBlock,
  loadPendingReview,
  PENDING_REVIEW_REL_PATH,
  PendingReviewUnreadableError,
} from './pendingReview';
import { collectRemoteDeletionCandidates, shouldArchiveBeforeOverwrite, shouldTripBreaker, splitRenameFollowUps } from './safetyNet';

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

describe('collectRemoteDeletionCandidates — renommages', () => {
  it('annote le nouveau chemin d’un renommage apparié', () => {
    const { candidates } = collectRemoteDeletionCandidates({
      tombstones: new Map([
        ['Note.md', { deletedByDevice: 'LORDI', version: 2 }],
        ['Vraie.md', { deletedByDevice: 'LORDI', version: 2 }],
      ]),
      local: new Map([
        ['Note.md', { contentHash: 'h' }],
        ['Vraie.md', { contentHash: 'v' }],
      ]),
      base: { 'Note.md': 'h', 'Vraie.md': 'v' },
      queuedAt: '2026-11-16T00:00:00.000Z',
      renamedTo: new Map([['Note.md', 'Note.mdx']]),
    });
    expect(candidates.find((c) => c.path === 'Note.md')?.renamedTo).toBe('Note.mdx');
    expect(candidates.find((c) => c.path === 'Vraie.md')).not.toHaveProperty('renamedTo');
  });
});

// Régression : conversion .md → .mdx faite sur un autre appareil — l'ancien
// .md restait ici « en attente de validation » à côté du .mdx reçu.
describe('splitRenameFollowUps', () => {
  const at = '2026-11-20T00:00:00.000Z';
  it("l'ancien nom intact suit le renommage, sans revue", () => {
    const { followUps, review } = splitRenameFollowUps([{ path: 'Idée.md', modified: false, at, renamedTo: 'Idée.mdx' }]);
    expect(followUps).toEqual([{ path: 'Idée.md', renamedTo: 'Idée.mdx' }]);
    expect(review).toEqual([]);
  });

  it('modifié ici, ou vraie suppression : revue manuelle (aucune perte)', () => {
    const { followUps, review } = splitRenameFollowUps([
      { path: 'Idée.md', modified: true, at, renamedTo: 'Idée.mdx' },
      { path: 'Supprimé.md', modified: false, at },
    ]);
    expect(followUps).toEqual([]);
    expect(review.map((r) => r.path)).toEqual(['Idée.md', 'Supprimé.md']);
  });

  it("renommage connu d'un cycle précédent (déjà en revue) : suit aussi", () => {
    const { followUps } = splitRenameFollowUps(
      [{ path: 'Idée.md', modified: false, at }],
      [{ path: 'Idée.md', modified: false, at, renamedTo: 'Idée.mdx' }],
    );
    expect(followUps).toEqual([{ path: 'Idée.md', renamedTo: 'Idée.mdx' }]);
  });
});
