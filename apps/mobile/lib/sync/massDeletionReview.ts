import { loadPendingReview, savePendingReview, type PendingReview } from './pendingReview';

// ✒️ 123ECRITURE — lib/sync/massDeletionReview.ts — décision sur le garde-fou des suppressions massives
//////////////////////////////////////////////////////////////////////////////
//
// Ce que deviennent « Confirmer les suppressions » et « Conserver
// (restaurer) » du bandeau de revue (SyncReviewSection.tsx), et ce que le
// moteur (syncEngine.ts) en fait. Fonctions PURES sur la file de revue
// (pending-review.json) + un orchestrateur testable sans réseau.
//
// Pourquoi ce module (bug 2026-11-16 : « je confirme, l'alerte revient »).
// Trois défauts s'additionnaient :
//   1. Le moteur ne RETIRAIT JAMAIS `suspiciousDeletions` : seule l'UI le
//      faisait. Un cycle déjà en cours au moment du clic (runSyncExclusive
//      n'attend que 3 s, un cycle Android dure bien plus) avait planifié
//      SANS l'approbation, relevait le garde-fou et RÉÉCRIVAIT
//      `suspiciousDeletions` par-dessus la décision — et plus aucun cycle
//      ne l'effaçait ensuite, même une fois les suppressions appliquées.
//   2. L'UI écrivait la file depuis son état affiché (jusqu'à 2,5 s de
//      retard) au lieu de la relire, et tombstonait le cloud AVANT de
//      persister l'approbation : un cycle intercalé voyait encore des
//      suppressions non approuvées.
//   3. « Conserver » effaçait seulement l'alerte : la base de synchro
//      référençait toujours les fichiers, le cycle suivant replanifiait les
//      mêmes suppressions et relevait le garde-fou.
//
// Invariants du fichier :
//   • Une décision est PERSISTÉE AVANT tout effet réseau, sur une file
//     RELUE (jamais l'état affiché) ; elle survit à un échec réseau (le
//     moteur l'applique au cycle suivant via tombstone_file).
//   • Le garde-fou ne relève JAMAIS un chemin déjà approuvé ou conservé
//     (mergeGuardSuspension), même par un cycle commencé avant la décision.
//   • `suspiciousDeletions` est retiré par le moteur dès qu'un cycle ne
//     suspend plus rien (settleReviewAfterCycle) : plus d'alerte fantôme.
//   • `keptDeletions` (Conserver) : le moteur oublie la base de ces chemins
//     → ils sont RAPATRIÉS depuis le cloud au lieu d'être resupprimés ;
//     consommé quand le fichier est revenu (ou n'existe plus dans le cloud).
//
// SOMMAIRE :
//   1. Décisions de l'utilisatrice (confirmation / conservation)
//   2. Côté moteur : suspension du garde-fou et solde de fin de cycle
//   3. Orchestrateur de la confirmation (persistance puis cloud)
//
//////////////////////////////////////////////////////////////////////////////

//////// 1. Décisions de l'utilisatrice ////////////////////////////////////////

function union(a: string[] | undefined, b: string[]): string[] {
  return [...new Set([...(a ?? []), ...b])];
}

// « Confirmer les suppressions » : alerte retirée, chemins approuvés
// (cumulés avec d'éventuelles approbations encore en cours), retirés des
// chemins « conservés ».
export function withMassDeletionsConfirmed(review: PendingReview, nowIso: string): { next: PendingReview; paths: string[] } {
  const paths = review.suspiciousDeletions?.paths ?? [];
  const kept = (review.keptDeletions?.paths ?? []).filter((p) => !paths.includes(p));
  const next: PendingReview = {
    ...review,
    suspiciousDeletions: undefined,
    approvedDeletions:
      paths.length > 0 || review.approvedDeletions ? { at: nowIso, paths: union(review.approvedDeletions?.paths, paths) } : undefined,
    keptDeletions: kept.length > 0 ? { at: review.keptDeletions?.at ?? nowIso, paths: kept } : undefined,
  };
  return { next, paths };
}

// « Conserver (restaurer) » : alerte retirée, chemins à rapatrier depuis
// le cloud (le moteur oublie leur base), jamais approuvés.
export function withMassDeletionsKept(review: PendingReview, nowIso: string): { next: PendingReview; paths: string[] } {
  const paths = review.suspiciousDeletions?.paths ?? [];
  const approved = (review.approvedDeletions?.paths ?? []).filter((p) => !paths.includes(p));
  const keptPaths = union(review.keptDeletions?.paths, paths);
  const next: PendingReview = {
    ...review,
    suspiciousDeletions: undefined,
    approvedDeletions: approved.length > 0 ? { at: review.approvedDeletions?.at ?? nowIso, paths: approved } : undefined,
    keptDeletions: keptPaths.length > 0 ? { at: nowIso, paths: keptPaths } : undefined,
  };
  return { next, paths };
}

//////// 2. Côté moteur ////////////////////////////////////////////////////////

// Le garde-fou s'est levé pour `deletions` : on écrit l'alerte sur la file
// COURANTE (relue), sans les chemins approuvés ou conservés entre-temps.
// Plus rien à demander → l'alerte est retirée (et `raised` = false).
export function mergeGuardSuspension(
  current: PendingReview,
  deletions: string[],
  nowIso: string,
): { next: PendingReview; raised: boolean } {
  const decided = new Set([...(current.approvedDeletions?.paths ?? []), ...(current.keptDeletions?.paths ?? [])]);
  const remaining = deletions.filter((p) => !decided.has(p));
  if (remaining.length === 0) return { next: { ...current, suspiciousDeletions: undefined }, raised: false };
  return {
    next: { ...current, suspiciousDeletions: { at: nowIso, count: remaining.length, paths: remaining } },
    raised: true,
  };
}

// Fin de cycle : approbations appliquées consommées, chemins conservés
// revenus consommés, alerte retirée si ce cycle n'a rien suspendu.
export function settleReviewAfterCycle(
  review: PendingReview,
  cycle: {
    guardSuspended: boolean;
    tombstoned: ReadonlySet<string>;
    local: ReadonlySet<string>;
    remoteActive: ReadonlySet<string>;
    nowIso: string;
  },
): { next: PendingReview; clearedAlert: boolean } {
  let next = review;
  const approved = review.approvedDeletions?.paths ?? [];
  if (approved.length > 0) {
    const stillPending = approved.filter((p) => !cycle.tombstoned.has(p) && !cycle.local.has(p));
    if (stillPending.length !== approved.length) {
      next = {
        ...next,
        approvedDeletions: stillPending.length > 0 ? { at: cycle.nowIso, paths: stillPending } : undefined,
      };
    }
  }
  const kept = review.keptDeletions?.paths ?? [];
  if (kept.length > 0) {
    const stillKept = kept.filter((p) => !cycle.local.has(p) && cycle.remoteActive.has(p));
    if (stillKept.length !== kept.length) {
      next = {
        ...next,
        keptDeletions: stillKept.length > 0 ? { at: review.keptDeletions?.at ?? cycle.nowIso, paths: stillKept } : undefined,
      };
    }
  }
  const clearedAlert = !cycle.guardSuspended && Boolean(review.suspiciousDeletions);
  if (clearedAlert) next = { ...next, suspiciousDeletions: undefined };
  return { next, clearedAlert };
}

// Base de synchro vue par le plan : les chemins « conservés » en sont
// retirés → absents ici, présents dans le cloud, sans base = RAPATRIÉS.
export function baseWithoutKept<T>(base: Record<string, T>, review: PendingReview): Record<string, T> {
  const kept = review.keptDeletions?.paths ?? [];
  if (kept.length === 0) return base;
  const out = { ...base };
  for (const p of kept) delete out[p];
  return out;
}

//////// 3. Orchestrateur de la confirmation ///////////////////////////////////

type ReviewVault = Parameters<typeof loadPendingReview>[0] & Parameters<typeof savePendingReview>[0];

export type ConfirmOutcome = {
  // Chemins approuvés : le MOTEUR les applique au cycle relancé juste après.
  count: number;
};

// INCIDENT 2026-11-16 (01:12) : « Confirmer les suppressions » marquait
// supprimées, d'un seul UPDATE direct, les 213 lignes cloud de la liste
// affichée — sans relire le disque, sans verrou de version. Or ces fichiers
// étaient (de nouveau) présents sur l'appareil : 213 notes vivantes
// effacées du cloud, puis proposées à la suppression sur les autres
// appareils. Désormais la confirmation ne fait QU'ENREGISTRER la décision ;
// le moteur l'applique fichier par fichier avec ses garanties :
//   • relecture directe du disque juste avant (fichier présent = rien) ;
//   • tombstone_file avec la version attendue (modifié ailleurs = rien) ;
//   • suppression locale seulement si le contenu est identique à la base.
export async function confirmMassDeletions(deps: { vault: ReviewVault; now?: () => Date }): Promise<ConfirmOutcome> {
  const nowIso = (deps.now?.() ?? new Date()).toISOString();
  // Décision persistée sur la file RELUE ; aucun effet réseau direct.
  const current = await loadPendingReview(deps.vault);
  const { next, paths } = withMassDeletionsConfirmed(current, nowIso);
  if (paths.length === 0) return { count: 0 };
  await savePendingReview(deps.vault, next);
  return { count: paths.length };
}

export async function keepMassDeletions(deps: { vault: ReviewVault; now?: () => Date }): Promise<{ count: number }> {
  const nowIso = (deps.now?.() ?? new Date()).toISOString();
  const current = await loadPendingReview(deps.vault);
  const { next, paths } = withMassDeletionsKept(current, nowIso);
  if (paths.length === 0) return { count: 0 };
  await savePendingReview(deps.vault, next);
  return { count: paths.length };
}
