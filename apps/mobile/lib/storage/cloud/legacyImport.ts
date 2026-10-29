// ✒️ 123ECRITURE — lib/storage/cloud/legacyImport.ts — lecteur SAF LECTURE SEULE pour l'import unique
// Seules des LECTURES SAF ici (readDirectoryAsync, getInfoAsync,
// readAsStringAsync). Aucune écriture, aucune suppression, aucune copie
// temporaire dans l'ancien dossier.

import * as FileSystem from 'expo-file-system/legacy';

import { createRemoteVault, isBinaryAttachmentRelPath } from '../../sync/cloud';
import { readRegistry, setVaultCloudLink, switchActiveVault } from '../nativeVaultRegistry';
import { cloudSyncHandle } from '../vaultBackend';
import { importLegacyFiles, type ImportReport, type LegacyFile, type LegacyReader } from './legacyImportCore';

const { StorageAccessFramework } = FileSystem;

function nameFromSafUri(uri: string): string {
  const decoded = decodeURIComponent(uri);
  const afterLastSlash = decoded.split('/').pop() ?? decoded;
  return afterLastSlash.split(':').pop() ?? afterLastSlash;
}

function toSafTree(path: string): string {
  if (path.startsWith('/storage/emulated/0/')) {
    return 'content://com.android.externalstorage.documents/tree/' + encodeURIComponent('primary:' + path.slice('/storage/emulated/0/'.length));
  }
  return path;
}

async function walk(dirUri: string, parent: string, out: LegacyFile[], depth: number): Promise<void> {
  if (depth > 40) return;
  const children = await StorageAccessFramework.readDirectoryAsync(dirUri);
  for (const uri of children) {
    const name = nameFromSafUri(uri);
    const relPath = parent ? `${parent}/${name}` : name;
    if (name === '.trash') continue;
    let sub: string[] | null = null;
    try {
      sub = await StorageAccessFramework.readDirectoryAsync(uri);
    } catch {
      sub = null;
    }
    if (sub) await walk(uri, relPath, out, depth + 1);
    else out.push({ relPath, uri, binary: isBinaryAttachmentRelPath(relPath) });
  }
}

export const safReadOnlyReader: LegacyReader = {
  list: async (rootUri) => {
    const out: LegacyFile[] = [];
    await walk(rootUri, '', out, 0);
    return out;
  },
  read: (f) =>
    FileSystem.readAsStringAsync(f.uri, { encoding: f.binary ? FileSystem.EncodingType.Base64 : FileSystem.EncodingType.UTF8 }),
  size: async (f) => {
    try {
      const info = await FileSystem.getInfoAsync(f.uri);
      return info.exists && 'size' in info ? Number(info.size ?? 0) : null;
    } catch {
      return null;
    }
  },
};

// Lisible tel quel ? Sinon redemande la permission (sélecteur système,
// LECTURE) — l'URI choisie ne sert qu'à lire, elle n'est pas enregistrée
// à la place de l'ancienne.
async function readableRoot(path: string): Promise<string | null> {
  const tree = toSafTree(path);
  try {
    await StorageAccessFramework.readDirectoryAsync(tree);
    return tree;
  } catch {
    const p = await StorageAccessFramework.requestDirectoryPermissionsAsync(tree);
    return p.granted ? p.directoryUri : null;
  }
}

export async function importLegacyVault(
  entryId: string,
  ownerId: string,
  onProgress?: (done: number, total: number) => void,
): Promise<ImportReport | null> {
  if (!cloudSyncHandle) throw new Error('Import réservé au mode cloud Android.');
  const entry = (await readRegistry()).vaults.find((v) => v.id === entryId);
  if (!entry) throw new Error('Coffre introuvable.');
  if (entry.remoteVaultId) throw new Error('Ce coffre est déjà dans le cloud.');
  const root = await readableRoot(entry.path);
  if (!root) return null; // sélecteur annulé
  // Le coffre distant neuf, puis l'entrée du registre bascule en cloud
  // (son ancien chemin SAF est conservé, jamais réutilisé pour écrire).
  const remote = await createRemoteVault(entry.name, ownerId);
  await setVaultCloudLink(entry.id, { linked: true, remoteVaultId: remote.id });
  await switchActiveVault(entry.id);
  cloudSyncHandle.reset();
  const handle = cloudSyncHandle;
  return importLegacyFiles(root, safReadOnlyReader, {
    importFile: (p, c, e) => handle.importFile(p, c, e),
    flush: () => handle.flush(),
  }, onProgress);
}
