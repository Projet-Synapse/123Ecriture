import { describe, expect, it } from 'vitest';
import { isHashableRelPath } from './syncRules';
import { DEFAULT_SYNC_SETTINGS, isSyncAllowed } from './syncSettings';

// Périmètre .123ecriture/ synchronisé : explicite et figé.
describe('fichiers .123ecriture synchronisés', () => {
  const ok = ['.123ecriture/tasks.json', '.123ecriture/tasklists.json', '.123ecriture/events.json', '.123ecriture/preferences.json', '.123ecriture/appearance.json'];
  const non = [
    '.123ecriture/state.json',
    '.123ecriture/sync-state.json',
    '.123ecriture/pending-review.json',
    '.123ecriture/preferences (conflit Android 2026-10-23 16h25).json',
    '.123ecriture/tasks.json.corrupt-1',
  ];
  it.each(ok)('%s : synchronisé', (p) => {
    expect(isHashableRelPath(p)).toBe(true);
    expect(isSyncAllowed(p, DEFAULT_SYNC_SETTINGS)).toBe(true);
  });
  it.each(non)('%s : local uniquement', (p) => expect(isHashableRelPath(p)).toBe(false));
});
