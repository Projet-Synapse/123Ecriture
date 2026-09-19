import { describe, expect, it } from 'vitest';

import { computeLocalDeletions, remoteDeletionAction } from './deletions';

describe('computeLocalDeletions', () => {
  it('détecte les fichiers présents à la dernière synchro et absents maintenant', () => {
    const lastSynced = { 'a.md': 'h1', 'b.md': 'h2', 'c.md': 'h3' };
    const current = new Set(['a.md', 'c.md']);
    expect(computeLocalDeletions(lastSynced, current)).toEqual(['b.md']);
  });

  it('ne signale rien quand tout est encore là (ou plus rien : coffre vidé)', () => {
    expect(computeLocalDeletions({ 'a.md': 'h1' }, new Set(['a.md']))).toEqual([]);
    expect(computeLocalDeletions({}, new Set())).toEqual([]);
  });
});

describe('remoteDeletionAction', () => {
  it('skip si le fichier n’existe pas localement', () => {
    expect(remoteDeletionAction({ localExists: false })).toBe('skip');
  });

  it('skip si le fichier n’a jamais été synchro ici (apporté par l’utilisatrice)', () => {
    expect(remoteDeletionAction({ localExists: true, localHash: 'h1' })).toBe('skip');
  });

  it('delete si le fichier local est inchangé depuis la dernière synchro', () => {
    expect(remoteDeletionAction({ localExists: true, lastSyncedHash: 'h1', localHash: 'h1' })).toBe('delete');
  });

  it('keep-copy si le fichier a été modifié localement depuis (pas de perte silencieuse)', () => {
    expect(remoteDeletionAction({ localExists: true, lastSyncedHash: 'h1', localHash: 'h2' })).toBe('keep-copy');
  });
});
