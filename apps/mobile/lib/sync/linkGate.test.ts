import { describe, expect, it } from 'vitest';
import { needsMergeDialog, remotesNeedingMerge } from './linkGate';

describe('linkGate', () => {
  it('dialogue obligatoire dès qu’un coffre distant a des fichiers (ou compte inconnu)', () => {
    expect(needsMergeDialog(0)).toBe(false);
    expect(needsMergeDialog(270)).toBe(true);
    expect(needsMergeDialog(null)).toBe(true);
    expect(needsMergeDialog(undefined)).toBe(true);
  });
  it('reprise : seuls les coffres liés non vides exigent le dialogue ; liste illisible = tous', () => {
    const remotes = [{ id: 'a', fileCount: 0 }, { id: 'b', fileCount: 12 }];
    expect(remotesNeedingMerge(['a', 'b'], remotes)).toEqual(['b']);
    expect(remotesNeedingMerge(['a'], remotes)).toEqual([]);
    expect(remotesNeedingMerge(['a', 'b'], null)).toEqual(['a', 'b']);
    expect(remotesNeedingMerge(['zz'], remotes)).toEqual(['zz']);
  });
});
