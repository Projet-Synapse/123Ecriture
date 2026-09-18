import { describe, expect, it } from 'vitest';

import { formatLastSeen, sortDevicesByLastSeen } from './devices';

// formatLastSeen — dates relatives en français (voir devices.ts pour la
// grille exacte). Toutes les dates sont construites en HEURE LOCALE
// (new Date(année, mois, jour, ...)) : le test doit passer quel que soit le
// fuseau de la machine qui l'exécute, et formatLastSeen compare justement
// des jours calendaires locaux.
const NOW = new Date(2026, 8, 18, 15, 0).getTime(); // 18/09/2026 15h00 local

describe('formatLastSeen', () => {
  it('affiche « à l’instant » sous une minute', () => {
    expect(formatLastSeen(new Date(NOW - 30 * 1000).toISOString(), NOW)).toBe('à l’instant');
  });

  it('affiche les minutes sous une heure', () => {
    expect(formatLastSeen(new Date(NOW - 5 * 60 * 1000).toISOString(), NOW)).toBe('il y a 5 min');
    expect(formatLastSeen(new Date(NOW - 59 * 60 * 1000).toISOString(), NOW)).toBe('il y a 59 min');
  });

  it('affiche « aujourd’hui » plus tôt dans la même journée', () => {
    expect(formatLastSeen(new Date(2026, 8, 18, 10, 0).toISOString(), NOW)).toBe('aujourd’hui');
  });

  it('compare en calendrier : vu hier soir à travers minuit = « hier »', () => {
    expect(formatLastSeen(new Date(2026, 8, 17, 23, 0).toISOString(), NOW)).toBe('hier');
    expect(formatLastSeen(new Date(2026, 8, 17, 1, 0).toISOString(), NOW)).toBe('hier');
  });

  it('affiche le jour/mois les jours précédents, avec l’année si différente', () => {
    expect(formatLastSeen(new Date(2026, 8, 10, 10, 0).toISOString(), NOW)).toBe('le 10/09');
    expect(formatLastSeen(new Date(2025, 11, 31, 10, 0).toISOString(), NOW)).toBe('le 31/12/2025');
  });

  it('dégrade proprement sur une date invalide', () => {
    expect(formatLastSeen('pas-une-date', NOW)).toBe('date inconnue');
  });
});

describe('sortDevicesByLastSeen', () => {
  it('trie du plus récemment vu au plus ancien sans muter l’entrée', () => {
    const oldest = { deviceId: 'a', name: 'Vieux', lastSeenAt: '2026-09-01T10:00:00.000Z' };
    const newest = { deviceId: 'b', name: 'Récent', lastSeenAt: '2026-09-18T14:00:00.000Z' };
    const middle = { deviceId: 'c', name: 'Moyen', lastSeenAt: '2026-09-10T10:00:00.000Z' };
    const input = [oldest, newest, middle];
    expect(sortDevicesByLastSeen(input).map((d) => d.deviceId)).toEqual(['b', 'c', 'a']);
    expect(input.map((d) => d.deviceId)).toEqual(['a', 'b', 'c']);
  });
});
