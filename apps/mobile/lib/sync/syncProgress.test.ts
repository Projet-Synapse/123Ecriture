import { describe, expect, it, vi } from 'vitest';
import { formatSyncProgress, getSyncProgress, setSyncProgress, subscribeSyncProgress, withTimeout } from './syncProgress';

describe('syncProgress', () => {
  it('publie et formate X/Y fichiers', () => {
    const seen: (string | null)[] = [];
    const off = subscribeSyncProgress((p) => seen.push(formatSyncProgress(p)));
    setSyncProgress({ phase: 'Téléchargement', done: 3, total: 10 });
    expect(formatSyncProgress(getSyncProgress())).toBe('Téléchargement 3/10 fichiers');
    setSyncProgress(null);
    off();
    expect(seen).toEqual(['Téléchargement 3/10 fichiers', null]);
  });

  it('withTimeout rejette une promesse qui ne répond jamais', async () => {
    vi.useFakeTimers();
    const p = withTimeout(new Promise(() => undefined), 1000, 'pull x.md');
    const assertion = expect(p).rejects.toThrow(/délai dépassé.*pull x\.md/);
    await vi.advanceTimersByTimeAsync(1001);
    await assertion;
    vi.useRealTimers();
  });

  it('withTimeout laisse passer une promesse rapide', async () => {
    await expect(withTimeout(Promise.resolve(42), 1000, 'ok')).resolves.toBe(42);
  });
});
