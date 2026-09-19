import { describe, expect, it } from 'vitest';

import { capJournalEntries, journalEntryLabel, makeJournalEntry, SYNC_JOURNAL_MAX } from './journal';

// Journal de synchronisation (v0.4.27) — le pur : bornage de l'historique,
// construction d'entrées et libellés humains. La persistance (lecture/
// écriture via le pont vault) vit dans syncEngine.ts, volontairement non
// testée unitairement (effets de bord réels, même règle que le reste du
// moteur).

describe('capJournalEntries', () => {
  it('garde tout tant que la limite n’est pas atteinte', () => {
    const entries = [makeJournalEntry('push', { path: 'a.md' }), makeJournalEntry('pull', { path: 'b.md' })];
    expect(capJournalEntries(entries)).toHaveLength(2);
  });

  it('ne garde que les SYNC_JOURNAL_MAX plus récentes (fin de tableau)', () => {
    const entries = Array.from({ length: SYNC_JOURNAL_MAX + 250 }, (_unused, i) =>
      makeJournalEntry('push', { path: `note-${i}.md` }),
    );
    const capped = capJournalEntries(entries);
    expect(capped).toHaveLength(SYNC_JOURNAL_MAX);
    expect(capped[0].path).toBe(`note-250.md`);
    expect(capped[capped.length - 1].path).toBe(`note-${SYNC_JOURNAL_MAX + 249}.md`);
  });
});

describe('makeJournalEntry / journalEntryLabel', () => {
  it('construit une entrée horodatée avec chemin optionnel', () => {
    const fixed = new Date('2026-09-19T16:00:00.000Z');
    const entry = makeJournalEntry('pull', { path: 'Notes/x.md' }, () => fixed);
    expect(entry.t).toBe('2026-09-19T16:00:00.000Z');
    expect(entry.path).toBe('Notes/x.md');
    expect(journalEntryLabel(entry)).toBe('Reçu : Notes/x.md');
  });

  it('libellés humains pour chaque type clé', () => {
    expect(journalEntryLabel(makeJournalEntry('cycle-start', { detail: 'manuel' }))).toContain('Détection des changements');
    expect(journalEntryLabel(makeJournalEntry('cycle-end', { detail: '1 envoyé(s)' }))).toContain('Synchronisé');
    expect(journalEntryLabel(makeJournalEntry('delete', { path: 'a.md', detail: 'corbeille' }))).toContain('Supprimé : a.md');
    expect(journalEntryLabel(makeJournalEntry('error', { detail: 'boom' }))).toContain('Erreur : boom');
    expect(journalEntryLabel(makeJournalEntry('restore', { path: 'a.md' }))).toContain('Restauré : a.md');
  });
});
