// ✒️ 123ECRITURE — lib/sync/deviceInventory.ts — inventaire par appareil
//////////////////////////////////////////////////////////////////////////////
//
// À chaque fin de cycle (et sur la commande « export-index »), l'appareil
// décrit ce qui est RÉELLEMENT présent sur son disque local : fichiers ET
// dossiers (chemins POSIX normalisés, .trash exclu). L'inventaire est
// écrit dans le coffre (.123ecriture/devices/<device_id>.json) et publié
// dans app_123ecriture.vault_device_inventories (upsert vault+appareil),
// pour comparer en SQL avec vault_files (vue vault_device_inventory_gaps).
// Best-effort : un échec n'est jamais une erreur de synchronisation.
//
//////////////////////////////////////////////////////////////////////////////

import { normalizeRelPath, isTrashRelPath } from './relPath';

export type InventoryFile = { path: string; size: number | null; mtime: number | null; hash: string | null };

export type DeviceInventory = {
  device_id: string;
  device_name: string;
  app_version: string | null;
  platform: string;
  generated_at: string;
  vault_id: string;
  file_count: number;
  folder_count: number;
  folders: string[];
  files: InventoryFile[];
};

export const DEVICE_INVENTORY_DIR = '.123ecriture/devices';
export const DEVICE_INVENTORY_TABLE = 'vault_device_inventories';

type HashedLike = { relPath: string; contentHash?: string; sizeBytes?: number; modifiedAt?: number };

function norm(relPath: string): string | null {
  const p = normalizeRelPath(relPath);
  if (!p || isTrashRelPath(p)) return null;
  return p;
}

function parentFolders(path: string): string[] {
  const parts = path.split('/');
  const out: string[] = [];
  for (let i = 1; i < parts.length; i += 1) out.push(parts.slice(0, i).join('/'));
  return out;
}

// Pur (testé) : fusionne l'arbre local (listTree) et les fichiers hachés.
export function buildDeviceInventory(
  meta: { deviceId: string; deviceName: string; appVersion: string | null; platform: string; vaultId: string; now?: Date },
  tree: VaultTreeNode[],
  hashed: HashedLike[],
): DeviceInventory {
  const files = new Map<string, InventoryFile>();
  const folders = new Set<string>();
  const walk = (nodes: VaultTreeNode[]) => {
    for (const node of nodes) {
      const p = norm(node.relPath);
      if (node.type === 'folder') {
        if (isTrashRelPath(node.relPath)) continue;
        if (p) folders.add(p);
        walk(node.children ?? []);
      } else if (p) {
        files.set(p, { path: p, size: null, mtime: node.modifiedAt ?? null, hash: null });
      }
    }
  };
  walk(tree);
  for (const h of hashed) {
    const p = norm(h.relPath);
    if (!p) continue;
    files.set(p, { path: p, size: h.sizeBytes ?? null, mtime: h.modifiedAt ?? files.get(p)?.mtime ?? null, hash: h.contentHash ?? null });
  }
  for (const p of files.keys()) for (const f of parentFolders(p)) folders.add(f);
  const fileList = [...files.values()].sort((a, b) => a.path.localeCompare(b.path));
  const folderList = [...folders].sort();
  return {
    device_id: meta.deviceId,
    device_name: meta.deviceName,
    app_version: meta.appVersion,
    platform: meta.platform,
    generated_at: (meta.now ?? new Date()).toISOString(),
    vault_id: meta.vaultId,
    file_count: fileList.length,
    folder_count: folderList.length,
    folders: folderList,
    files: fileList,
  };
}

export function deviceInventoryRelPath(deviceId: string): string {
  return `${DEVICE_INVENTORY_DIR}/${deviceId.replace(/[^A-Za-z0-9._-]/g, '_')}.json`;
}

// Effet : construit, écrit dans le coffre, publie côté serveur.
export async function publishDeviceInventory(remoteVaultId: string, hashed?: HashedLike[]): Promise<string> {
  // Imports dynamiques : le module pur reste testable sans react-native.
  const { requireBridges } = await import('./bridges');
  const { APP_SCHEMA } = await import('./supabaseClient');
  const { supabase, vault, sync, vaults } = requireBridges();
  const device = (await vaults.deviceInfo?.()) ?? { id: 'inconnu', name: 'appareil' };
  const { installedAppVersion } = await import('../updaterAndroid');
  const { Platform } = await import('react-native');
  const tree = await vault.listTree().catch(() => [] as VaultTreeNode[]);
  const files = hashed ?? (await sync.hashVaultTree());
  const inventory = buildDeviceInventory(
    { deviceId: device.id, deviceName: device.name ?? 'appareil', appVersion: installedAppVersion(), platform: Platform.OS, vaultId: remoteVaultId },
    tree,
    files,
  );
  const relPath = deviceInventoryRelPath(device.id);
  try {
    await vault.writeNote(relPath, JSON.stringify(inventory, null, 2));
  } catch (error) {
    console.error('[inventaire] écriture locale :', error);
  }
  const { error } = await supabase.schema(APP_SCHEMA).from(DEVICE_INVENTORY_TABLE).upsert(
    {
      vault_id: remoteVaultId,
      device_id: device.id,
      device_name: inventory.device_name,
      app_version: inventory.app_version,
      platform: inventory.platform,
      generated_at: inventory.generated_at,
      file_count: inventory.file_count,
      folder_count: inventory.folder_count,
      inventory,
    },
    { onConflict: 'vault_id,device_id' },
  );
  if (error) throw error;
  return `${relPath} (${inventory.file_count} fichiers, ${inventory.folder_count} dossiers)`;
}
