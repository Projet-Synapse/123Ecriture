import { beforeEach, describe, expect, it, vi } from 'vitest';

// Détection de mise à jour depuis une version antérieure à la détection
// (LORDI 0.4.90 → 0.4.96) : aucune lastSeenVersion enregistrée.
describe('checkAppUpdate', () => {
  beforeEach(() => {
    vi.resetModules();
    const store = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
  });
  it('vraie première installation (aucun coffre relié) : pas de pause', async () => {
    const m = await import('./syncSettings');
    expect((await m.checkAppUpdate('0.4.96-test.9', false)).pausedAfterUpdate).toBe(false);
  });
  it('ancienne version avec coffre déjà relié : pause', async () => {
    const m = await import('./syncSettings');
    expect((await m.checkAppUpdate('0.4.96-test.9', true)).pausedAfterUpdate).toBe(true);
  });
  it('relance de la même version : rien ne change', async () => {
    const m = await import('./syncSettings');
    await m.checkAppUpdate('0.4.96-test.9', false);
    expect((await m.checkAppUpdate('0.4.96-test.9', true)).pausedAfterUpdate).toBe(false);
  });
  it('mise à jour ordinaire (version vue différente) : pause', async () => {
    const m = await import('./syncSettings');
    await m.checkAppUpdate('0.4.96-test.8', false);
    expect((await m.checkAppUpdate('0.4.96-test.9', false)).pausedAfterUpdate).toBe(true);
  });
});
