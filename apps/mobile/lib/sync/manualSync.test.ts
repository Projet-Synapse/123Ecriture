import { describe, expect, it, vi } from 'vitest';
import { awaitManualSync } from './manualSync';

describe('awaitManualSync', () => {
  it('cycle terminé : done', async () => {
    await expect(awaitManualSync(async () => undefined, 1000)).resolves.toEqual({ kind: 'done' });
  });
  it('cycle en erreur : message rendu, jamais de rejet', async () => {
    await expect(awaitManualSync(async () => { throw new Error('boom'); }, 1000)).resolves.toEqual({ kind: 'error', message: 'boom' });
  });
  it('cycle qui ne rend jamais la main : le bouton se libère quand même', async () => {
    vi.useFakeTimers();
    const p = awaitManualSync(() => new Promise(() => undefined), 5000);
    await vi.advanceTimersByTimeAsync(5000);
    await expect(p).resolves.toEqual({ kind: 'background' });
    vi.useRealTimers();
  });
});
