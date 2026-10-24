import { describe, expect, it, vi } from 'vitest';
import { writeNoteIfChanged } from './writeIfChanged';

describe('writeNoteIfChanged', () => {
  it('contenu identique : aucune écriture (mtime intact)', async () => {
    const write = vi.fn(async () => {});
    expect(await writeNoteIfChanged(async () => '{"a":1}', write, 'p', '{"a":1}')).toBe(false);
    expect(write).not.toHaveBeenCalled();
  });
  it('contenu différent ou fichier absent : écriture', async () => {
    const write = vi.fn(async () => {});
    expect(await writeNoteIfChanged(async () => '{}', write, 'p', '{"a":1}')).toBe(true);
    expect(await writeNoteIfChanged(async () => { throw new Error('absent'); }, write, 'p', 'x')).toBe(true);
    expect(write).toHaveBeenCalledTimes(2);
  });
});
