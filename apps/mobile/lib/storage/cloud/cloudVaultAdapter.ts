// ✒️ 123ECRITURE — lib/storage/cloud/cloudVaultAdapter.ts — câblage réel du coffre cloud Android
//////////////////////////////////////////////////////////////////////////////
//
// Branche cloudVaultCore.ts sur Supabase (RPC push_file / tombstone_file /
// restore_file, Storage 123ecriture-vaults) et sur le stockage PRIVÉ de
// l'app (expo-file-system documentDirectory/cloud-vaults/, aucune
// permission). Aucun accès SAF ni content:// ici.
//
//////////////////////////////////////////////////////////////////////////////

import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';

import { parseFrontmatter } from '../../properties/frontmatter';
import {
  base64ToUint8Array,
  downloadRemoteBinary,
  downloadRemoteText,
  isBinaryAttachmentRelPath,
  mimeForAttachment,
} from '../../sync/cloud';
import { sha256Hex, utf8Bytes } from '../../sync/nativeSha256';
import { APP_SCHEMA, supabase, VAULT_FILES_BUCKET, VAULT_FILES_TABLE } from '../../sync/supabaseClient';
import {
  baseNameOf,
  buildTreeFromIndex,
  defaultContentForKind,
  EXTENSION_FOR_KIND,
  extensionKind,
  findAvailableName,
  KNOWN_CONTENT_EXTS,
  TAG_PATTERN,
} from '../nativeVaultAdapter';
import { alertConfirm } from '../nativeVaultFsAdapter';
import { getActiveVaultEntry } from '../nativeVaultRegistry';
import {
  createCloudVault,
  type CacheStore,
  type CloudApi,
  type Encoding,
  type LockResult,
  type RemoteRow,
} from './cloudVaultCore';

export const CLOUD_CACHE_ROOT = `${FileSystem.documentDirectory}cloud-vaults/`;

function client() {
  if (!supabase) throw new Error('Client Supabase non configuré.');
  return supabase;
}

function toLock(data: unknown): LockResult {
  const d = (data ?? {}) as Record<string, unknown>;
  return {
    ok: Boolean(d.ok),
    conflict: Boolean(d.conflict),
    currentVersion: typeof d.current_version === 'number' ? d.current_version : d.current_version !== null && d.current_version !== undefined ? Number(d.current_version) : null,
    currentHash: (d.current_hash as string | null) ?? null,
    deleted: Boolean(d.deleted),
  };
}

export const supabaseCloudApi: CloudApi = {
  async listFiles(vaultId) {
    const rows: RemoteRow[] = [];
    for (let page = 0, from = 0; page < 200; page += 1, from += 1000) {
      const { data, error } = await client()
        .schema(APP_SCHEMA)
        .from(VAULT_FILES_TABLE)
        .select('rel_path, version, content_hash, size_bytes, updated_at, deleted, storage_object_path')
        .eq('vault_id', vaultId)
        .order('rel_path', { ascending: true })
        .range(from, from + 999);
      if (error) throw error;
      for (const r of data ?? []) {
        rows.push({
          relPath: r.rel_path as string,
          version: Number(r.version ?? 1),
          contentHash: r.content_hash as string,
          sizeBytes: Number(r.size_bytes ?? 0),
          updatedAt: r.updated_at as string,
          deleted: Boolean(r.deleted),
          storagePath: (r.storage_object_path as string | null) ?? null,
        });
      }
      if ((data ?? []).length < 1000) break;
    }
    return rows;
  },
  async download(vaultId, row, encoding) {
    return encoding === 'base64'
      ? downloadRemoteBinary(vaultId, row.relPath, row.storagePath ?? undefined)
      : downloadRemoteText(vaultId, row.relPath, row.storagePath ?? undefined);
  },
  async upload(vaultId, hash, content, encoding, relPath) {
    // Clé ADRESSÉE PAR CONTENU : <coffre>/c/<sha256>. Un put refusé par le
    // verrou optimiste n'a donc jamais écrasé l'objet d'une autre version.
    const key = `${vaultId}/c/${hash}`;
    const body = encoding === 'base64' ? base64ToUint8Array(content) : content;
    const { error } = await client()
      .storage.from(VAULT_FILES_BUCKET)
      .upload(key, body, {
        upsert: true,
        contentType: encoding === 'base64' ? mimeForAttachment(relPath) : 'text/plain;charset=UTF-8',
      });
    if (error) throw error;
    return key;
  },
  async pushFile(vaultId, relPath, expectedVersion, hash, size, storagePath) {
    const { data, error } = await client().schema(APP_SCHEMA).rpc('push_file', {
      p_vault_id: vaultId,
      p_rel_path: relPath,
      p_expected_version: expectedVersion,
      p_content_hash: hash,
      p_size_bytes: size,
      p_storage_path: storagePath,
    });
    if (error) throw error;
    return toLock(data);
  },
  async tombstone(vaultId, relPath, expectedVersion, devId) {
    const { data, error } = await client().schema(APP_SCHEMA).rpc('tombstone_file', {
      p_vault_id: vaultId,
      p_rel_path: relPath,
      p_expected_version: expectedVersion,
      p_device_id: devId,
    });
    if (error) throw error;
    return toLock(data);
  },
  async restore(vaultId, relPath) {
    const { data, error } = await client().schema(APP_SCHEMA).rpc('restore_file', {
      p_vault_id: vaultId,
      p_rel_path: relPath,
    });
    if (error) throw error;
    return toLock(data);
  },
};

async function ensureDir(dir: string): Promise<void> {
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
}

export const privateCacheStore: CacheStore = {
  async read(key, encoding) {
    const path = CLOUD_CACHE_ROOT + key;
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists) return null;
    return FileSystem.readAsStringAsync(path, {
      encoding: encoding === 'base64' ? FileSystem.EncodingType.Base64 : FileSystem.EncodingType.UTF8,
    });
  },
  async write(key, content, encoding) {
    const path = CLOUD_CACHE_ROOT + key;
    await ensureDir(path.slice(0, path.lastIndexOf('/') + 1));
    // Écriture atomique : fichier temporaire puis renommage.
    const tmp = `${path}.tmp-${Date.now()}`;
    await FileSystem.writeAsStringAsync(tmp, content, {
      encoding: encoding === 'base64' ? FileSystem.EncodingType.Base64 : FileSystem.EncodingType.UTF8,
    });
    await FileSystem.moveAsync({ from: tmp, to: path });
  },
  async size() {
    const info = await FileSystem.getInfoAsync(CLOUD_CACHE_ROOT, { size: true } as never);
    return info.exists && 'size' in info ? Number(info.size ?? 0) : 0;
  },
};

function hashContent(content: string, encoding: Encoding) {
  const bytes = encoding === 'base64' ? base64ToUint8Array(content) : utf8Bytes(content);
  return { hash: sha256Hex(bytes), size: bytes.length };
}

let deviceIdCache: string | null = null;
async function deviceId(): Promise<string> {
  if (deviceIdCache) return deviceIdCache;
  const info = await window.vaults?.deviceInfo();
  deviceIdCache = info?.id ?? 'android';
  return deviceIdCache;
}

export function createDefaultCloudVault() {
  return createCloudVault({
    api: supabaseCloudApi,
    cache: privateCacheStore,
    hash: hashContent,
    getActive: async () => {
      const entry = await getActiveVaultEntry();
      if (!entry || !entry.remoteVaultId) return null;
      return { localId: entry.id, remoteVaultId: entry.remoteVaultId, name: entry.name };
    },
    deviceId,
    deviceName: async () => 'Android',
    confirm: alertConfirm,
    helpers: {
      buildTree: (index) => buildTreeFromIndex(index),
      findAvailableName,
      defaultContentForKind,
      extensionForKind: EXTENSION_FOR_KIND,
      knownContentExts: KNOWN_CONTENT_EXTS,
      extensionKind,
      baseNameOf,
      isBinary: isBinaryAttachmentRelPath,
      listTags: (notes) => {
        const byTag = new Map<string, { relPath: string; name: string }[]>();
        for (const n of notes) {
          const { body } = parseFrontmatter(n.content);
          for (const m of body.matchAll(TAG_PATTERN)) {
            const tag = m[2].toLowerCase();
            const list = byTag.get(tag) ?? [];
            list.push({ relPath: n.relPath, name: baseNameOf(n.relPath.slice(n.relPath.lastIndexOf('/') + 1)) });
            byTag.set(tag, list);
          }
        }
        return [...byTag.entries()].map(([tag, list]) => ({ tag, notes: list })).sort((a, b) => a.tag.localeCompare(b.tag, 'fr'));
      },
      pickAttachment: async () => {
        const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
        if (result.canceled || !result.assets?.[0]) return null;
        const asset = result.assets[0];
        // asset.uri = copie dans le cache PRIVÉ de l'app (aucune permission de stockage).
        const base64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
        return { name: asset.name, base64 };
      },
    },
  });
}
