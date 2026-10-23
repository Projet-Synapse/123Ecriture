// ✒️ 123ECRITURE — lib/sync/cloud.ts — la gestion du cloud
//////////////////////////////////////////////////////////////////////////////
//
// TOUT ce qui parle au cloud pour les FICHIERS et les COFFRES : lire le
// catalogue (pagination), pousser, tirer, télécharger, les pièces jointes
// binaires, la création/liaison/renommage des coffres distants. Le moteur
// (syncEngine.ts) décide ; ce fichier exécute les appels réseau. Règle : un
// appel cloud ne vit JAMAIS ailleurs.
//
// Invariants du fichier :
//   • La lecture du cloud est PAGINÉE : sans pagination, le diff est
//     tranché sur une liste tronquée et repousse les fichiers en boucle
//     (jamais de convergence).
//   • Une ligne deleted=true n'est jamais réanimée ici.
//   • Les binaires (pièces jointes) ne passent JAMAIS par la lecture texte.
//
// SOMMAIRE :
//   1. La clé d'objet Storage
//   2. Le catalogue des coffres distants
//   3. La lecture du cloud et les binaires
//   4. Le push et le pull
//
//////////////////////////////////////////////////////////////////////////////

import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import {
  APP_SCHEMA,
  SUPABASE_ANON_KEY,
  SUPABASE_URL,
  supabase,
  VAULT_FILES_BUCKET,
  VAULT_FILES_TABLE,
  VAULTS_TABLE,
 VAULT_DEVICES_TABLE } from './supabaseClient';
import type { LocalHashedNote, RemoteVaultFile } from './diff';
import { vaultStorageObjectKey } from './storageKeys';
import { SYNC_ATTACHMENT_EXTENSIONS } from '../storage/nativeVaultAdapter';
import { errorMessage } from '../errorMessage';
import { installedAppVersion } from '../updaterAndroid';
import { normalizeRelPath } from './relPath';
import { loadPendingReview, savePendingReview, type PendingReview } from './pendingReview';
import { randomUUID as uuid } from '../storage/webUuid';
import { textChangeStats, textChangeDetail } from './changeStats';
import { makeJournalEntry, type SyncJournalEntry } from './journal';
import { requireBridges } from './bridges';
import { sortDevicesByLastSeen, type RemoteVaultDevice } from './devices';
import type { RemoteVaultSummary , SyncSummary } from './syncTypes';


//////// 2. La liaison et le catalogue des coffres distants ////////////////

// Clé d'objet Storage : <coffre>/<chemin encodé base64url>. L'encodage est
// OBLIGATOIRE : Supabase Storage rejette les clés contenant émojis/accents
// (« Invalid key ») — un fichier refusé au push n'est jamais récupérable
// depuis un autre appareil. Voir storageKeys.ts ; le chemin humain vit dans
// vault_files.rel_path.
function storageObjectPath(remoteVaultId: string, relPath: string): string {
  return `${remoteVaultId}/${vaultStorageObjectKey(relPath)}`;
}



// Associe le vault local ACTIF (identité stable, voir
// apps/desktop/electron/vaults.js) à une ligne `vaults` côté Supabase pour
// l'utilisateur·rice connecté·e — upsert idempotent : relier deux fois le
// même coffre renvoie la même ligne plutôt que d'en dupliquer une.
export async function linkVaultToCloud(
  localVaultId: string,
  name: string,
  ownerId: string,
): Promise<string> {
  const { supabase: client } = requireBridges();
  const { data, error } = await client
    .schema(APP_SCHEMA)
    .from(VAULTS_TABLE)
    .upsert({ owner_id: ownerId, local_vault_id: localVaultId, name }, { onConflict: 'owner_id,local_vault_id' })
    .select('id')
    .single();
  if (error) throw error;
  const remoteVaultId = (data as { id: string }).id;
  await stampCreatedByDevice(client, remoteVaultId);
  return remoteVaultId;
}

// Marque l'ORIGINE d'un coffre distant : le nom de l'appareil CRÉATEUR,
// écrit une seule fois — la condition `is null` garantit qu'un re-lien
// depuis une AUTRE machine (dossier recopié, réinstallation…) n'en change
// pas la provenance. Best-effort : un échec ne bloque jamais la liaison,
// l'origine restera simplement inconnue.
async function stampCreatedByDevice(
  client: NonNullable<typeof supabase>,
  remoteVaultId: string,
): Promise<void> {
  try {
    const info = typeof window !== 'undefined' && window.vaults ? await window.vaults.deviceInfo() : null;
    if (!info) return;
    const { error } = await client
      .schema(APP_SCHEMA)
      .from(VAULTS_TABLE)
      .update({ created_by_device: info.name })
      .eq('id', remoteVaultId)
      .is('created_by_device', null);
    if (error) throw error;
  } catch (error) {
    console.warn('[sync] origine du coffre non marquée :', errorMessage(error));
  }
}


// Crée un coffre distant DIRECTEMENT depuis le compte (modèle « le coffre
// distant est une donnée du compte », pas d'un ordinateur) :
// aucune liaison à un dossier local, l'origine est l'appareil courant et
// `local_vault_id` porte un marqueur `account:` (il ne référence AUCUN
// dossier — champ informatif, jamais utilisé pour le rattachement, qui vit
// dans le registre local de chaque machine).
export async function createRemoteVault(name: string, ownerId: string): Promise<RemoteVaultSummary> {
  const { supabase: client } = requireBridges();
  const safeName = name.trim() || 'Nouveau coffre distant';
  const { data, error } = await client
    .schema(APP_SCHEMA)
    .from(VAULTS_TABLE)
    .insert({ owner_id: ownerId, local_vault_id: `account:${uuid()}`, name: safeName })
    .select('id, name, local_vault_id, created_at, created_by_device')
    .single();
  if (error) throw error;
  const row = data as {
    id: string;
    name: string;
    local_vault_id: string | null;
    created_at: string;
    created_by_device: string | null;
  };
  await stampCreatedByDevice(client, row.id);
  const device = typeof window !== 'undefined' && window.vaults ? await window.vaults.deviceInfo().catch(() => null) : null;
  return {
    id: row.id,
    name: row.name,
    localVaultId: row.local_vault_id,
    createdAt: row.created_at,
    devices: [],
    createdByDevice: row.created_by_device ?? device?.name ?? null,
    fileCount: 0,
  };
}

// Lecture best-effort des appareils par coffre : si la table n'existe pas
// encore côté Supabase (recette SQL non rejouée après mise à jour), on rend
// une liste vide plutôt que de faire échouer toute la carte.


export async function listRemoteVaults(): Promise<RemoteVaultSummary[]> {
  if (!supabase) throw new Error('Client Supabase non configuré (variables EXPO_PUBLIC_SUPABASE_* absentes).');
  const [vaultsResult, devicesByVault, filesByVault] = await Promise.all([
    supabase
      .schema(APP_SCHEMA)
      .from(VAULTS_TABLE)
      .select('id, name, local_vault_id, created_at, created_by_device')
      .order('created_at', { ascending: true }),
    fetchDevicesByVault(),
    fetchFileCountsByVault(),
  ]);
  const { data, error } = vaultsResult;
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    localVaultId: (row.local_vault_id as string | null) ?? null,
    createdAt: row.created_at as string,
    devices: devicesByVault.get(row.id as string) ?? [],
    createdByDevice: (row.created_by_device as string | null) ?? null,
    fileCount: filesByVault.get(row.id as string) ?? 0,
  }));
}

// Renomme un vault distant — nommer les coffres distants d'après leur
// contenu réel lève les ambiguïtés. Le nom est cosmétique : l'id reste la
// clé de liaison et de Storage.
export async function renameRemoteVault(remoteVaultId: string, name: string): Promise<void> {
  if (!supabase) throw new Error('Client Supabase non configuré (variables EXPO_PUBLIC_SUPABASE_* absentes).');
  const { error } = await supabase
    .schema(APP_SCHEMA)
    .from(VAULTS_TABLE)
    .update({ name })
    .eq('id', remoteVaultId);
  if (error) throw error;
}

// Comptage par coffre (même lecture groupée côté client que les appareils —
// échec best-effort : une table absente ne casse pas la carte, compte à 0).
async function fetchFileCountsByVault(): Promise<Map<string, number>> {
  if (!supabase) return new Map();
  const { data, error } = await supabase
    .schema(APP_SCHEMA)
    .from(VAULT_FILES_TABLE)
    .select('vault_id');
  if (error) {
    console.warn('[sync] comptage des coffres distants indisponible :', error.message);
    return new Map();
  }
  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    const vaultId = row.vault_id as string;
    counts.set(vaultId, (counts.get(vaultId) ?? 0) + 1);
  }
  return counts;
}

//////// 3. Les appareils : heartbeat, verrou à distance, disjoncteur //////

// Heartbeat « appareil connecté » : upsert d'une ligne vault_devices à chaque
// synchro réussie du coffre par CET appareil (identité stable du pont —
// hostname sur desktop, « Navigateur » sur web). Best-effort assumé : un
// échec (table absente, offline) est loggé mais ne fait PAS échouer la
// synchro ni apparaître d'erreur — le suivi d'appareils ne doit jamais
// casser la synchronisation des fichiers elle-même.


function abortAfter(ms: number): AbortSignal | undefined {
  return typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(ms) : undefined;
}

const REMOTE_FILES_PAGE_SIZE = 1000;
const REMOTE_FETCH_TIMEOUT_MS = 60_000;

export async function fetchRemoteFiles(remoteVaultId: string): Promise<RemoteVaultFile[]> {
  const { supabase: client } = requireBridges();
  const rows: Record<string, unknown>[] = [];
  let from = 0;
  // Boucle bornée par sécurité (coffres XXL) : 200 pages × 1000 = 200k lignes.
  for (let page = 0; page < 200; page += 1) {
    let query = client
      .schema(APP_SCHEMA)
      .from(VAULT_FILES_TABLE)
      .select('rel_path, content_hash, size_bytes, updated_at, deleted, storage_object_path')
      .eq('vault_id', remoteVaultId)
      .order('rel_path', { ascending: true })
      .range(from, from + REMOTE_FILES_PAGE_SIZE - 1);
    // Le typage Supabase refuse `undefined` dans abortSignal : le signal n'est
    // ajouté QUE s'il existe (Hermes/Android n'a pas AbortSignal.timeout).
    const signal = abortAfter(REMOTE_FETCH_TIMEOUT_MS);
    if (signal) query = query.abortSignal(signal);
    const { data, error } = await query;
    if (error) throw error;
    const pageRows = data ?? [];
    rows.push(...pageRows);
    if (pageRows.length < REMOTE_FILES_PAGE_SIZE) break;
    from += REMOTE_FILES_PAGE_SIZE;
  }
  return rows.map((row) => ({
    // Le desktop Windows pousse des relPaths à séparateurs `\` — normalisés
    // en `/` ici, sinon le pull aplatit les sous-dossiers en fichiers à
    // racine (Android refuse les `\` dans les noms) et aucun chemin ne
    // correspond entre le hash local et les lignes distantes.
    relPath: normalizeRelPath(row.rel_path as string),
    // Forme BRUTE conservée : repérer les lignes backslashed et viser la
    // clé exacte en base, pas la normalisée.
    rawRelPath: row.rel_path as string,
    contentHash: row.content_hash as string,
    sizeBytes: row.size_bytes as number,
    updatedAt: row.updated_at as string,
    deleted: row.deleted as boolean,
    // Ligne héritée à backslash sans clé enregistrée : l'objet a été
    // téléversé sous la clé de son chemin BRUT — jamais sous le normalisé.
    storageObjectPath:
      (row.storage_object_path as string | null) ??
      ((row.rel_path as string).includes('\\') ? storageObjectPath(remoteVaultId, row.rel_path as string) : undefined),
  }));
}

// Télécharge le contenu d'une note. Priorité à la clé ENREGISTRÉE dans
// vault_files (storage_object_path) : les fichiers poussés sous leur nom
// brut restent ainsi téléchargeables ; la clé recalculée ne sert qu'aux
// lignes qui n'en auraient pas.
// ⚠️ `Blob.text()` n'existe pas sur le Blob polyfillé de React Native :
// chaque pull lèverait « undefined is not a function » sur TOUT fichier
// tiré du cloud. FileReader lit le blob en texte UTF-8 sur toutes les
// plateformes (navigateur, Electron, Hermes).
async function blobToText(data: Blob): Promise<string> {
  if (typeof data.text === 'function') return data.text();
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('Lecture du fichier téléchargé impossible.'));
    reader.readAsText(data);
  });
}

//////// 5. Les pièces jointes binaires : MIME et base64 ///////////////////

// Images/PDF/audio : transport en base64 via les ponts binaires ; la liste
// des extensions est SYNC_ATTACHMENT_EXTENSIONS (nativeVaultAdapter).
const MAX_ATTACHMENT_ALERT_BYTES = 25 * 1024 * 1024;

// Aucune confirmation de suppression massive par un simple second cycle :
// toute liste suspecte part en REVUE MANUELLE (pendingReview.ts) et n'est
// appliquée que par une action humaine explicite — jamais de façon
// silencieuse.

// Mémoire du dernier signalement backslash (un seul journal par valeur).

export function isBinaryAttachmentRelPath(relPath: string): boolean {
  const lower = relPath.toLowerCase();
  return SYNC_ATTACHMENT_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function mimeForAttachment(relPath: string): string {
  const ext = relPath.toLowerCase().slice(relPath.lastIndexOf('.'));
  const table: Record<string, string> = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
    '.heic': 'image/heic', '.pdf': 'application/pdf', '.txt': 'text/plain',
    '.csv': 'text/csv', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
    '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.mp4': 'video/mp4',
    '.webm': 'video/webm',
  };
  return table[ext] ?? 'application/octet-stream';
}

function base64ToUint8Array(base64: string): Uint8Array {
  if (typeof atob === 'function') {
    const binary = atob(base64);
    return Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
  }
  // Hermes sans atob : décodeur manuel
  const table = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean = base64.replace(/[^A-Za-z0-9+/=]/g, '');
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  const bytes = new Uint8Array(Math.floor(clean.length / 4) * 3);
  let out = 0;
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < clean.length; i += 1) {
    const value = table.indexOf(clean[i]);
    if (value === -1) continue;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      if (out < bytes.length) bytes[out] = (buffer >> bits) & 0xff;
      out += 1;
    }
  }
  return bytes.subarray(0, Math.floor(clean.length / 4) * 3 - padding);
}

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      resolve(dataUrl.slice(dataUrl.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// Téléchargement BINAIRE : comme downloadRemoteText, le natif passe par un
// fichier de cache (zéro tampon Java) et lit en base64 ; le web télécharge
// le blob et le convertit.
export async function downloadRemoteBinary(
  remoteVaultId: string,
  relPath: string,
  objectPath?: string,
): Promise<string> {
  const { supabase: client } = requireBridges();
  const key = objectPath ?? storageObjectPath(remoteVaultId, relPath);
  if (Platform.OS !== 'web') {
    const { data: sessionData } = await client.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) throw new Error('Session absente — reconnecte-toi pour télécharger les fichiers.');
    const tmpPath = `${FileSystem.cacheDirectory}sync-dl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      const result = await FileSystem.downloadAsync(
        `${SUPABASE_URL}/storage/v1/object/${VAULT_FILES_BUCKET}/${key}`,
        tmpPath,
        { headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY } },
      );
      if (result.status >= 400) {
        throw new Error(`Téléchargement de la pièce jointe impossible (HTTP ${result.status}).`);
      }
      return await FileSystem.readAsStringAsync(tmpPath, {
        encoding: FileSystem.EncodingType.Base64,
      });
    } finally {
      await FileSystem.deleteAsync(tmpPath, { idempotent: true }).catch(() => undefined);
    }
  }
  const { data, error } = await client.storage.from(VAULT_FILES_BUCKET).download(key);
  if (error) throw error;
  return blobToBase64(data);
}

export async function downloadRemoteText(remoteVaultId: string, relPath: string, objectPath?: string): Promise<string> {
  const { supabase: client } = requireBridges();
  const key = objectPath ?? storageObjectPath(remoteVaultId, relPath);
  // ⚠️ Sur NATIF, ne PAS passer par storage.download() : supabase-js le
  // fait transiter par expo/fetch, qui tamponne TOUTE la réponse en
  // mémoire Java (DirectByteBuffer) — OutOfMemoryError natif au bout de
  // quelques fichiers, mort du processus. Téléchargement DIRECT vers un
  // fichier de cache (okhttp → disque, zéro tampon JS/Java), lecture,
  // nettoyage.
  if (Platform.OS !== 'web') {
    const { data: sessionData } = await client.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) throw new Error('Session absente — reconnecte-toi pour télécharger les fichiers.');
    const tmpPath = `${FileSystem.cacheDirectory}sync-dl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      const result = await FileSystem.downloadAsync(
        `${SUPABASE_URL}/storage/v1/object/${VAULT_FILES_BUCKET}/${key}`,
        tmpPath,
        { headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY } },
      );
      if (result.status >= 400) {
        throw new Error(`Téléchargement du fichier impossible (HTTP ${result.status}).`);
      }
      return await FileSystem.readAsStringAsync(tmpPath);
    } finally {
      await FileSystem.deleteAsync(tmpPath, { idempotent: true }).catch(() => undefined);
    }
  }
  const { data, error } = await client.storage.from(VAULT_FILES_BUCKET).download(key);
  if (error) throw error;
  return blobToText(data);
}

//////// 6. Le push, le pull et les bases de fusion ////////////////////////


function syncBaseRelPath(relPath: string): string {
  return `${SYNC_BASES_DIR}/${vaultStorageObjectKey(relPath)}`;
}

export async function saveSyncBase(relPath: string, content: string): Promise<void> {
  try {
    const { vault } = requireBridges();
    await vault.writeNote(syncBaseRelPath(relPath), content);
  } catch {
    // Best-effort total : jamais faire échouer un push/pull pour ça.
  }
}

export async function loadSyncBase(relPath: string): Promise<string | null> {
  try {
    const { vault } = requireBridges();
    return await vault.readNote(syncBaseRelPath(relPath));
  } catch {
    return null;
  }
}

export async function pushFile(
  remoteVaultId: string,
  ownerId: string,
  note: LocalHashedNote,
  journal: SyncJournalEntry[] = [],
  // Version distante précédente (texte) : permet de journaliser le
  // CHANGEMENT (+ajoutés / −supprimés / total) au lieu d'un « envoyé »
  // aveugle. null/undefined = fichier nouveau ou statistique indisponible.
  previousRemoteContent?: string | null,
): Promise<void> {
  const { supabase: client, vault } = requireBridges();
  // Défense en profondeur — quel que soit le pont, le chemin poussé au
  // cloud est TOUJOURS en slashes POSIX (un backslashed crée un doublon
  // cloud jamais matché, cassant tombestones et pulls).
  const relPath = normalizeRelPath(note.relPath);
  let uploadBody: string | Uint8Array;
  let uploadContentType: string;
  if (isBinaryAttachmentRelPath(relPath)) {
    if (!vault.readNoteBinary) {
      throw new Error('Les pièces jointes ne sont pas prises en charge par cet appareil.');
    }
    const base64 = await vault.readNoteBinary(relPath);
    uploadBody = base64ToUint8Array(base64);
    uploadContentType = mimeForAttachment(relPath);
  } else {
    uploadBody = await vault.readNote(relPath);
    uploadContentType = 'text/plain;charset=UTF-8';
  }
  const { error: uploadError } = await client.storage
    .from(VAULT_FILES_BUCKET)
    .upload(storageObjectPath(remoteVaultId, relPath), uploadBody, {
      upsert: true,
      contentType: uploadContentType,
    });
  if (uploadError) throw uploadError;

  const { error: upsertError } = await client
    .schema(APP_SCHEMA)
    .from(VAULT_FILES_TABLE)
    .upsert(
      {
        vault_id: remoteVaultId,
        owner_id: ownerId,
        rel_path: relPath,
        content_hash: note.contentHash,
        size_bytes: note.sizeBytes,
        storage_object_path: storageObjectPath(remoteVaultId, relPath),
        updated_at: new Date(note.modifiedAt).toISOString(),
        deleted: false,
      },
      { onConflict: 'vault_id,rel_path' },
    );
  if (upsertError) throw upsertError;

  // JOURNAL « MODIFICATION » : le journal raconte le changement, pas un
  // « envoyé » aveugle. Best-effort : un échec de statistique n'est JAMAIS
  // un échec de push. Les binaires gardent l'entrée « push » simple (pas de
  // comparaison de texte).
  // Un push dont le chemin vit sous `.trash/` est le CONTINU d'un
  // déplacement en corbeille (la corbeille est synchronisée) : il se
  // raconte « Corbeille : … » — jamais « Modifié : … », sinon le même geste
  // se lit « supprimé PUIS modifié » sur le même fichier.
  if (isBinaryAttachmentRelPath(relPath)) {
    journal.push(
      makeJournalEntry(relPath.startsWith('.trash/') ? 'corbeille' : 'push', { path: relPath }),
    );
  } else {
    try {
      const stats = textChangeStats(previousRemoteContent ?? null, String(uploadBody));
      journal.push(
        relPath.startsWith('.trash/')
          ? makeJournalEntry('corbeille', {
              path: relPath,
              detail: `déplacement synchronisé (${textChangeDetail(stats)})`,
            })
          : makeJournalEntry('modification', { path: relPath, detail: textChangeDetail(stats) }),
      );
    } catch {
      journal.push(makeJournalEntry('push', { path: relPath }));
    }
  }

  // Alerte VOLUMINEUX : pièces jointes sans limite de taille, mais
  // signalées au-delà de 25 Mo dans le journal de synchro.
  if (isBinaryAttachmentRelPath(relPath) && note.sizeBytes > MAX_ATTACHMENT_ALERT_BYTES) {
    journal.push(
      makeJournalEntry('push', {
        path: relPath,
        detail: `⚠️ fichier volumineux synchronisé : ${(note.sizeBytes / (1024 * 1024)).toFixed(1)} Mo`,
      }),
    );
  }

  // Base de fusion : la version qui vient d'être acceptée des deux côtés
  // servira de référentiel au prochain conflit (fusion à trois voix
  // diff-match-patch). Best-effort : une base manquante fait retomber le
  // conflit sur le comportement gagnant/perdant archivé.
  if (typeof uploadBody === 'string') {
    await saveSyncBase(relPath, uploadBody);
  }
}

export async function pullFile(remoteVaultId: string, relPath: string, objectPath?: string): Promise<void> {
  const { vault } = requireBridges();
  // Pièces jointes BINAIRES : transport base64 via les ponts
  // readNoteBinary/writeNoteBinary ; pas de base de fusion (jamais de
  // fusion binaire — les conflits retombent sur gagnant/perdant).
  if (isBinaryAttachmentRelPath(relPath)) {
    if (!vault.writeNoteBinary) {
      throw new Error('Les pièces jointes ne sont pas prises en charge par cet appareil.');
    }
    const base64 = await downloadRemoteBinary(remoteVaultId, relPath, objectPath);
    await vault.writeNoteBinary(relPath, base64);
    return;
  }
  const content = await downloadRemoteText(remoteVaultId, relPath, objectPath);
  await vault.writeNote(relPath, content);
  await saveSyncBase(relPath, content);
}

// Bases de fusion : dernière version SYNCHRONISÉE de chaque
// fichier, stockée hors arbre synchronisé (`.123ecriture/bases/<clé>` —
// même encodage base64url que les clés Storage, un fichier par note).
// C'est le « base » de la fusion à trois voix : sans elle, impossible de
// distinguer ce que chaque côté a modifié.
const SYNC_BASES_DIR = '.123ecriture/bases';


//////// 6. Les appareils : heartbeat, verrous et lecture //////////////////


// Lecture best-effort des appareils par coffre : si la table n'existe pas
// encore côté Supabase (recette SQL non rejouée après mise à jour), on rend
// une liste vide plutôt que de faire échouer toute la carte.
export async function fetchDevicesByVault(): Promise<Map<string, RemoteVaultDevice[]>> {
  if (!supabase) return new Map();
  // select('*') plutôt qu'une liste nominative : les colonnes
  // d'observabilité peuvent être absentes de la base tant que la migration
  // n'est pas appliquée — une liste nominative échouerait.
  const { data, error } = await supabase
    .schema(APP_SCHEMA)
    .from(VAULT_DEVICES_TABLE)
    .select('*');
  if (error) {
    console.warn('[sync] appareils connectés indisponibles :', error.message);
    return new Map();
  }
  const byVault = new Map<string, RemoteVaultDevice[]>();
  for (const row of data ?? []) {
    const vaultId = row.vault_id as string;
    const device: RemoteVaultDevice = {
      deviceId: row.device_id as string,
      name: row.device_name as string,
      lastSeenAt: row.last_seen_at as string,
      appVersion: (row.app_version as string | null) ?? null,
      lastCycleAt: (row.last_cycle_at as string | null) ?? null,
      lastCyclePushed: (row.last_cycle_pushed as number | null) ?? null,
      lastCyclePulled: (row.last_cycle_pulled as number | null) ?? null,
      lastCycleDeleted: (row.last_cycle_deleted as number | null) ?? null,
      lastCycleConflicts: (row.last_cycle_conflicts as number | null) ?? null,
      lastCycleErrors: (row.last_cycle_errors as number | null) ?? null,
      locked: (row.locked as boolean | null) ?? null,
      lockReason: (row.lock_reason as string | null) ?? null,
    };
    const list = byVault.get(vaultId) ?? [];
    list.push(device);
    byVault.set(vaultId, list);
  }
  for (const list of byVault.values()) sortDevicesByLastSeen(list);
  return byVault;
}





//////// 3. Les appareils : heartbeat, verrou à distance, disjoncteur //////

// Heartbeat « appareil connecté » : upsert d'une ligne vault_devices à chaque
// synchro réussie du coffre par CET appareil (identité stable du pont —
// hostname sur desktop, « Navigateur » sur web). Best-effort assumé : un
// échec (table absente, offline) est loggé mais ne fait PAS échouer la
// synchro ni apparaître d'erreur — le suivi d'appareils ne doit jamais
// casser la synchronisation des fichiers elle-même.
// Colonnes d'observabilité ABSENTES tant que la migration
// supabase/migrations/20261017120000_vault_devices_observability.sql n'a pas
// été appliquée : une seule tentative enrichie par session, puis repli
// définitif sur l'upsert historique (jamais de bruit à chaque cycle).
let colonnesObservabiliteAbsentes = false;

// Version de l'app SUR CET appareil (heartbeat observabilité) :
// versionName natif (Platform.constants) ou version Electron (bridge
// `updater` du preload desktop) ; null si indisponible — jamais bloquant.
async function currentAppVersion(): Promise<string | null> {
  const native = installedAppVersion();
  if (native) return native;
  try {
    if (typeof window === 'undefined') return null;
    const updater = (window as unknown as { updater?: { getVersion?: () => Promise<string> } }).updater;
    const version = await updater?.getVersion?.();
    return typeof version === 'string' && version ? version : null;
  } catch {
    return null;
  }
}

export async function heartbeatDevice(remoteVaultId: string, ownerId: string, summary?: SyncSummary): Promise<void> {
  try {
    if (!supabase) return;
    const info = typeof window !== 'undefined' && window.vaults ? await window.vaults.deviceInfo() : null;
    if (!info) return;
    const base = {
      vault_id: remoteVaultId,
      owner_id: ownerId,
      device_id: info.id,
      device_name: info.name,
      last_seen_at: new Date().toISOString(),
    };
    // OBSERVABILITÉ : version de l'app + résumé du dernier cycle, visibles
    // par TOUS les appareils sur la carte « Appareils connectés ».
    if (summary && !colonnesObservabiliteAbsentes) {
      const { error } = await supabase
        .schema(APP_SCHEMA)
        .from(VAULT_DEVICES_TABLE)
        .upsert(
          {
            ...base,
            app_version: await currentAppVersion(),
            last_cycle_at: base.last_seen_at,
            last_cycle_pushed: summary.pushed,
            last_cycle_pulled: summary.pulled,
            last_cycle_deleted: summary.deleted,
            last_cycle_conflicts: summary.conflicts,
            last_cycle_errors: summary.errors.length,
          },
          { onConflict: 'vault_id,device_id' },
        );
      if (!error) return;
      if (!/column|PGRST204/i.test(error.message ?? '')) throw error;
      colonnesObservabiliteAbsentes = true;
    }
    const { error } = await supabase
      .schema(APP_SCHEMA)
      .from(VAULT_DEVICES_TABLE)
      .upsert(base, { onConflict: 'vault_id,device_id' });
    if (error) throw error;
  } catch (error) {
    console.warn('[sync] heartbeat appareil ignoré :', errorMessage(error));
  }
}

// VERROU À DISTANCE : les colonnes locked/lock_reason/locked_at de
// vault_devices (migration 20261017200000) permettent de STOPPER un appareil
// devenu dangereux (état périmé, boucle, coffre mal reconnecté) depuis
// n'importe quel autre appareil du coffre — ou directement en SQL/API par
// un opérateur. Un appareil verrouillé n'exécute PLUS AUCUN cycle cloud ;
// son coffre local continue hors ligne, zéro perte de données.
let colonnesVerrouAbsentes = false;

export async function fetchMyDeviceLock(remoteVaultId: string): Promise<{ locked: boolean; reason: string | null }> {
  try {
    if (!supabase || colonnesVerrouAbsentes) return { locked: false, reason: null };
    if (typeof window === 'undefined' || !window.vaults) return { locked: false, reason: null };
    const info = await window.vaults.deviceInfo();
    const { data, error } = await supabase
      .schema(APP_SCHEMA)
      .from(VAULT_DEVICES_TABLE)
      .select('locked, lock_reason')
      .eq('vault_id', remoteVaultId)
      .eq('device_id', info.id)
      .maybeSingle();
    if (error) {
      // Migration non appliquée : colonnes absentes — pas de verrou possible,
      // on cesse d'interroger pour ne pas bruiter chaque cycle.
      if (/column|PGRST204/i.test(error.message ?? '')) colonnesVerrouAbsentes = true;
      return { locked: false, reason: null };
    }
    return { locked: Boolean(data?.locked), reason: (data?.lock_reason as string | null) ?? null };
  } catch {
    return { locked: false, reason: null };
  }
}

// Pose/lève le verrou d'urgence d'un appareil — appelé par la carte
// « Appareils connectés » ; utilisable aussi par un opérateur via l'API
// REST (UPDATE vault_devices SET locked=true). Erreur retournée à
// l'appelant (l'UI l'affiche).
export async function setDeviceRemoteLock(
  remoteVaultId: string,
  deviceId: string,
  locked: boolean,
  reason?: string,
): Promise<void> {
  if (!supabase) throw new Error("Non connecté au cloud — verrou impossible pour l'instant.");
  const { error } = await supabase
    .schema(APP_SCHEMA)
    .from(VAULT_DEVICES_TABLE)
    .update({
      locked,
      lock_reason: locked ? (reason ?? 'Verrouillé depuis un autre appareil') : null,
      locked_at: new Date().toISOString(),
    })
    .eq('vault_id', remoteVaultId)
    .eq('device_id', deviceId);
  if (error) throw error;
}

// Lève le disjoncteur (après revue humaine) — appelé par l'écran de revue
// (Paramètres → Journal de synchronisation).
export async function clearSyncBlock(): Promise<void> {
  const { vault } = requireBridges();
  const review = await loadPendingReview(vault).catch(() => ({}) as PendingReview);
  if (!review.syncBlocked) return;
  delete review.syncBlocked;
  await savePendingReview(vault, review);
}

