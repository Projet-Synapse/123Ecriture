import { describe, expect, it } from 'vitest';

import { journalEntryLabel } from './journal';
import { classifySyncError, derivePause, deriveWarning, lastLoggedPause, pauseTransitionEntries, type SyncPauseInput } from './syncPause';

const base: SyncPauseInput = {
  vaultCloudLinked: true,
  signedIn: true,
  remoteVaultId: 'v1',
  online: true,
  cellular: false,
  settings: { enabled: true, perVault: {}, pausedAfterUpdate: false, wifiOnly: false },
  autoSyncEnabled: true,
  lastSummary: null,
  lastError: null,
  review: null,
};
const summary = (extra: object = {}) => ({
  pushed: 0,
  pulled: 0,
  deleted: 0,
  trashed: 0,
  modifications: 0,
  conflicts: 0,
  errors: [],
  ...extra,
});

describe('derivePause', () => {
  it('rien de configuré ou tout va bien → pas de pause', () => {
    expect(derivePause({ ...base, vaultCloudLinked: false })).toBeNull();
    expect(derivePause(base)).toBeNull();
  });

  it('pauses connues À L’AVANCE, sans attendre un cycle', () => {
    expect(derivePause({ ...base, signedIn: false })?.kind).toBe('signed-out');
    expect(derivePause({ ...base, signedIn: false, authLoading: true })).toBeNull();
    expect(derivePause({ ...base, settings: { ...base.settings, enabled: false } })?.kind).toBe('disabled');
    expect(derivePause({ ...base, settings: { ...base.settings, perVault: { v1: false } } })?.kind).toBe('vault-disabled');
    expect(derivePause({ ...base, settings: { ...base.settings, pausedAfterUpdate: true } })?.kind).toBe('after-update');
    expect(derivePause({ ...base, online: false })?.kind).toBe('offline');
    expect(derivePause({ ...base, cellular: true, settings: { ...base.settings, wifiOnly: true } })?.kind).toBe('wifi-only');
  });

  it('disjoncteur, verrou à distance, erreurs réseau / session', () => {
    const p = derivePause({ ...base, review: { syncBlocked: { at: 'x', errorCount: 12, samples: [] } } });
    expect(p?.kind).toBe('circuit-breaker');
    expect(p?.detail).toContain('12 erreur(s)');
    expect(derivePause({ ...base, lastSummary: summary({ paused: { reason: 'device-locked', detail: '' } }) })?.kind).toBe('device-locked');
    expect(derivePause({ ...base, lastError: 'TypeError: Failed to fetch' })?.kind).toBe('offline');
    expect(derivePause({ ...base, lastError: 'JWT expired' })?.kind).toBe('auth');
  });

  it('pause du moteur périmée (réglage déjà rétabli) ignorée', () => {
    expect(derivePause({ ...base, lastSummary: summary({ paused: { reason: 'disabled', detail: '' } }) })).toBeNull();
  });

  it('pauses partielles : garde-fou des suppressions, synchro auto coupée', () => {
    const p = derivePause({ ...base, review: { suspiciousDeletions: { at: 'x', count: 218, paths: [] } } });
    expect(p).toMatchObject({ kind: 'deletion-review', blocking: false });
    expect(p?.detail).toContain('218');
    expect(derivePause({ ...base, autoSyncEnabled: false })).toMatchObject({ kind: 'auto-off', blocking: false });
  });
});

describe('deriveWarning / classifySyncError', () => {
  it('prévient avant le disjoncteur', () => {
    expect(deriveWarning({ lastSummary: summary({ errors: ['a', 'b'] }) })).toBeNull();
    expect(deriveWarning({ lastSummary: summary({ errors: Array(6).fill('e') }) })).toContain('6 erreur(s)');
    expect(deriveWarning({ lastSummary: summary({ errors: Array(10).fill('e') }) })).toBeNull();
  });
  it('classe les erreurs', () => {
    expect(classifySyncError('Network request failed')).toBe('offline');
    expect(classifySyncError('Invalid Refresh Token: Refresh Token Not Found')).toBe('auth');
    expect(classifySyncError('conflit de version')).toBeNull();
  });
});

describe('journal : pause / reprise datées', () => {
  const now = new Date('2026-11-16T10:30:00.000Z');
  it('entrée de pause, puis rien tant que la raison ne change pas', () => {
    const pause = derivePause({ ...base, online: false });
    const entries = pauseTransitionEntries(null, pause, now);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ type: 'sync-pause', reason: 'offline', t: now.toISOString() });
    expect(journalEntryLabel(entries[0])).toMatch(/^Synchro EN PAUSE — pas de réseau/);
    expect(pauseTransitionEntries(lastLoggedPause(entries), pause, now)).toEqual([]);
  });

  it('reprise datée avec la durée de la pause', () => {
    const entries = pauseTransitionEntries({ kind: 'after-update', at: '2026-11-16T08:00:00.000Z' }, null, now);
    expect(entries[0].type).toBe('sync-resume');
    expect(journalEntryLabel(entries[0])).toBe('Synchro reprise — après 2 h 30 (en pause : mise à jour)');
  });

  it('changement de raison → nouvelle entrée ; dernier état relu du journal', () => {
    const entries = pauseTransitionEntries({ kind: 'offline', at: 'x' }, derivePause({ ...base, signedIn: false }), now);
    expect(entries[0]).toMatchObject({ type: 'sync-pause', reason: 'signed-out' });
    expect(lastLoggedPause([...entries, { t: 'y', type: 'sync-resume' }])).toBeNull();
    expect(lastLoggedPause([{ t: 'a', type: 'push' }, ...entries])?.kind).toBe('signed-out');
  });
});
