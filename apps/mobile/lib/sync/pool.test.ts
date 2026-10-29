import { describe, expect, it, vi } from 'vitest';
import { runPool } from './pool';

describe('runPool', () => {
  it('traite tout, au plus `limit` en vol', async () => {
    let inFlight = 0;
    let peak = 0;
    const seen: number[] = [];
    await runPool([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 3, async (n) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      seen.push(n);
      inFlight -= 1;
    });
    expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(peak).toBe(3);
  });
  it('liste vide : aucun appel', async () => {
    const fn = vi.fn();
    await runPool([], 4, fn);
    expect(fn).not.toHaveBeenCalled();
  });
});
