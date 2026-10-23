import { describe, expect, it } from 'vitest';

import {
  availableChoices,
  choiceLabel,
  collisionReason,
  decisionsForAll,
  enqueueConflict,
  findFoldedCollision,
  findPathCollisions,
  frozenPaths,
  parseConflictQueue,
  planResolution,
  removeConflict,
  sanitizeName,
  suggestRenamedPath,
  type PendingConflict,
} from './conflictQueue';

const NFC = 'Été.md';
const NFD = 'E\u0301te\u0301.md';

function conflict(over: Partial<PendingConflict> = {}): PendingConflict {
  return {
    id: over.id ?? 'c1',
    origin: 'pull',
    reason: 'same-path',
    existing: { relPath: 'notes/a.md', sizeBytes: 10, modifiedAt: null, device: 'cet appareil' },
    incoming: { relPath: 'notes/a.md', sizeBytes: 12, modifiedAt: null, device: 'cloud', contentHash: 'h1', remoteVaultId: 'v' },
    isText: true,
    createdAt: '2026-10-23T10:00:00.000Z',
    ...over,
  };
}

describe('détection', () => {
  it('classe même chemin, casse et NFC/NFD', () => {
    expect(collisionReason('a.md', 'a.md')).toBe('same-path');
    expect(collisionReason('A.md', 'a.md')).toBe('case');
    expect(collisionReason(NFC, NFD)).toBe('unicode');
    expect(collisionReason('a.md', 'b.md')).toBeNull();
  });
  it('trouve une collision repliée mais ignore le chemin identique', () => {
    expect(findFoldedCollision('notes/a.md', ['notes/a.md'])).toBeNull();
    expect(findFoldedCollision('notes/A.md', ['notes/a.md'])).toEqual({ existingRelPath: 'notes/a.md', reason: 'case' });
    expect(findFoldedCollision('x.md', ['notes/a.md', 'x.md'])).toBeNull();
  });
  it("liste les collisions d'un index", () => {
    expect(findPathCollisions(['a.md', 'A.md', NFC, NFD, 'b.md'])).toHaveLength(2);
  });
});

describe('noms proposés', () => {
  it('propose « nom (2) » puis « nom (3) », insensible à la casse', () => {
    expect(suggestRenamedPath('d/a.md', ['d/a.md'])).toBe('d/a (2).md');
    expect(suggestRenamedPath('d/a.md', ['d/a.md', 'd/A (2).md'])).toBe('d/a (3).md');
    expect(suggestRenamedPath('a (2).md', ['a.md', 'a (2).md'])).toBe('a (3).md');
    expect(suggestRenamedPath('a.md', ['a.md'], 'conflit')).toBe('a (conflit).md');
  });
  it('assainit les caractères refusés', () => {
    expect(sanitizeName('a:b?.md')).toBe('a꞉b_.md');
  });
});

describe('file', () => {
  it('déduplique en gardant id et date', () => {
    let q = enqueueConflict({ conflicts: [] }, conflict());
    q = enqueueConflict(q, conflict({ id: 'c2', createdAt: '2026-10-24T00:00:00.000Z', diffSummary: { addedChars: 1, removedChars: 0 } }));
    expect(q.conflicts).toHaveLength(1);
    expect(q.conflicts[0].id).toBe('c1');
    expect(q.conflicts[0].diffSummary).toEqual({ addedChars: 1, removedChars: 0 });
  });
  it('gèle les deux chemins et les libère au retrait', () => {
    const q = enqueueConflict({ conflicts: [] }, conflict({ incoming: { ...conflict().incoming, relPath: 'notes/A.md' }, reason: 'case' }));
    expect([...frozenPaths(q)].sort()).toEqual(['notes/A.md', 'notes/a.md']);
    expect(frozenPaths(removeConflict(q, 'c1')).size).toBe(0);
  });
  it('relit une file persistée et tolère un JSON cassé', () => {
    const q = enqueueConflict({ conflicts: [], ignoredRemote: { x: 'h' } }, conflict());
    expect(parseConflictQueue(JSON.stringify(q))).toEqual(q);
    expect(parseConflictQueue('{oops')).toEqual({ conflicts: [] });
    expect(parseConflictQueue(null)).toEqual({ conflicts: [] });
  });
});

describe('choix', () => {
  it('fusion seulement pour un texte', () => {
    expect(availableChoices(conflict())).toEqual(['merge', 'rename', 'replace', 'keep-both', 'cancel']);
    expect(availableChoices(conflict({ isText: false }))).not.toContain('merge');
    expect(availableChoices(conflict({ reason: 'invalid-name' }))).toEqual(['rename', 'cancel']);
  });
  it('libellé d’annulation selon l’origine', () => {
    expect(choiceLabel('cancel', 'import')).toBe('Annuler l’upload');
    expect(choiceLabel('cancel', 'pull')).toBe('Annuler la réception');
  });
});

describe('planResolution', () => {
  it('refuse un choix indisponible', () => {
    expect(() => planResolution(conflict({ isText: false }), { choice: 'merge' }, [])).toThrow();
  });
  it('pull même chemin : fusion puis adoption de la référence distante', () => {
    expect(planResolution(conflict(), { choice: 'merge' }, [])).toEqual([
      { type: 'merge', target: 'notes/a.md' },
      { type: 'adopt-remote-reference', relPath: 'notes/a.md', contentHash: 'h1' },
    ]);
  });
  it('garder les deux : seule voie vers une copie « (conflit) »', () => {
    const plan = planResolution(conflict(), { choice: 'keep-both' }, ['notes/a.md']);
    expect(plan[0]).toEqual({ type: 'write-incoming', to: 'notes/a (conflit).md' });
    for (const choice of ['merge', 'rename', 'replace', 'cancel'] as const) {
      const p = planResolution(conflict(), { choice }, ['notes/a.md']);
      expect(JSON.stringify(p)).not.toContain('(conflit)');
    }
  });
  it('renommer : nom saisi, refus si déjà pris (casse comprise)', () => {
    expect(planResolution(conflict(), { choice: 'rename', newName: 'b.md' }, [])[0]).toEqual({
      type: 'write-incoming',
      to: 'notes/b.md',
    });
    expect(() => planResolution(conflict(), { choice: 'rename', newName: 'B.md' }, ['notes/b.md'])).toThrow(/existe déjà/);
  });
  it('import : la copie mise de côté est toujours supprimée', () => {
    const c = conflict({ origin: 'import', incoming: { ...conflict().incoming, stagedRelPath: '.123ecriture/conflicts-staged/x' } });
    expect(planResolution(c, { choice: 'cancel' }, [])).toEqual([{ type: 'drop-staged' }]);
    expect(planResolution(c, { choice: 'replace' }, [])).toEqual([
      { type: 'write-incoming', to: 'notes/a.md' },
      { type: 'drop-staged' },
    ]);
  });
  it('indexation : le second fichier part à la corbeille, jamais sur annulation', () => {
    const c = conflict({ origin: 'index', reason: 'case', incoming: { ...conflict().incoming, relPath: 'notes/A.md' } });
    expect(planResolution(c, { choice: 'replace' }, [])).toEqual([
      { type: 'write-incoming', to: 'notes/a.md' },
      { type: 'trash', relPath: 'notes/A.md' },
    ]);
    expect(planResolution(c, { choice: 'cancel' }, [])).toEqual([]);
  });
  it('pull nom refusé : renommer vers le nom assaini, annuler = ignorer la ligne', () => {
    const c = conflict({
      reason: 'invalid-name',
      existing: { relPath: 'a꞉b.md', sizeBytes: null, modifiedAt: null, device: 'cet appareil' },
      incoming: { ...conflict().incoming, relPath: 'a:b.md' },
    });
    expect(planResolution(c, { choice: 'rename' }, [])[0]).toEqual({ type: 'write-incoming', to: 'a꞉b.md' });
    expect(planResolution(c, { choice: 'cancel' }, [])).toEqual([{ type: 'ignore-remote', relPath: 'a:b.md', contentHash: 'h1' }]);
  });
});

describe('appliquer à tous', () => {
  it('laisse en file les conflits où le choix est indisponible, nom saisi non propagé', () => {
    const q = { conflicts: [conflict({ id: 'a' }), conflict({ id: 'b', isText: false })] };
    const res = decisionsForAll(q, { choice: 'merge', newName: 'x.md' });
    expect(res.apply.map((x) => x.conflict.id)).toEqual(['a']);
    expect(res.apply[0].decision.newName).toBeUndefined();
    expect(res.remaining.map((c) => c.id)).toEqual(['b']);
  });
});
