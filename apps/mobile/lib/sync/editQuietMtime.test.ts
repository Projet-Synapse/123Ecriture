import { describe, expect, it } from 'vitest';
import { indexedModifiedAt, splitEditHot } from './editQuiet';

describe('mtime Android et période de silence', () => {
  it('fichiers à mtime réel ancien ou inconnu (0) : jamais « en cours d’édition »', () => {
    const now = 1_800_000_000_000;
    const files = [
      { relPath: 'a.md', modifiedAt: indexedModifiedAt({ mtime: now - 3_600_000 }) },
      { relPath: 'b.md', modifiedAt: indexedModifiedAt({}) },
      { relPath: 'c.md', modifiedAt: indexedModifiedAt(undefined) },
      { relPath: 'd.md', modifiedAt: indexedModifiedAt({ mtime: now - 5_000 }) },
    ];
    const { cold, hotPaths } = splitEditHot(files, now);
    expect(cold.map((f) => f.relPath)).toEqual(['a.md', 'b.md', 'c.md']);
    expect([...hotPaths]).toEqual(['d.md']);
  });
});
