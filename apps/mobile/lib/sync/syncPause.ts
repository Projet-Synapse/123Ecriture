import type { SyncJournalEntry } from './journal';
import { SYNC_ERROR_BLOCK_THRESHOLD, type PendingReview } from './pendingReview';
import type { SyncSettings } from './syncSettings';
import type { SyncPauseReason, SyncSummary } from './syncTypes';

// ✒️ 123ECRITURE — lib/sync/syncPause.ts — la synchro est-elle en pause, et pourquoi ?
//////////////////////////////////////////////////////////////////////////////
//
// Demande (2026-11-16) : « des fois, la synchronisation était en pause et je
// ne le savais pas ». Cause : quand la synchro est désactivée, en pause
// après une mise à jour de l'app, limitée au Wi-Fi…, le moteur rendait un
// résumé VIDE et SANS ERREUR. L'indicateur affichait alors « À jour · hh:mm »
// alors que rien n'avait été synchronisé. Le disjoncteur et le verrou à
// distance apparaissaient comme une « Erreur de sync » générique. Une
// session expirée faisait carrément disparaître l'indicateur, et le
// garde-fou des suppressions ne se voyait que dans Paramètres.
//
// Ce module (PUR, testé) dit à l'indicateur et au journal :
//   • derivePause : l'état « en pause » et sa raison. La plupart des
//     raisons sont connues SANS attendre un cycle (réglages, réseau,
//     session, file de revue) : l'indicateur les montre À L'AVANCE.
//   • deriveWarning : ce qui va bientôt mettre la synchro en pause
//     (erreurs qui approchent du seuil du disjoncteur).
//   • pauseTransitionEntries : les entrées DATÉES « Synchro EN PAUSE » et
//     « Synchro reprise » pour le journal, sans doublon.
//
//////////////////////////////////////////////////////////////////////////////

export type SyncPauseKind = SyncPauseReason | 'signed-out' | 'offline' | 'auth' | 'deletion-review' | 'auto-off';

export type SyncPause = {
  kind: SyncPauseKind;
  // Libellé court pour l'indicateur (puce de l'en-tête).
  label: string;
  // Phrase complète pour le journal et le bandeau : raison + quoi faire.
  detail: string;
  // true = plus RIEN ne se synchronise ; false = synchro partielle (seules
  // les suppressions sont retenues, ou pas de cycle automatique).
  blocking: boolean;
};

export type SyncPauseInput = {
  vaultCloudLinked: boolean;
  signedIn: boolean;
  authLoading?: boolean;
  remoteVaultId: string | null;
  // navigator.onLine — undefined quand la plateforme ne le dit pas (RN).
  online: boolean | undefined;
  cellular: boolean;
  settings: Pick<SyncSettings, 'enabled' | 'perVault' | 'pausedAfterUpdate' | 'wifiOnly'>;
  autoSyncEnabled: boolean;
  lastSummary: SyncSummary | null;
  lastError: string | null;
  review: Pick<PendingReview, 'syncBlocked' | 'suspiciousDeletions'> | null;
};

const PAUSES: Record<SyncPauseKind, Omit<SyncPause, 'kind'>> = {
  'signed-out': {
    label: 'En pause : déconnectée',
    detail: 'session cloud fermée ou expirée — reconnecte-toi dans Paramètres → Compte et synchronisation.',
    blocking: true,
  },
  disabled: {
    label: 'En pause : désactivée',
    detail: 'synchronisation désactivée dans Paramètres → Synchronisation.',
    blocking: true,
  },
  'vault-disabled': {
    label: 'En pause : coffre exclu',
    detail: 'synchronisation désactivée pour ce coffre (Paramètres → Synchronisation).',
    blocking: true,
  },
  'after-update': {
    label: 'En pause : mise à jour',
    detail: 'mise à jour de l’app détectée — rien n’est envoyé tant que tu n’as pas confirmé la reprise (Paramètres → Synchronisation).',
    blocking: true,
  },
  offline: {
    label: 'En pause : hors ligne',
    detail: 'pas de réseau — la synchro reprendra d’elle-même au retour de la connexion.',
    blocking: true,
  },
  'wifi-only': {
    label: 'En pause : Wi-Fi requis',
    detail: 'réglage « Wi-Fi uniquement » et réseau mobile détecté — reprise au retour du Wi-Fi.',
    blocking: true,
  },
  auth: {
    label: 'En pause : connexion refusée',
    detail: 'le cloud refuse la session (jeton expiré ?) — reconnecte-toi dans Paramètres → Compte et synchronisation.',
    blocking: true,
  },
  'circuit-breaker': {
    label: 'En pause : disjoncteur',
    detail: 'trop d’erreurs au dernier cycle — protection activée. Lève-la dans Paramètres → Journal de synchronisation.',
    blocking: true,
  },
  'device-locked': {
    label: 'En pause : appareil verrouillé',
    detail: 'cet appareil a été verrouillé à distance (carte « Appareils connectés »).',
    blocking: true,
  },
  'no-local-vault': {
    label: 'En pause : aucun dossier',
    detail: 'aucun coffre local actif sur cet appareil — choisis un dossier (Paramètres → Coffres).',
    blocking: true,
  },
  'not-linked': {
    label: 'En pause : coffre non lié',
    detail: 'le coffre actif n’est pas lié au cloud.',
    blocking: true,
  },
  'deletion-review': {
    label: 'Suppressions en pause',
    detail:
      'garde-fou : des suppressions massives attendent ta décision (Paramètres → Journal de synchronisation). Le reste se synchronise.',
    blocking: false,
  },
  'auto-off': {
    label: 'Synchro auto désactivée',
    detail: 'synchronisation automatique désactivée — rien ne part sans « Synchroniser maintenant ».',
    blocking: false,
  },
};

export function pauseOf(kind: SyncPauseKind, extra?: string): SyncPause {
  const base = PAUSES[kind];
  return { kind, ...base, detail: extra ? `${base.detail} (${extra})` : base.detail };
}

const OFFLINE_RE =
  /failed to fetch|network ?request failed|networkerror|fetch failed|err_internet_disconnected|enotfound|econnrefused|etimedout|hors ligne|offline/i;
const AUTH_RE =
  /jwt|not authenticated|invalid refresh token|refresh_token|unauthorized|\b401\b|session (expirée|absente)|auth session missing/i;

// Erreur de cycle qui veut dire « pas de réseau » ou « session refusée ».
export function classifySyncError(message: string | null | undefined): 'offline' | 'auth' | null {
  if (!message) return null;
  if (AUTH_RE.test(message)) return 'auth';
  if (OFFLINE_RE.test(message)) return 'offline';
  return null;
}

// Raisons du moteur qui se déduisent AUSSI des réglages : on se fie aux
// réglages (à jour tout de suite) plutôt qu'au résumé du dernier cycle
// (périmé dès que l'utilisatrice relance la synchro).
const SETTINGS_REASONS = new Set<SyncPauseReason>(['disabled', 'vault-disabled', 'after-update', 'wifi-only', 'circuit-breaker']);

export function derivePause(input: SyncPauseInput): SyncPause | null {
  if (!input.vaultCloudLinked) return null;
  if (!input.signedIn) return input.authLoading ? null : pauseOf('signed-out');
  const { settings } = input;
  if (!settings.enabled) return pauseOf('disabled');
  if (input.remoteVaultId && settings.perVault[input.remoteVaultId] === false) return pauseOf('vault-disabled');
  if (settings.pausedAfterUpdate) return pauseOf('after-update');
  if (input.online === false) return pauseOf('offline');
  if (settings.wifiOnly && input.cellular) return pauseOf('wifi-only');
  if (input.review?.syncBlocked) return pauseOf('circuit-breaker', `${input.review.syncBlocked.errorCount} erreur(s)`);
  const engine = input.lastSummary?.paused;
  if (engine && !SETTINGS_REASONS.has(engine.reason)) return pauseOf(engine.reason);
  const errorKind = classifySyncError(input.lastError);
  if (errorKind) return pauseOf(errorKind);
  const suspicious = input.review?.suspiciousDeletions;
  if (suspicious) return pauseOf('deletion-review', `${suspicious.count} fichier(s)`);
  if (!input.autoSyncEnabled) return pauseOf('auto-off');
  return null;
}

// Avertissement AVANT la pause : des erreurs qui s'accumulent vers le seuil
// du disjoncteur (à SYNC_ERROR_BLOCK_THRESHOLD, la synchro s'arrête).
export function deriveWarning(input: Pick<SyncPauseInput, 'lastSummary'>): string | null {
  const errors = input.lastSummary?.errors.length ?? 0;
  const warnAt = Math.ceil(SYNC_ERROR_BLOCK_THRESHOLD / 2);
  if (errors >= warnAt && errors < SYNC_ERROR_BLOCK_THRESHOLD) {
    return `${errors} erreur(s) au dernier cycle — à ${SYNC_ERROR_BLOCK_THRESHOLD}, la synchro se met en pause (disjoncteur).`;
  }
  return null;
}

//////// Journal : entrées datées de pause / reprise ///////////////////////////

export type LoggedPause = { kind: string; at: string } | null;

// Dernier état « pause » écrit dans le journal (pour ne pas réécrire la même
// pause à chaque lancement de l'app).
export function lastLoggedPause(entries: SyncJournalEntry[]): LoggedPause {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e.type === 'sync-resume') return null;
    if (e.type === 'sync-pause') return { kind: e.reason ?? 'inconnue', at: e.t };
  }
  return null;
}

function formatDuration(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60_000));
  if (min < 1) return 'moins d’une minute';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} h ${String(min % 60).padStart(2, '0')}`;
  return `${Math.floor(h / 24)} jour(s)`;
}

export function pauseTransitionEntries(previous: LoggedPause, next: SyncPause | null, now: Date = new Date()): SyncJournalEntry[] {
  const t = now.toISOString();
  if (!next) {
    if (!previous) return [];
    const since = Date.parse(previous.at);
    const label = PAUSES[previous.kind as SyncPauseKind]?.label ?? previous.kind;
    return [
      {
        t,
        type: 'sync-resume',
        detail: `après ${Number.isFinite(since) ? formatDuration(now.getTime() - since) : '?'} (${label.toLowerCase()})`,
      },
    ];
  }
  if (previous?.kind === next.kind) return [];
  return [{ t, type: 'sync-pause', detail: next.detail, reason: next.kind }];
}
