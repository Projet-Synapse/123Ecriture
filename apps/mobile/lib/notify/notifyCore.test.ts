import { describe, expect, it } from 'vitest';
import {
  createNotifyStore,
  DEFAULT_DURATIONS,
  LEAVE_MS,
  linksUpdatedMessage,
  MAX_TOASTS,
  receivedFilesMessage,
} from './notifyCore';

function fakeClock() {
  let t = 0;
  let timers: { at: number; fn: () => void; id: number }[] = [];
  let next = 0;
  return {
    clock: {
      now: () => t,
      setTimer: (fn: () => void, ms: number) => {
        const id = ++next;
        timers.push({ at: t + ms, fn, id });
        return id;
      },
      clearTimer: (h: unknown) => {
        timers = timers.filter((x) => x.id !== h);
      },
    },
    advance(ms: number) {
      const end = t + ms;
      for (;;) {
        const due = timers.filter((x) => x.at <= end).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        timers = timers.filter((x) => x !== due);
        t = due.at;
        due.fn();
      }
      t = end;
    },
  };
}

describe('createNotifyStore', () => {
  it('apparaît puis disparaît seule (fondu puis retrait)', () => {
    const c = fakeClock();
    const s = createNotifyStore(c.clock);
    s.notify({ type: 'success', message: 'Enregistré' });
    expect(s.getToasts()).toHaveLength(1);
    c.advance(DEFAULT_DURATIONS.success);
    expect(s.getToasts()[0].leaving).toBe(true);
    c.advance(LEAVE_MS);
    expect(s.getToasts()).toHaveLength(0);
  });

  it('les erreurs restent plus longtemps ; duration 0 = jusqu’au clic', () => {
    const c = fakeClock();
    const s = createNotifyStore(c.clock);
    s.notify({ type: 'error', message: 'Échec' });
    const sticky = s.notify({ type: 'info', message: 'Collée', duration: 0 })!;
    c.advance(DEFAULT_DURATIONS.success + 1000);
    expect(s.getToasts().filter((t) => !t.leaving)).toHaveLength(2);
    c.advance(DEFAULT_DURATIONS.error + LEAVE_MS);
    expect(s.getToasts().map((t) => t.message)).toEqual(['Collée']);
    s.dismiss(sticky);
    c.advance(LEAVE_MS);
    expect(s.getToasts()).toHaveLength(0);
  });

  it('anti-spam : même message regroupé (×N) et délai relancé', () => {
    const c = fakeClock();
    const s = createNotifyStore(c.clock);
    s.notify({ type: 'error', message: 'Réseau' });
    c.advance(5000);
    s.notify({ type: 'error', message: 'Réseau' });
    expect(s.getToasts()).toHaveLength(1);
    expect(s.getToasts()[0].count).toBe(2);
    c.advance(DEFAULT_DURATIONS.error - 1);
    expect(s.getToasts()[0].leaving).toBe(false);
  });

  it('même clé, message différent : remplacé', () => {
    const s = createNotifyStore(fakeClock().clock);
    s.notify({ message: '1 nouveau fichier synchronisé', key: 'sync' });
    s.notify({ message: '3 nouveaux fichiers synchronisés', key: 'sync' });
    expect(s.getToasts()).toEqual([expect.objectContaining({ message: '3 nouveaux fichiers synchronisés', count: 1 })]);
  });

  it('throttle : pas de réaffichage avant le délai', () => {
    const c = fakeClock();
    const s = createNotifyStore(c.clock);
    expect(s.notify({ type: 'success', message: 'Enregistré', throttleMs: 60_000 })).not.toBeNull();
    c.advance(10_000);
    expect(s.notify({ type: 'success', message: 'Enregistré', throttleMs: 60_000 })).toBeNull();
    c.advance(60_000);
    expect(s.notify({ type: 'success', message: 'Enregistré', throttleMs: 60_000 })).not.toBeNull();
  });

  it('pile limitée : la plus ancienne non-erreur laisse sa place', () => {
    const s = createNotifyStore(fakeClock().clock);
    s.notify({ type: 'error', message: 'E' });
    for (let i = 0; i < MAX_TOASTS; i += 1) s.notify({ message: `m${i}` });
    expect(s.getToasts().map((t) => t.message)).toEqual(['E', 'm1', 'm2', 'm3']);
  });

  it('conserve une action de clic (suggestion Ellie)', () => {
    const s = createNotifyStore(fakeClock().clock);
    s.notify({
      type: 'info',
      message: 'Clarifier le titre',
      duration: 0,
      action: { kind: 'ellie-suggestion', body: 'Clarifier le titre de la note.' },
    });
    expect(s.getToasts()[0].action).toEqual({ kind: 'ellie-suggestion', body: 'Clarifier le titre de la note.' });
  });

  it('message vide ignoré ; abonnement notifié', () => {
    const s = createNotifyStore(fakeClock().clock);
    let calls = 0;
    const off = s.subscribe(() => (calls += 1));
    expect(s.notify({ message: '  ' })).toBeNull();
    s.notify({ message: 'ok' });
    off();
    s.notify({ message: 'ko' });
    expect(calls).toBe(1);
  });
});

describe('messages', () => {
  it('pluriels', () => {
    expect(linksUpdatedMessage(1, 1)).toBe('1 lien mis à jour dans 1 fichier');
    expect(linksUpdatedMessage(5, 3)).toBe('5 liens mis à jour dans 3 fichiers');
    expect(linksUpdatedMessage(5, 3, 2)).toBe('5 liens mis à jour dans 3 fichiers, dont 2 propriétés');
    expect(linksUpdatedMessage(1, 1, 1)).toBe('1 lien mis à jour dans 1 fichier, dont 1 propriété');
    expect(receivedFilesMessage(1)).toBe('1 nouveau fichier synchronisé');
    expect(receivedFilesMessage(3)).toBe('3 nouveaux fichiers synchronisés');
  });
});
