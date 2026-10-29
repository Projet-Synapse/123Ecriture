//////////////////////////////////////////////////////////////////////////////
// manualSync — le bouton « Synchroniser maintenant » se TERMINE toujours.
//
// Avant : le bouton affichait le statut GLOBAL (« syncing ») — n'importe
// quel cycle automatique (démarrage, surveillance, temps réel, 2 min) ou un
// cycle très long (analyse du coffre) le laissait tourner sans fin, et un
// appui pendant un cycle en cours ne recevait aucune réponse.
// Maintenant : attente bornée, résultat ou erreur toujours rendus.
//////////////////////////////////////////////////////////////////////////////

export const MANUAL_SYNC_MAX_WAIT_MS = 2 * 60_000;

export type ManualSyncOutcome =
  | { kind: 'done' }
  | { kind: 'error'; message: string }
  | { kind: 'background' };

export async function awaitManualSync(
  run: () => Promise<unknown>,
  maxWaitMs: number = MANUAL_SYNC_MAX_WAIT_MS,
): Promise<ManualSyncOutcome> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<ManualSyncOutcome>((resolve) => {
    timer = setTimeout(() => resolve({ kind: 'background' }), maxWaitMs);
  });
  const work = run().then(
    (): ManualSyncOutcome => ({ kind: 'done' }),
    (error: unknown): ManualSyncOutcome => ({
      kind: 'error',
      message: error instanceof Error ? error.message : String(error),
    }),
  );
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
