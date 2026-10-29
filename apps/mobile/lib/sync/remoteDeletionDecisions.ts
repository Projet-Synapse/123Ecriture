// ✒️ 123ECRITURE — lib/sync/remoteDeletionDecisions.ts — trancher les suppressions distantes en attente
//
// Les décisions HUMAINES sur la file `remoteDeletions` de pending-review.json
// (écran « Revue de sécurité », mobile comme desktop/web) :
//   • approuver → le fichier local part dans la corbeille du coffre ;
//   • refuser   → la pierre tombale est levée dans le cloud (RPC
//     restore_file ; UPDATE direct seulement si le serveur est ancien).
// Une entrée n'est retirée de la file QUE si son action a réussi ; les
// échecs sont renvoyés à l'appelant (rien n'est avalé). Dépendances
// injectées : testable sans pont ni Supabase.
//
//////////////////////////////////////////////////////////////////////////////

import type { LockResult } from './versionLock';
import { loadPendingReview, savePendingReview, withoutRemoteDeletions } from './pendingReview';

export type DecisionDeps = {
  vault: {
    readNote: (relPath: string) => Promise<string>;
    writeNote: (relPath: string, content: string) => Promise<void>;
    delete: (relPath: string, options?: { silent?: boolean }) => Promise<unknown>;
  };
  restoreRemote: (relPath: string) => Promise<LockResult | null>;
  legacyUndelete: (relPaths: string[]) => Promise<void>;
};

export type DecisionOutcome = { done: string[]; failures: { path: string; error: string }[] };

function msg(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function commit(deps: DecisionDeps, done: string[]): Promise<void> {
  if (done.length === 0) return;
  // Relue juste avant l'écriture : jamais d'état périmé de l'UI.
  const review = await loadPendingReview(deps.vault);
  await savePendingReview(deps.vault, withoutRemoteDeletions(review, done));
}

export async function approveRemoteDeletions(deps: DecisionDeps, paths: string[]): Promise<DecisionOutcome> {
  const outcome: DecisionOutcome = { done: [], failures: [] };
  for (const path of paths) {
    try {
      await deps.vault.delete(path, { silent: true });
      outcome.done.push(path);
    } catch (error) {
      outcome.failures.push({ path, error: msg(error) });
    }
  }
  await commit(deps, outcome.done);
  return outcome;
}

export async function refuseRemoteDeletions(deps: DecisionDeps, paths: string[]): Promise<DecisionOutcome> {
  const outcome: DecisionOutcome = { done: [], failures: [] };
  const legacy: string[] = [];
  for (const path of paths) {
    try {
      const result = await deps.restoreRemote(path);
      if (result === null) legacy.push(path);
      // ok, ou conflit = la ligne est déjà vivante (recréée ailleurs) : dans
      // les deux cas plus rien à décider ici.
      else outcome.done.push(path);
    } catch (error) {
      outcome.failures.push({ path, error: msg(error) });
    }
  }
  if (legacy.length > 0) {
    try {
      await deps.legacyUndelete(legacy);
      outcome.done.push(...legacy);
    } catch (error) {
      for (const path of legacy) outcome.failures.push({ path, error: msg(error) });
    }
  }
  await commit(deps, outcome.done);
  return outcome;
}

export function describeFailures(outcome: DecisionOutcome): string | null {
  if (outcome.failures.length === 0) return null;
  const first = outcome.failures[0];
  return `${outcome.failures.length} échec(s) — ${first.path} : ${first.error}`;
}
