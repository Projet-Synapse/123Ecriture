import { describe, expect, it } from 'vitest';

import { isTrashRelPath, normalizeRelPath, selectRemoteRows } from './relPath';

describe('normalizeRelPath', () => {
  it.each([
    ['PROGRAMMATION\\Cours\\a.md', 'PROGRAMMATION/Cours/a.md'],
    ['a//b/c.md', 'a/b/c.md'],
    ['./a/b.md', 'a/b.md'],
    ['/a/b.md', 'a/b.md'],
    ['a/b/', 'a/b'],
    ['Été/Noël.md', 'Été/Noël.md'],
  ])('%s → %s', (input, expected) => expect(normalizeRelPath(input)).toBe(expected));
  it('ne touche pas à l’Unicode', () => {
    const nfd = 'E\u0301te\u0301.md';
    expect(normalizeRelPath(nfd)).toBe(nfd);
  });
});

describe('isTrashRelPath', () => {
  it('reconnaît .trash sous toutes ses formes', () => {
    expect(isTrashRelPath('.trash/a.md')).toBe(true);
    expect(isTrashRelPath('.trash\\a.md')).toBe(true);
    expect(isTrashRelPath('notes/.trash/a.md')).toBe(false);
    expect(isTrashRelPath('.trashy/a.md')).toBe(false);
  });
});

describe('selectRemoteRows', () => {
  const row = (raw: string, deleted = false) => ({ relPath: raw.replace(/\\/g, '/'), rawRelPath: raw, deleted });
  it('lit une ligne héritée à backslash sous son chemin POSIX', () => {
    const { rows, legacy } = selectRemoteRows([row('PROGRAMMATION\\a.md')]);
    expect(rows.map((r) => r.relPath)).toEqual(['PROGRAMMATION/a.md']);
    expect(rows[0].rawRelPath).toBe('PROGRAMMATION\\a.md');
    expect(legacy).toHaveLength(1);
  });
  it('masque la jumelle backslash quand la ligne POSIX existe (même supprimée)', () => {
    const { rows, shadowed } = selectRemoteRows([row('A/b.md', true), row('A\\b.md')]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ rawRelPath: 'A/b.md', deleted: true });
    expect(shadowed).toHaveLength(1);
  });
  it('exclut .trash/ (POSIX ou backslash)', () => {
    const { rows, trash } = selectRemoteRows([row('.trash/x.md'), row('.trash\\y.md'), row('z.md')]);
    expect(rows.map((r) => r.relPath)).toEqual(['z.md']);
    expect(trash).toBe(2);
  });
});
