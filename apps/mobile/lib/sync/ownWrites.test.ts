import { beforeEach, describe, expect, it } from 'vitest';

import { noteOwnEdit, partitionWatchEvents, resetOwnWritesForTests } from './ownWrites';

describe('partitionWatchEvents', () => {
  beforeEach(() => resetOwnWritesForTests());

  it('la sauvegarde de la note en cours de frappe ne lance pas de cycle immédiat', () => {
    noteOwnEdit('Dossier/Note.md', 1_000);
    const r = partitionWatchEvents(['Dossier\\Note.md'], 3_000, 60_000);
    expect(r.others).toEqual([]);
    expect(r.ownHotUntil).toBe(61_000);
  });

  it('un autre fichier modifié déclenche le cycle comme avant', () => {
    noteOwnEdit('Note.md', 1_000);
    const r = partitionWatchEvents(['Note.md', 'Autre.md'], 2_000, 60_000);
    expect(r.others).toEqual(['Autre.md']);
  });

  it('une écriture redevenue froide est traitée normalement', () => {
    noteOwnEdit('Note.md', 1_000);
    expect(partitionWatchEvents(['Note.md'], 70_000, 60_000)).toEqual({ others: ['Note.md'], ownHotUntil: null });
  });
});
