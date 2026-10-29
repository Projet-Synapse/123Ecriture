import { describe, expect, it } from 'vitest';
import { buildDeviceInventory, deviceInventoryRelPath } from './deviceInventory';

const meta = { deviceId: 'android-1', deviceName: 'A13', appVersion: '0.4.96', platform: 'android', vaultId: 'v1', now: new Date('2026-10-23T00:00:00Z') };

describe('buildDeviceInventory', () => {
  it('liste fichiers et dossiers, normalise, exclut .trash, fusionne les hash', () => {
    const tree = [
      { type: 'folder', relPath: 'A', name: 'A', children: [
        { type: 'folder', relPath: 'A/Vide', name: 'Vide', children: [] },
        { type: 'note', relPath: 'A/n.md', name: 'n.md', modifiedAt: 5, kind: 'markdown' },
      ] },
      { type: 'folder', relPath: '.trash', name: '.trash', children: [
        { type: 'note', relPath: '.trash/x.md', name: 'x.md', modifiedAt: 1, kind: 'markdown' },
      ] },
    ] as unknown as VaultTreeNode[];
    const inv = buildDeviceInventory(meta, tree, [
      { relPath: 'A\\n.md', contentHash: 'h1', sizeBytes: 3, modifiedAt: 7 },
      { relPath: 'B\\C\\img.png', contentHash: 'h2', sizeBytes: 9, modifiedAt: 8 },
      { relPath: '.trash/y.md', contentHash: 'h3', sizeBytes: 1, modifiedAt: 1 },
    ]);
    expect(inv.folders).toEqual(['A', 'A/Vide', 'B', 'B/C']);
    expect(inv.files).toEqual([
      { path: 'A/n.md', size: 3, mtime: 7, hash: 'h1' },
      { path: 'B/C/img.png', size: 9, mtime: 8, hash: 'h2' },
    ]);
    expect(inv.file_count).toBe(2);
    expect(inv.folder_count).toBe(4);
    expect(inv.generated_at).toBe('2026-10-23T00:00:00.000Z');
  });
  it('nom de fichier sûr', () => {
    expect(deviceInventoryRelPath('android-1/x')).toBe('.123ecriture/devices/android-1_x.json');
  });
});
