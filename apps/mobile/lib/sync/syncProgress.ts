//////////////////////////////////////////////////////////////////////////////
// PROGRESSION DU CYCLE (syncProgress.ts)
//
// État observable « X/Y fichiers » du cycle en cours, lu par l'UI
// (SyncStatusContext → indicateur) et par le watchdog d'INACTIVITÉ : tant
// que la progression avance, un long premier pull n'est jamais révoqué.
// + withTimeout : borne toute opération fichier (une promesse native qui ne
// répond jamais ne fige plus le cycle).
//////////////////////////////////////////////////////////////////////////////

export type SyncProgress = {
  phase: string;
  done: number;
  total: number;
  current?: string;
  at: number;
};

let current: SyncProgress | null = null;
const listeners = new Set<(progress: SyncProgress | null) => void>();

export function setSyncProgress(progress: Omit<SyncProgress, 'at'> | null): void {
  current = progress ? { ...progress, at: Date.now() } : null;
  for (const listener of listeners) {
    try {
      listener(current);
    } catch {
      // un abonné défaillant ne casse jamais le cycle
    }
  }
}

export function getSyncProgress(): SyncProgress | null {
  return current;
}

export function subscribeSyncProgress(listener: (progress: SyncProgress | null) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function formatSyncProgress(progress: SyncProgress | null): string | null {
  if (!progress) return null;
  if (progress.total > 0) return `${progress.phase} ${progress.done}/${progress.total}${/dossier/i.test(progress.phase) ? '' : ' fichiers'}`;
  return progress.phase;
}

// Délai par fichier (téléchargement + écriture SAF, ou lecture + envoi).
export const FILE_OP_TIMEOUT_MS = 90_000;
// Étapes globales (liste distante, hachage du coffre local).
export const STEP_TIMEOUT_MS = 10 * 60_000;

export class SyncTimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`délai dépassé (${Math.round(ms / 1000)} s) : ${label}`);
    this.name = 'SyncTimeoutError';
  }
}

export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new SyncTimeoutError(label, ms)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}
