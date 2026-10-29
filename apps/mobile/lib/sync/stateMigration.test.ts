import { describe, expect, it } from 'vitest';
import { holdDeletionsUntilIndexed, migrateSyncStateFiles, SYNC_STATE_VERSION } from './stateMigration';
import { planSync } from './threeWay';
import { EMPTY_SHA256, folderToMarker } from './folderMarker';

const absent = folderToMarker('2. 🦸🏼 L\'HOMME VOLANT/🗒️ RÉSUMÉS/4. 👥 FACTIONS/⚖️ INSTITUTIONS');
const present = folderToMarker('A');
const files = { [absent]: EMPTY_SHA256, [present]: EMPTY_SHA256, 'a.md': 'h' };

describe('migration v2 des marqueurs de dossier', () => {
  it('retire de la base les marqueurs absents localement, garde le reste', () => {
    const r = migrateSyncStateFiles(files, undefined, new Set([present]));
    expect(r.dropped).toEqual([absent]);
    expect(Object.keys(r.files).sort()).toEqual(['a.md', present].sort());
  });

  it('dossier absent après migration : RECRÉÉ (pull), jamais tombstoné', () => {
    const { files: base } = migrateSyncStateFiles(files, 1, new Set([present]));
    const plan = planSync({
      local: [{ relPath: present, hash: EMPTY_SHA256, kind: 'folder' }, { relPath: 'a.md', hash: 'h' }],
      remote: [
        { relPath: absent, hash: EMPTY_SHA256, deleted: false, kind: 'folder' },
        { relPath: present, hash: EMPTY_SHA256, deleted: false, kind: 'folder' },
        { relPath: 'a.md', hash: 'h', deleted: false },
      ],
      base: Object.fromEntries(Object.entries(base).map(([p, h]) => [p, { hash: h }])),
    });
    expect(plan.actions.find((a) => a.relPath === absent)?.kind).toBe('pull');
    expect(plan.actions.some((a) => a.kind === 'tombstone-remote')).toBe(false);
  });

  it('usage unique : état déjà en v2 = aucune modification', () => {
    const r = migrateSyncStateFiles(files, SYNC_STATE_VERSION, new Set());
    expect(r.dropped).toEqual([]);
    expect(r.files).toBe(files);
  });
});

describe('aucune suppression avant le premier parcours complet', () => {
  const plan = planSync({
    local: [{ relPath: 'b.md', hash: 'x' }],
    remote: [
      { relPath: 'a.md', hash: 'h', deleted: false },
      { relPath: present, hash: EMPTY_SHA256, deleted: false, kind: 'folder' },
      { relPath: 'b.md', hash: 'x', deleted: true },
    ],
    base: { 'a.md': { hash: 'h' }, [present]: { hash: EMPTY_SHA256, kind: 'folder' }, 'b.md': { hash: 'x' } },
  });

  it('index partiel : tombstones et suppressions locales retenues', () => {
    expect(plan.actions.map((a) => a.kind).sort()).toEqual(['delete-local', 'tombstone-remote', 'tombstone-remote']);
    const r = holdDeletionsUntilIndexed(plan, false);
    expect(r.plan.actions).toEqual([]);
    expect(r.held.sort()).toEqual(['a.md', 'b.md', present].sort());
  });

  it('index complet : suppressions propagées (dossier comme note)', () => {
    expect(holdDeletionsUntilIndexed(plan, true).plan.actions).toHaveLength(3);
  });
});
