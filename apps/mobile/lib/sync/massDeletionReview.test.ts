import { describe, expect, it } from 'vitest';

import {
  baseWithoutKept,
  confirmMassDeletions,
  keepMassDeletions,
  mergeGuardSuspension,
  settleReviewAfterCycle,
  withMassDeletionsConfirmed,
  withMassDeletionsKept,
} from './massDeletionReview';
import { PENDING_REVIEW_REL_PATH, type PendingReview } from './pendingReview';
import { planSync } from './threeWay';

const NOW = '2026-11-16T10:00:00.000Z';
const many = (n: number) => Array.from({ length: n }, (_, i) => `n${String(i).padStart(3, '0')}.md`);

function memoryVault(initial: PendingReview) {
  const files = new Map<string, string>([[PENDING_REVIEW_REL_PATH, JSON.stringify(initial)]]);
  return {
    files,
    readNote: async (p: string) => {
      const v = files.get(p);
      if (v === undefined) throw new Error('ENOENT');
      return v;
    },
    writeNote: async (p: string, c: string) => {
      files.set(p, c);
    },
    review: () => JSON.parse(files.get(PENDING_REVIEW_REL_PATH) ?? '{}') as PendingReview,
  };
}

describe('décisions sur les suppressions massives', () => {
  it('confirmer : alerte retirée, chemins approuvés cumulés, retirés des conservés', () => {
    const { next, paths } = withMassDeletionsConfirmed(
      {
        suspiciousDeletions: { at: NOW, count: 2, paths: ['a.md', 'b.md'] },
        approvedDeletions: { at: NOW, paths: ['z.md'] },
        keptDeletions: { at: NOW, paths: ['a.md', 'k.md'] },
        remoteDeletions: [{ path: 'r.md', at: NOW } as never],
      },
      NOW,
    );
    expect(paths).toEqual(['a.md', 'b.md']);
    expect(next.suspiciousDeletions).toBeUndefined();
    expect(next.approvedDeletions?.paths.sort()).toEqual(['a.md', 'b.md', 'z.md']);
    expect(next.keptDeletions?.paths).toEqual(['k.md']);
    expect(next.remoteDeletions).toHaveLength(1);
  });

  it('conserver : alerte retirée, chemins conservés (jamais approuvés)', () => {
    const { next } = withMassDeletionsKept(
      { suspiciousDeletions: { at: NOW, count: 1, paths: ['a.md'] }, approvedDeletions: { at: NOW, paths: ['a.md', 'z.md'] } },
      NOW,
    );
    expect(next.suspiciousDeletions).toBeUndefined();
    expect(next.keptDeletions?.paths).toEqual(['a.md']);
    expect(next.approvedDeletions?.paths).toEqual(['z.md']);
  });
});

describe('garde-fou côté moteur', () => {
  it('un cycle commencé AVANT la confirmation ne relève pas l’alerte des chemins approuvés (régression « l’alerte revient »)', () => {
    const current: PendingReview = { approvedDeletions: { at: NOW, paths: ['a.md', 'b.md'] } };
    const { next, raised } = mergeGuardSuspension(current, ['a.md', 'b.md'], NOW);
    expect(raised).toBe(false);
    expect(next.suspiciousDeletions).toBeUndefined();
    expect(next.approvedDeletions?.paths).toEqual(['a.md', 'b.md']);
  });

  it('ne relève que les chemins non tranchés', () => {
    const { next, raised } = mergeGuardSuspension({ keptDeletions: { at: NOW, paths: ['a.md'] } }, ['a.md', 'b.md'], NOW);
    expect(raised).toBe(true);
    expect(next.suspiciousDeletions).toEqual({ at: NOW, count: 1, paths: ['b.md'] });
  });

  it('fin de cycle sans suspension : alerte périmée retirée, approbations appliquées consommées', () => {
    const { next, clearedAlert } = settleReviewAfterCycle(
      {
        suspiciousDeletions: { at: NOW, count: 2, paths: ['a.md', 'b.md'] },
        approvedDeletions: { at: NOW, paths: ['a.md', 'b.md'] },
      },
      { guardSuspended: false, tombstoned: new Set(['a.md']), local: new Set(), remoteActive: new Set(['b.md']), nowIso: NOW },
    );
    expect(clearedAlert).toBe(true);
    expect(next.suspiciousDeletions).toBeUndefined();
    expect(next.approvedDeletions?.paths).toEqual(['b.md']);
  });

  it('fin de cycle suspendu : alerte conservée', () => {
    const { next, clearedAlert } = settleReviewAfterCycle(
      { suspiciousDeletions: { at: NOW, count: 1, paths: ['a.md'] } },
      { guardSuspended: true, tombstoned: new Set(), local: new Set(), remoteActive: new Set(['a.md']), nowIso: NOW },
    );
    expect(clearedAlert).toBe(false);
    expect(next.suspiciousDeletions?.paths).toEqual(['a.md']);
  });

  it('chemins conservés : consommés une fois revenus ici (ou disparus du cloud)', () => {
    const { next } = settleReviewAfterCycle(
      { keptDeletions: { at: NOW, paths: ['back.md', 'gone.md', 'wait.md'] } },
      {
        guardSuspended: false,
        tombstoned: new Set(),
        local: new Set(['back.md']),
        remoteActive: new Set(['back.md', 'wait.md']),
        nowIso: NOW,
      },
    );
    expect(next.keptDeletions?.paths).toEqual(['wait.md']);
  });

  it('conserver : le plan RAPATRIE au lieu de resupprimer (plus de garde-fou relevé)', () => {
    const paths = many(30);
    const remote = paths.map((p) => ({ relPath: p, hash: 'h', deleted: false, version: 1 }));
    const fullBase = Object.fromEntries(paths.map((p) => [p, 'h']));
    const local = [{ relPath: 'reste.md', hash: 'r' }];
    const before = planSync({ local, remote, base: Object.fromEntries(Object.entries(fullBase).map(([p, h]) => [p, { hash: h }])) });
    expect(before.guard.suspended).toBe(true);
    const kept = baseWithoutKept(fullBase, { keptDeletions: { at: NOW, paths } });
    const after = planSync({ local, remote, base: Object.fromEntries(Object.entries(kept).map(([p, h]) => [p, { hash: h }])) });
    expect(after.guard.suspended).toBe(false);
    expect(after.actions.filter((a) => a.kind === 'pull').length).toBe(30);
    expect(after.actions.some((a) => a.kind === 'tombstone-remote')).toBe(false);
  });

  it('confirmer : le plan applique les suppressions approuvées sans relever le garde-fou', () => {
    const paths = many(30);
    const remote = paths.map((p) => ({ relPath: p, hash: 'h', deleted: false, version: 1 }));
    const base = Object.fromEntries(paths.map((p) => [p, { hash: 'h' }]));
    const plan = planSync({ local: [{ relPath: 'reste.md', hash: 'r' }], remote, base, guard: { approved: new Set(paths) } });
    expect(plan.guard.suspended).toBe(false);
    expect(plan.actions.filter((a) => a.kind === 'tombstone-remote').length).toBe(30);
  });
});

describe('confirmMassDeletions / keepMassDeletions', () => {
  it('enregistre la décision sur la file relue, sans aucun effet cloud direct', async () => {
    const vault = memoryVault({
      suspiciousDeletions: { at: NOW, count: 2, paths: ['a.md', 'b.md'] },
      remoteDeletions: [{ path: 'r.md', at: NOW } as never],
    });
    const outcome = await confirmMassDeletions({ vault, now: () => new Date(NOW) });
    expect(outcome).toEqual({ count: 2 });
    expect(vault.review().approvedDeletions?.paths).toEqual(['a.md', 'b.md']);
    expect(vault.review().suspiciousDeletions).toBeUndefined();
    expect(vault.review().remoteDeletions).toHaveLength(1);
  });

  it('rien en attente : rien d’écrit', async () => {
    const vault = memoryVault({});
    expect(await confirmMassDeletions({ vault })).toEqual({ count: 0 });
    expect(vault.review().approvedDeletions).toBeUndefined();
  });

  it('INCIDENT 16/11 : un fichier confirmé mais PRÉSENT ici n’est jamais supprimé dans le cloud', async () => {
    // L'alerte listait « Scènes The Eleven.md » comme manquant ; le fichier
    // est revenu sur le disque avant le clic. La décision est enregistrée,
    // mais le plan du cycle suivant (fichier présent, identique au cloud et
    // à la base) ne contient AUCUNE suppression : la note reste partout.
    const path = '🎥💫 Scènes The Eleven.md';
    const vault = memoryVault({ suspiciousDeletions: { at: NOW, count: 1, paths: [path] } });
    await confirmMassDeletions({ vault, now: () => new Date(NOW) });
    const approved = new Set(vault.review().approvedDeletions?.paths);
    const entry = { relPath: path, hash: 'h1' };
    const plan = planSync({
      local: [entry],
      remote: [{ ...entry, version: 3, deleted: false }],
      base: { [path]: { hash: 'h1' } },
      guard: { approved },
    } as never);
    expect(plan.actions.map((a) => a.kind)).toEqual(['noop']);
  });

  it('conserver : enregistre les chemins à rapatrier', async () => {
    const vault = memoryVault({ suspiciousDeletions: { at: NOW, count: 1, paths: ['a.md'] } });
    expect(await keepMassDeletions({ vault })).toEqual({ count: 1 });
    expect(vault.review().keptDeletions?.paths).toEqual(['a.md']);
    expect(vault.review().suspiciousDeletions).toBeUndefined();
  });
});
