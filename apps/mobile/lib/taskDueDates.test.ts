import { describe, expect, it } from 'vitest';

import { compareByDueDate, dueDateStatus, formatDueDate, normalizeDueDateInput } from './taskDueDates';

// `today` explicite partout : les statuts dépendent du jour courant, les
// tests doivent rester déterministes (même principe que buildMonthGrid).

describe('normalizeDueDateInput', () => {
  it('accepte le format ISO AAAA-MM-JJ', () => {
    expect(normalizeDueDateInput('2026-09-12')).toBe('2026-09-12');
    expect(normalizeDueDateInput('2026-9-2')).toBe('2026-09-02');
  });

  it('accepte le format français JJ/MM/AAAA et JJ-MM-AAAA', () => {
    expect(normalizeDueDateInput('12/09/2026')).toBe('2026-09-12');
    expect(normalizeDueDateInput('1/12/2026')).toBe('2026-12-01');
    expect(normalizeDueDateInput('31-12-2026')).toBe('2026-12-31');
  });

  it('tolère les espaces autour de la saisie', () => {
    expect(normalizeDueDateInput('  2026-09-12  ')).toBe('2026-09-12');
  });

  it('refuse ce qui n’est pas une date', () => {
    expect(normalizeDueDateInput('demain')).toBeNull();
    expect(normalizeDueDateInput('12/09')).toBeNull();
    expect(normalizeDueDateInput('')).toBeNull();
    expect(normalizeDueDateInput('2026-13-01')).toBeNull(); // mois 13
    expect(normalizeDueDateInput('2026-02-31')).toBeNull(); // 31 février
  });
});

describe('dueDateStatus', () => {
  const today = new Date(2026, 8, 12); // 12 septembre 2026

  it('classe en retard avant aujourd’hui', () => {
    expect(dueDateStatus('2026-09-11', today)).toBe('overdue');
    expect(dueDateStatus('2025-12-31', today)).toBe('overdue');
  });

  it('classe « aujourd’hui » et « à venir »', () => {
    expect(dueDateStatus('2026-09-12', today)).toBe('today');
    expect(dueDateStatus('2026-09-13', today)).toBe('upcoming');
  });

  it('retourne null sans échéance exploitable', () => {
    expect(dueDateStatus(null, today)).toBeNull();
    expect(dueDateStatus(undefined, today)).toBeNull();
    expect(dueDateStatus('pas-une-date', today)).toBeNull();
  });
});

describe('formatDueDate', () => {
  const today = new Date(2026, 8, 12);

  it('omet l’année quand elle est celle de today', () => {
    expect(formatDueDate('2026-09-20', today)).toBe('20 sept.');
  });

  it('garde l’année pour une échéance d’une autre année', () => {
    expect(formatDueDate('2027-01-05', today)).toBe('5 janv. 2027');
    expect(formatDueDate('2025-12-24', today)).toBe('24 déc. 2025');
  });
});

describe('compareByDueDate', () => {
  it('trie croissant, sans échéance en fin', () => {
    const dates = [null, '2026-09-20', '2026-09-13', undefined, '2026-09-13'];
    expect([...dates].sort(compareByDueDate)).toEqual(['2026-09-13', '2026-09-13', '2026-09-20', null, undefined]);
  });

  it('est stable entre égaux et entre deux absentes', () => {
    expect(compareByDueDate('2026-09-13', '2026-09-13')).toBe(0);
    expect(compareByDueDate(null, undefined)).toBe(0);
  });
});
