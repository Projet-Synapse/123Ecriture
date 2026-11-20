import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTypingCommitter } from './typingCommit';

describe('createTypingCommitter', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('publie une seule fois après la pause, pas à chaque frappe', () => {
    const commit = vi.fn();
    const c = createTypingCommitter({ delayMs: 250, maxWaitMs: 1000, commit });
    for (let i = 0; i < 5; i++) {
      c.schedule();
      vi.advanceTimersByTime(50);
    }
    expect(commit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(250);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(c.isPending()).toBe(false);
  });

  it('frappe continue : publication au plus tard après maxWait', () => {
    const commit = vi.fn();
    const c = createTypingCommitter({ delayMs: 250, maxWaitMs: 1000, commit });
    for (let i = 0; i < 30; i++) {
      c.schedule();
      vi.advanceTimersByTime(100);
    }
    expect(commit.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(commit.mock.calls.length).toBeLessThanOrEqual(4);
  });

  it('cancel abandonne, flush publie tout de suite', () => {
    const commit = vi.fn();
    const c = createTypingCommitter({ delayMs: 250, maxWaitMs: 1000, commit });
    c.schedule();
    c.cancel();
    vi.advanceTimersByTime(2000);
    expect(commit).not.toHaveBeenCalled();
    c.schedule();
    c.flush();
    expect(commit).toHaveBeenCalledTimes(1);
    c.flush();
    expect(commit).toHaveBeenCalledTimes(1);
  });
});
