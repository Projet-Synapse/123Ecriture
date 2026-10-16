import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';

import {
  APP_SCHEMA,
  SUPABASE_ANON_KEY,
  SUPABASE_URL,
  supabase,
  VAULT_DEVICES_TABLE,
  VAULT_FILES_BUCKET,
  VAULT_FILES_TABLE,
  VAULTS_TABLE,
} from './supabaseClient';
import { diffVault, type LocalHashedNote, type RemoteVaultFile } from './diff';
import { errorMessage } from '../errorMessage';
import { sortDevicesByLastSeen, type RemoteVaultDevice } from './devices';
import { computeLocalDeletions, remoteDeletionAction } from './deletions';
import { pickActiveRemoteVault } from './activeVault';
import {
  capJournalEntries,
  makeJournalEntry,
  type SyncJournal,
  type SyncJournalEntry,
} from './journal';
import { tryThreeWayMerge } from './merge';
import { vaultStorageObjectKey } from './storageKeys';
// Liste des pièces jointes synchronisées (source unique : nativeVaultAdapter).
import { SYNC_ATTACHMENT_EXTENSIONS } from '../storage/nativeVaultAdapter';
// randomUUID portable — crypto.randomUUID n'existe pas sous Hermes natif
// (le helper web tombe sur Math.random), voir lib/storage/webUuid.ts.
import { randomUUID as uuid } from '../storage/webUuid';

// Orchestrateur de synchro (v0, manuel, sans timer — voir
// docs/ARCHITECTURE.md §6) : appelle le pont Electron (hash local, lecture/
// écriture de notes) et le client Supabase (Storage + table de métadonnées),
// applique les décisions de diff.ts. Volontairement fin et non testable
// unitairement (trop d'effets de bord réels) — toute la logique de décision
// qui mérite des tests vit dans diff.ts.

export type SyncSummary = {
  pushed: number;
  pulled: number;
  // Fichiers supprimés comptés ce cycle : suppressions LOCALES propagées au
  // cloud (pierres tombales) + suppressions DISTantes appliquées ici
  // (v0.4.17).
  deleted: number;
  conflicts: number;
  errors: string[];
};

// État de synchro par coffre (v0.4.17) : ensemble des fichiers présents à
// la fin du dernier cycle réussi (rel_path -> hash de contenu), persisté
// DANS le dossier du coffre — il suit les déplacements. C'est la référence
// qui distingue « jamais existé ici » (pull autorisé) de « existait et a
// été supprimé ici » (tombestone, jamais de résurrection).
const SYNC_STATE_REL_PATH = '.123ecriture/sync-state.json';

type SyncState = { files: Record<string, string> };

// v0.4.58 — Hermes (Android) n'expose PAS `AbortSignal.timeout` (méthode
// statique du DOM) : l'appeler levait « undefined is not a function » et
// faisait échouer CHAQUE cycle de synchro sur Android. Helper qui renvoie
// le signal quand il existe, sinon undefined (pas d'abandon — le délai
// d'attente strict reste un chantier pour une polyfill dédiée).
function abortAfter(ms: number): AbortSignal | undefined {
  const ctor = globalThis.AbortSignal as { timeout?: (ms: number) => AbortSignal } | undefined;
  return typeof ctor?.timeout === 'function' ? ctor.timeout(ms) : undefined;
}

async function loadSyncState(): Promise<SyncState> {
  const { vault } = requireBridges();
  try {
    const raw = await vault.readNote(SYNC_STATE_REL_PATH);
    const parsed = JSON.parse(raw) as Partial<SyncState>;
    // v0.4.54 : jette les clés backslashed (résidus du bug de séparateurs
    // desktop — elles ne matcheront plus jamais les chemins normalisés et
    // ne doivent plus générer de tombestones fantômes).
    const files: Record<string, string> = {};
    for (const [relPath, hash] of Object.entries(parsed.files ?? {})) {
      if (relPath.includes('\\')) continue;
      files[relPath] = hash;
    }
    return { files };
  } catch {
    // Absent à la première synchro du coffre — repart à vide.
    return { files: {} };
  }
}

async function saveSyncState(state: SyncState): Promise<void> {
  const { vault } = requireBridges();
  await vault.writeNote(SYNC_STATE_REL_PATH, JSON.stringify(state));
}

// Journal de synchronisation (v0.4.27) — voir journal.ts. Même pattern
// read-modify-write que l'état de synchro ; best-effort (une écriture
// ratée ne doit jamais faire échouer un cycle) ; borné par capJournalEntries.
const SYNC_JOURNAL_REL_PATH = '.123ecriture/sync-journal.json';

export async function appendJournalEntries(entries: SyncJournalEntry[]): Promise<void> {
  if (!entries.length) return;
  try {
    const { vault } = requireBridges();
    let existing: SyncJournalEntry[] = [];
    try {
      const raw = await vault.readNote(SYNC_JOURNAL_REL_PATH);
      const parsed = JSON.parse(raw) as Partial<SyncJournal>;
      existing = Array.isArray(parsed.entries) ? parsed.entries : [];
    } catch {
      // Journal absent au tout premier cycle.
    }
    const next = capJournalEntries([...existing, ...entries]);
    await vault.writeNote(SYNC_JOURNAL_REL_PATH, JSON.stringify({ entries: next }));
  } catch (error) {
    // Best-effort TOTAL : un journal en échec ne doit jamais faire échouer
    // un cycle de synchro (plateforme sans pont, disque saturé…).
    console.error('[sync] échec d’écriture du journal :', error);
  }
}

// Longueur actuelle du journal — mémorisée AVANT d'écrire le début d'un
// cycle, pour pouvoir le retirer intégralement s'il se termine sans la
// moindre action (les cycles à vide ne laissent rien, demande utilisateur).
export async function journalLength(): Promise<number> {
  try {
    const { vault } = requireBridges();
    const raw = await vault.readNote(SYNC_JOURNAL_REL_PATH);
    const parsed = JSON.parse(raw) as Partial<SyncJournal>;
    return Array.isArray(parsed.entries) ? parsed.entries.length : 0;
  } catch {
    return 0;
  }
}

// Retire les entrées au-delà de `keepLength` — utilisé pour retirer un
// début de cycle resté orphelin. Best-effort comme appendJournalEntries.
export async function truncateJournalEntries(keepLength: number): Promise<void> {
  try {
    const { vault } = requireBridges();
    const raw = await vault.readNote(SYNC_JOURNAL_REL_PATH);
    const parsed = JSON.parse(raw) as Partial<SyncJournal>;
    const entries = Array.isArray(parsed.entries) ? parsed.entries : [];
    await vault.writeNote(SYNC_JOURNAL_REL_PATH, JSON.stringify({ entries: entries.slice(0, keepLength) }));
  } catch (error) {
    console.error('[sync] échec de troncature du journal :', error);
  }
}

export const SYNC_JOURNAL_READ_PATH = SYNC_JOURNAL_REL_PATH;

// Clé d'objet Storage : <coffre>/<chemin encodé base64url>. L'encodage est
// OBLIGATOIRE depuis v0.4.9 : Supabase Storage rejette les clés contenant
// émojis/accents (« Invalid key » — vécu : 110 fichiers d'un coffre refusés
// au push, donc jamais récupérables depuis un autre appareil). Voir
// storageKeys.ts ; le chemin humain vit dans vault_files.rel_path.
function storageObjectPath(remoteVaultId: string, relPath: string): string {
  return `${remoteVaultId}/${vaultStorageObjectKey(relPath)}`;
}

function requireBridges() {
  if (!supabase) throw new Error('Client Supabase non configuré (variables EXPO_PUBLIC_SUPABASE_* absentes).');
  if (typeof window === 'undefined' || !window.vault || !window.sync || !window.vaults) {
    throw new Error('Synchronisation indisponible sur cette plateforme.');
  }
  return { supabase, vault: window.vault, sync: window.sync, vaults: window.vaults };
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

// Marque l'ORIGINE d'un coffre distant (demande v0.4.13 : « voir les coffres
// distants qui proviennent de mon ordinateur LORDI ») : le nom de l'appareil
// CRÉATEUR, écrit une seule fois — la condition `is null` garantit qu'un
// re-lien depuis une AUTRE machine (dossier recopié, réinstallation…) n'en
// change pas la provenance. Best-effort : un échec ne bloque jamais la
// liaison, l'origine restera simplement inconnue.
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

// Coffres distants du compte connecté — lecture seule, pour lister ce qui
// existe déjà côté cloud (Paramètres → « Coffres distants ») : s'y connecter
// depuis un nouvel appareil, ou y raccrocher un coffre local dont le dossier
// a été recréé, sans créer de doublon. RLS côté serveur : on ne reçoit que
// ses propres lignes, pas de filtre owner_id à dupliquer ici. `local_vault_id`
// reste l'identité du dossier CRÉATEUR (informatif) — la référence distante
// utilisée par la sync vit dans le registre local de chaque machine.
// `devices` : appareils ayant synchronisé ce coffre (table vault_devices),
// du plus récemment vu au plus ancien — la carte « Coffres distants »
// affiche « qui » est connecté et quand (demande v0.4.10).
// `createdByDevice` : appareil CRÉATEUR du coffre (v0.4.13) — d'où il
// « provient », distinct de qui l'a synchronisé depuis.
// `fileCount` : nombre de fichiers dans le coffre distant (v0.4.14) —
// distinguer « vide, en attente de contenu » d'un coffre rempli.
export type RemoteVaultSummary = {
  id: string;
  name: string;
  localVaultId: string | null;
  createdAt: string;
  devices: RemoteVaultDevice[];
  createdByDevice: string | null;
  fileCount: number;
};

// Crée un coffre distant DIRECTEMENT depuis le compte (v0.4.14 — modèle
// « le coffre distant est une donnée du compte », pas d'un ordinateur) :
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
async function fetchDevicesByVault(): Promise<Map<string, RemoteVaultDevice[]>> {
  if (!supabase) return new Map();
  const { data, error } = await supabase
    .schema(APP_SCHEMA)
    .from(VAULT_DEVICES_TABLE)
    .select('vault_id, device_id, device_name, last_seen_at');
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
    };
    const list = byVault.get(vaultId) ?? [];
    list.push(device);
    byVault.set(vaultId, list);
  }
  for (const list of byVault.values()) sortDevicesByLastSeen(list);
  return byVault;
}

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

// Renomme un vault distant (demande utilisateur : nommer les coffres
// distants d'après leur contenu réel pour lever les ambiguïtés). Le nom est
// cosmétique : l'id reste la clé de liaison et de Storage.
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

// Heartbeat « appareil connecté » : upsert d'une ligne vault_devices à chaque
// synchro réussie du coffre par CET appareil (identité stable du pont —
// hostname sur desktop, « Navigateur » sur web). Best-effort assumé : un
// échec (table absente, offline) est loggé mais ne fait PAS échouer la
// synchro ni apparaître d'erreur — le suivi d'appareils ne doit jamais
// casser la synchronisation des fichiers elle-même.
async function heartbeatDevice(remoteVaultId: string, ownerId: string): Promise<void> {
  try {
    if (!supabase) return;
    const info = typeof window !== 'undefined' && window.vaults ? await window.vaults.deviceInfo() : null;
    if (!info) return;
    const { error } = await supabase
      .schema(APP_SCHEMA)
      .from(VAULT_DEVICES_TABLE)
      .upsert(
        {
          vault_id: remoteVaultId,
          owner_id: ownerId,
          device_id: info.id,
          device_name: info.name,
          last_seen_at: new Date().toISOString(),
        },
        { onConflict: 'vault_id,device_id' },
      );
    if (error) throw error;
  } catch (error) {
    console.warn('[sync] heartbeat appareil ignoré :', errorMessage(error));
  }
}

// v0.4.55 — PAGINATION OBLIGATOIRE : l'API REST de Supabase plafonne toute
// réponse à 1000 lignes. Sur les gros coffres (EPANOUISSEMENT : 1600+ lignes
// vault_files), la liste distante était TRANCHÉE — les fichiers au-delà du
// plafond disparaissaient de `remoteByPath` à CHAQUE cycle, le diff les
// croyait nouveaux et les repoussait in finitum (« bloquage » : 572 fichiers
// re-poussés à chaque cycle, jamais convergés). On boucle par pages de 1000
// (ordre stable par rel_path) jusqu'à une page incomplète, avec un signal
// d'abandon pour ne jamais rester suspendu sur une connexion muette.
const REMOTE_FILES_PAGE_SIZE = 1000;
const REMOTE_FETCH_TIMEOUT_MS = 60_000;

async function fetchRemoteFiles(remoteVaultId: string): Promise<RemoteVaultFile[]> {
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
    // en `/` ici, sinon le pull aplatissait les sous-dossiers en fichiers à
    // racine (Android refuse les `\` dans les noms) et aucun chemin ne
    // correspondait entre le hash local et les lignes distantes.
    relPath: (row.rel_path as string).replace(/\\/g, '/'),
    // v0.4.54 : forme BRUTE conservée pour la purge des jumeaux backslashed
    // (la mise à jour doit viser la clé exacte en base, pas la normalisée).
    rawRelPath: row.rel_path as string,
    contentHash: row.content_hash as string,
    sizeBytes: row.size_bytes as number,
    updatedAt: row.updated_at as string,
    deleted: row.deleted as boolean,
    storageObjectPath: (row.storage_object_path as string | null) ?? undefined,
  }));
}

// Télécharge le contenu d'une note. Priorité à la clé ENREGISTRÉE dans
// vault_files (storage_object_path) : les fichiers poussés avant v0.4.9
// sous leur nom brut restent ainsi téléchargeables ; la clé recalculée ne
// sert qu'aux lignes qui n'en auraient pas.
// ⚠️ `Blob.text()` n'existe pas sur le Blob polyfillé de React Native :
// chaque pull levait « undefined is not a function » (v0.4.41-fix4, sur
// TOUT fichier tiré du cloud). FileReader lit le blob en texte UTF-8 sur
// toutes les plateformes (navigateur, Electron, Hermes).
async function blobToText(data: Blob): Promise<string> {
  if (typeof data.text === 'function') return data.text();
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('Lecture du fichier téléchargé impossible.'));
    reader.readAsText(data);
  });
}

// ---- PIÈCES JOINTES BINAIRES (v0.4.66 — « gestion des fichiers joints »)
// Images/PDF/audio : transport en base64 via les ponts binaires ; la liste
// des extensions est SYNC_ATTACHMENT_EXTENSIONS (nativeVaultAdapter).
const MAX_ATTACHMENT_ALERT_BYTES = 25 * 1024 * 1024;

// Gardes anti-suppression massive : un cycle bloqué pose le drapeau du coffre
// ; le cycle suivant lancé VOLONTAirement confirme (et retire le drapeau).
// Session-only : redémarrer l'app réarme la protection.
const massiveDeleteConfirmed = new Set<string>();

function isBinaryAttachmentRelPath(relPath: string): boolean {
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
async function downloadRemoteBinary(
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

async function downloadRemoteText(remoteVaultId: string, relPath: string, objectPath?: string): Promise<string> {
  const { supabase: client } = requireBridges();
  const key = objectPath ?? storageObjectPath(remoteVaultId, relPath);
  // ⚠️ Sur NATIF, ne PAS passer par storage.download() : supabase-js le
  // fait transiter par expo/fetch, qui tamponne TOUTE la réponse en
  // mémoire Java (DirectByteBuffer) — OutOfMemoryError natif au bout de
  // quelques fichiers, mort du processus (vécu : « la synchro charge
  // indéfiniment », fix4/fix5). Téléchargement DIRECT vers un fichier de
  // cache (okhttp → disque, zéro tampon JS/Java), lecture, nettoyage.
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

async function pushFile(
  remoteVaultId: string,
  ownerId: string,
  note: LocalHashedNote,
  journal: SyncJournalEntry[] = [],
): Promise<void> {
  const { supabase: client, vault } = requireBridges();
  // v0.4.54 : défense en profondeur — quel que soit le pont, le chemin
  // poussé au cloud est TOUJOURS en slashes POSIX (un backslashed créait
  // un doublon cloud jamais matché, cassant tombestones et pulls).
  const relPath = note.relPath.split('\\').join('/');
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

  // Alerte VOLUMINEUX (v0.4.66 — choix de l'utilisatrice : sans limite de
  // taille, mais signalée au-delà de 25 Mo dans le journal de synchro).
  if (isBinaryAttachmentRelPath(relPath) && note.sizeBytes > MAX_ATTACHMENT_ALERT_BYTES) {
    journal.push(
      makeJournalEntry('push', {
        path: relPath,
        detail: `⚠️ fichier volumineux synchronisé : ${(note.sizeBytes / (1024 * 1024)).toFixed(1)} Mo`,
      }),
    );
  }

  // Base de fusion (v0.4.29) : la version qui vient d'être acceptée des deux
  // côtés servira de référentiel au prochain conflit (fusion à trois voix
  // diff-match-patch). Best-effort : une base manquante fait retomber le
  // conflit sur le comportement gagnant/perdant archivé.
  if (typeof uploadBody === 'string') {
    await saveSyncBase(relPath, uploadBody);
  }
}

async function pullFile(remoteVaultId: string, relPath: string, objectPath?: string): Promise<void> {
  const { vault } = requireBridges();
  // Pièces jointes BINAIRES (v0.4.66) : transport base64 via les ponts
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

// Bases de fusion (v0.4.29) : dernière version SYNCHRONISÉE de chaque
// fichier, stockée hors arbre synchronisé (`.123ecriture/bases/<clé>` —
// même encodage base64url que les clés Storage, un fichier par note).
// C'est le « base » de la fusion à trois voix : sans elle, impossible de
// distinguer ce que chaque côté a modifié.
const SYNC_BASES_DIR = '.123ecriture/bases';

function syncBaseRelPath(relPath: string): string {
  return `${SYNC_BASES_DIR}/${vaultStorageObjectKey(relPath)}`;
}

async function saveSyncBase(relPath: string, content: string): Promise<void> {
  try {
    const { vault } = requireBridges();
    await vault.writeNote(syncBaseRelPath(relPath), content);
  } catch {
    // Best-effort total : jamais faire échouer un push/pull pour ça.
  }
}

async function loadSyncBase(relPath: string): Promise<string | null> {
  try {
    const { vault } = requireBridges();
    return await vault.readNote(syncBaseRelPath(relPath));
  } catch {
    return null;
  }
}

// Écrit le côté PERDANT d'un conflit AVANT de l'écraser — jamais de perte
// silencieuse. v0.4.26 : sous `.123ecriture/conflits/<horodatage>/…` — un
// dossier caché, donc HORS de l'arbre synchronisé. Avant, la copie était un
// fichier normal dans le coffre : elle se synchronisait comme n'importe
// quelle note, et un appareil en retard la REPOUSSAIT comme contenu actif
// après une suppression — ressuscitant en boucle des fichiers supprimés
// (« copies (conflit …) » revenues sans cesse, vécu). Le contenu reste
// récupérable sur l'appareil qui a tranché le conflit, sans polluer le
// coffre ni la synchro.
async function backupLosingSide(relPath: string, content: string): Promise<void> {
  const { vault } = requireBridges();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupRelPath = `.123ecriture/conflits/${timestamp}/${relPath}`;
  await vault.writeNote(backupRelPath, content);
}

// Restaure un fichier depuis la corbeille synchronisée `.trash/` vers son
// chemin d'origine (v0.4.26). Le chemin d'origine est lu dans la structure
// miroir de la corbeille (`.trash/A/B.md` → `A/B.md`). Étapes :
// 1) déplacement local (vault.set-path, avec dédoublonnage « 2 », « 3 » si
//    un fichier plus récent occupe déjà la place) ;
// 2) SUPPRESSION de la ligne tombestone distale (hard DELETE, pas un
//    update deleted=false — le trigger anti-résurrection bloque toute
//    réactivation à hash identique, et le filtre du moteur interdit le
//    push des chemins tombestonés : détruire la ligne est le seul chemin
//    propre ; les clients ne font jamais de DELETE, donc la garde garde
//    tout son sens pour eux) ;
// 3) repousse IMMÉDIATE du fichier restauré — sans ça, un autre appareil
//    dont le cycle passe entre le DELETE et notre prochain cycle
//    re-tombestonerait le chemin (il l'a dans son état, plus sur son
//    disque) et la restauration serait mangée.
export async function restoreFromTrash(
  trashRelPath: string,
  remoteVaultId: string,
  ownerId: string,
): Promise<string> {
  const { vault, sync, supabase: client } = requireBridges();
  if (!trashRelPath.startsWith('.trash/')) {
    throw new Error('Ce chemin n’est pas dans la corbeille.');
  }
  const normalize = (p: string) => p.replace(/\\/g, '/');
  const originalBase = trashRelPath.slice('.trash/'.length);

  // Destination : le chemin d'origine, dédoublonné si réoccupé entre-temps
  // (set-path REFUSE une destination existante — on calcule un suffixe
  // libre depuis l'arborescence plutôt que d'échouer).
  const tree = await vault.listTree();
  const existing = new Set<string>();
  const collect = (nodes: { relPath: string; children?: unknown }[]): void => {
    for (const node of nodes) {
      existing.add(normalize(node.relPath));
      if (Array.isArray(node.children)) collect(node.children as { relPath: string; children?: unknown }[]);
    }
  };
  collect(tree);
  const dot = originalBase.lastIndexOf('.');
  const stem = dot >= 0 ? originalBase.slice(0, dot) : originalBase;
  const ext = dot >= 0 ? originalBase.slice(dot) : '';
  let target = originalBase;
  for (let counter = 2; existing.has(normalize(target)); counter += 1) {
    target = `${stem} ${counter}${ext}`;
  }

  const wasDeduped = normalize(target) !== normalize(originalBase);
  const moved = await vault.setPath(trashRelPath, target);
  // Destination réoccupée (dédoublonnée) : le chemin d'origine est VIVANT
  // — aucune tombestone à détruire (et surtout pas la ligne de l'occupant).
  // Sinon, on détruit la tombestone du chemin d'origine (la ligne .trash,
  // elle, disparaîtra d'elle-même au cycle suivant : absente du disque,
  // présente dans l'état → tombestone automatique).
  if (!wasDeduped) {
    const { error: deleteError } = await client
      .schema(APP_SCHEMA)
      .from(VAULT_FILES_TABLE)
      .delete()
      .eq('vault_id', remoteVaultId)
      .eq('rel_path', moved.relPath);
    if (deleteError) throw deleteError;
  }

  // Repousse immédiate du contenu restauré.
  const localFiles = await sync.hashVaultTree();
  const restored = localFiles.find((note) => note.relPath === moved.relPath);
  if (restored) {
    await pushFile(remoteVaultId, ownerId, restored);
  }
  await appendJournalEntries([makeJournalEntry('restore', { path: moved.relPath })]);
  return moved.relPath;
}

// Tentative de fusion à trois voix d'un conflit (v0.4.29, diff-match-patch
// comme Obsidian Sync). Retourne true si le conflit est RÉSOLU par fusion :
// les deux versions sont réunies (modifications de parties différentes),
// écrites localement ET poussées — les deux appareils convergent. Retourne
// false quand il n'y a pas de base de fusion ou que les modifications se
// chevauchent réellement : l'appelant retombe sur le comportement
// gagnant/perdant archivé d'avant.
async function attemptConflictMerge(
  remoteVaultId: string,
  ownerId: string,
  relPath: string,
  remoteObjectPath: string | undefined,
  journal: SyncJournalEntry[],
): Promise<boolean> {
  if (isBinaryAttachmentRelPath(relPath)) return false; // jamais de fusion binaire
  const base = await loadSyncBase(relPath);
  if (base === null) return false;
  let local: string;
  let remote: string;
  try {
    const { vault } = requireBridges();
    local = await vault.readNote(relPath);
    remote = await downloadRemoteText(remoteVaultId, relPath, remoteObjectPath);
  } catch {
    return false;
  }
  const merged = tryThreeWayMerge(base, local, remote);
  if (merged.kind !== 'merged') return false;
  // Garde JSON (v0.4.65) : les métadonnées synchronisées sont du JSON
  // (tasks/tasklists/preferences) — une fusion par caractères peut produire
  // du texte inanalysable. Si le résultat ne se parse pas, on retombe sur
  // le comportement gagnant/perdant plutôt que d'écrire un fichier cassé.
  if (relPath.toLowerCase().endsWith('.json')) {
    try {
      JSON.parse(merged.text);
    } catch {
      return false;
    }
  }

  const { vault, sync } = requireBridges();
  await vault.writeNote(relPath, merged.text);
  const tree = await sync.hashVaultTree();
  const note = tree.find((n) => n.relPath === relPath);
  if (!note) return false;
  await pushFile(remoteVaultId, ownerId, note, journal);
  journal.push(
    makeJournalEntry('conflict', {
      path: relPath,
      detail: 'fusion automatique des deux versions (diff-match-patch)',
    }),
  );
  return true;
}

// Lance une synchro complète (push + pull + résolution de conflit) pour le
// coffre ACTIF (v0.4.28). `trigger` (v0.4.27) alimente le journal : d'où
// vient ce cycle (« manuel », « automatique (60 s) », « surveillance du
// dossier », « retour à l'app », « démarrage »).
//
// v0.4.28 — COHÉRENCE STRUCTURELLE : l'identifiant du coffre distant n'est
// plus un paramètre venu du renderer (latestRef mis à jour dans un effet
// React) mais est DÉDUIT ICI du coffre actif via le pont (getActive +
// registre), exactement comme le dossier haché et toutes les opérations
// fichiers (elles opèrent par construction sur le coffre actif). La fenêtre
// de course qui croisait « distant du coffre A » avec « dossier du coffre
// B » lors d'une bascule immédiatement suivie d'une synchro — la
// contamination croisée vécue les 19-20/09 — devient impossible : le
// moteur peut au pire synchroniser l'ANCIEN coffre actif un cycle de trop,
// jamais deux coffres entremêlés.
export async function runSync(ownerId: string, trigger = 'automatique'): Promise<SyncSummary> {
  const summary: SyncSummary = { pushed: 0, pulled: 0, deleted: 0, conflicts: 0, errors: [] };
  let bridges;
  try {
    bridges = requireBridges();
  } catch (error) {
    summary.errors.push(errorMessage(error));
    return summary;
  }

  // Résolution cohérente du coffre ACTIF (dossier ET distant ensemble).
  const [activeId, vaultEntries] = await Promise.all([
    bridges.vaults.getActive(),
    bridges.vaults.list(),
  ]);
  const activeEntry = pickActiveRemoteVault(vaultEntries, activeId);
  if (!activeEntry || !activeEntry.remoteVaultId) {
    await appendJournalEntries([
      makeJournalEntry('info', { detail: 'cycle ignoré : le coffre actif n’est pas lié au cloud' }),
    ]);
    return summary;
  }
  const remoteVaultId = activeEntry.remoteVaultId;

  // Verrou ANTI-BASCULE (v0.4.54 — cause racine du mélange de coffres) :
  // le bucket distant est capturé ICI, mais chaque opération locale
  // (hachage, lecture, écriture, suppression) relit le coffre ACTIF au
  // moment de son IPC. Si le coffre actif change pendant le cycle, le
  // contenu de A partait dans le bucket de B et le cloud de A s'écrivait
  // sur le disque de B — c'est exactement le mélange vécu. Pendant le
  // cycle, `vaults:switch` est donc REFUSÉ par le main process (TTL de
  // 10 min : un crash du renderer ne bloque pas l'app pour toujours).
  await bridges.sync.setVaultLock?.(true);

  // Le journal PROGRESSIF (demande utilisateur : raconter comme Obsidian
  // Sync — « connexion au serveur », « upload en cours », « upload terminé »)
  // : la connexion s'écrit immédiatement, les étapes au fil de l'eau. SI le
  // cycle ne produit AUCUNE action (aucun changement), il est RETIRÉ du
  // journal à la fin : un cycle à vide ne laisse rien (pas de spam de
  // « 0 envoyée(s) » à chaque minute — demande utilisateur explicite).
  const journal: SyncJournalEntry[] = [makeJournalEntry('connexion')];
  const journalStartLength = await journalLength();
  await appendJournalEntries(journal);

  const [remoteFiles, syncState] = await Promise.all([
    fetchRemoteFiles(remoteVaultId),
    loadSyncState(),
  ]);
  // v0.4.54 : défense en profondeur — les relPaths locaux sont ramenés en
  // slashes POSIX quel que soit le pont (le scan desktop produisait des `\`
  // sur Windows : 1577 doublons cloud, tombestones jamais envoyées,
  // résurrections en boucle — voir le fix à la source dans sync.ts).
  const localFiles = (await bridges.sync.hashVaultTree()).map((note) => ({
    ...note,
    relPath: note.relPath.split('\\').join('/'),
  }));
  const localByPath = new Map(localFiles.map((note) => [note.relPath, note]));
  const localPaths = new Set(localFiles.map((note) => note.relPath));

  // ---- SUPPRESSIONS (v0.4.17, orchestration v0.4.22) --------------------
  // ORDRE CRITIQUE, appris du bug de résurrection : une ligne deleted=true
  // (ou qu'on vient de tombestoner) est INTERDITE de pull ET de push pour
  // tout le cycle — sinon le diff, calculé sur une liste distante périmée,
  // retélécharge le fichier qu'on vient de déclarer mort, puis le repousse
  // (upsert deleted:false), le ressuscitant à jamais.
  const activeRemoteFiles = remoteFiles.filter((file) => !file.deleted);
  const remoteByPath = new Map(activeRemoteFiles.map((file) => [file.relPath, file]));
  const tombstonedPaths = new Set(
    remoteFiles.filter((file) => file.deleted).map((file) => file.relPath),
  );

  // 1bis) PURGE DES JUMEAUX BACKSLASHED (v0.4.54) : Windows ne peut pas
  // créer de fichier dont le nom contient `\` — toute ligne distante ACTIVE
  // avec `\` dans son rel_path est donc un résidu du bug de séparateurs
  // (avant normalisation) : elle est tombestonnée à jamais, quel que soit
  // son contenu. Sans cette purge, ces lignes restaient actives dans le
  // cloud et le diff les re-téléchargeait — la résurrection en boucle vécue
  // sur les coffres contaminés.
  // v0.4.55 : PAR LOTS (.in() par 100, délai d'attente 30 s) — la version
  // par ligne (791 requêtes séquentielles) suspendait le cycle entier sur
  // une connexion lente, en gardant l'UI sur « Synchronisation… ».
  const backslashedRawPaths = activeRemoteFiles
    .filter((file) => (file.rawRelPath ?? '').includes('\\'))
    .map((file) => file.rawRelPath as string);
  for (let i = 0; i < backslashedRawPaths.length; i += 100) {
    const chunk = backslashedRawPaths.slice(i, i + 100);
    try {
      let update = bridges.supabase
        .schema(APP_SCHEMA)
        .from(VAULT_FILES_TABLE)
        .update({ deleted: true, updated_at: new Date().toISOString() })
        .in('rel_path', chunk);
      const signal = abortAfter(30_000);
      if (signal) update = update.abortSignal(signal);
      const { error } = await update;
      if (error) throw error;
      chunk
        .map((raw) => raw.replace(/\\/g, '/'))
        .forEach((normalized) => tombstonedPaths.add(normalized));
      summary.deleted += chunk.length;
      journal.push(
        makeJournalEntry('delete', { detail: `purge backslashed : ${chunk.length} ligne(s) — ex. ${chunk.slice(0, 2).join(' | ').slice(0, 140)}` }),
      );
    } catch (error) {
      console.error('[sync] échec de la purge backslashed :', error);
      journal.push(
        makeJournalEntry('error', { detail: `purge backslashed : ${errorMessage(error)}` }),
      );
    }
  }

  // 1) Supprimés LOCALEMENT depuis le dernier cycle -> tombestones distantes.
  // GARDE ANTI-SUPPRESSION MASSIVE (v0.4.66) : un appareil dont le contenu
  // local est incomplet (pull partiel, coffre fraîchement reconnecté, panne
  // de disque) déclare « supprimés » TOUS les fichiers qu'il n'a pas — et
  // vide le cloud ET les autres appareils (vécu WORLDBUILDING 15/10/2026 :
  // 2000 fichiers). Au-delà du seuil, les tombestones sont BLOQUÉES ; un
  // second cycle lancé VOLONTAirement les confirme (flag session, oublié au
  // redémarrage de l'app — la protection revient toute seule).
  const locallyDeleted = computeLocalDeletions(syncState.files, localPaths);
  const massiveThreshold = Math.max(10, Math.ceil(localFiles.length * 0.3));
  if (locallyDeleted.length > massiveThreshold && !massiveDeleteConfirmed.has(remoteVaultId)) {
    massiveDeleteConfirmed.add(remoteVaultId);
    const message = `${locallyDeleted.length} fichier(s) manquent localement (coffre : ${localFiles.length} fichiers) — suppressions BLOQUÉES par le garde anti-suppression. Si cette suppression massive est VOLONTAIRE, relancez « Synchroniser » une fois pour la confirmer ; sinon, vos fichiers seront restaurés par la synchronisation.`;
    summary.errors.push(message);
    journal.push(makeJournalEntry('error', { detail: message }));
  } else {
    if (massiveDeleteConfirmed.has(remoteVaultId)) massiveDeleteConfirmed.delete(remoteVaultId);
    for (const relPath of locallyDeleted) {
      try {
        if (remoteByPath.has(relPath)) {
          const { error } = await bridges.supabase
            .schema(APP_SCHEMA)
            .from(VAULT_FILES_TABLE)
            .update({ deleted: true, updated_at: new Date().toISOString() })
            .eq('vault_id', remoteVaultId)
            .eq('rel_path', relPath);
          if (error) throw error;
        }
        tombstonedPaths.add(relPath);
        summary.deleted += 1;
        journal.push(makeJournalEntry('delete', { path: relPath, detail: 'suppression locale propagée' }));
      } catch (error) {
        console.error(`[sync] échec de la tombestone ${relPath} :`, error);
        summary.errors.push(`${relPath} (suppression) : ${errorMessage(error)}`);
        journal.push(makeJournalEntry('error', { path: relPath, detail: `suppression locale : ${errorMessage(error)}` }));
      }
    }
  }

  // 2) Tombestones distantes (y compris celles qu'on vient de poser) :
  //    application locale CONSERVATRICE (voir remoteDeletionAction) — un
  //    fichier jamais apporté par la synchro n'est jamais effacé, un fichier
  //    modifié laisse une copie « (conflit …) » avant de partir.
  const appliedDeletions = new Set<string>();
  for (const relPath of tombstonedPaths) {
    const local = localByPath.get(relPath);
    if (!local) continue;
    try {
      const action = remoteDeletionAction({
        localExists: true,
        lastSyncedHash: syncState.files[relPath],
        localHash: local.contentHash,
      });
      if (action === 'skip') continue;
      if (action === 'keep-copy') {
        const losingLocalContent = await bridges.vault.readNote(relPath);
        await backupLosingSide(relPath, losingLocalContent);
        journal.push(makeJournalEntry('conflict', { path: relPath, detail: 'supprimé ailleurs mais modifié ici — copie de secours conservée' }));
      }
      // silent (v0.4.25) : la suppression a déjà été décidée par
      // l'appareil émetteur — une confirmation PAR FICHIER rendait une
      // synchro à 100 suppressions inutilisable ; le mode silencieux
      // élague aussi les dossiers parents devenus vides (le dossier
      // conteneur disparaît avec ses fichiers, pas seulement ces derniers).
      await bridges.vault.delete(relPath, { silent: true });
      appliedDeletions.add(relPath);
      summary.deleted += 1;
      journal.push(makeJournalEntry('delete', { path: relPath, detail: 'suppression distante appliquée (corbeille)' }));
    } catch (error) {
      console.error(`[sync] échec de la suppression distante ${relPath} :`, error);
      summary.errors.push(`${relPath} (suppression distante) : ${errorMessage(error)}`);
      journal.push(makeJournalEntry('error', { path: relPath, detail: `suppression distante : ${errorMessage(error)}` }));
    }
  }

  // 3) Diff SUR LES ENSEMBLES FILTRÉS : ni les tombestones (jamais de
  //    pull, jamais de push — push les réactiverait), ni les fichiers
  //    supprimés localement (absents du disque).
  const diffLocalFiles = localFiles.filter((note) => !tombstonedPaths.has(note.relPath));
  const diffRemoteFiles = activeRemoteFiles.filter((file) => !tombstonedPaths.has(file.relPath));
  const decisions = diffVault(diffLocalFiles, diffRemoteFiles);

  // Les étapes réseau (demande utilisateur : le journal raconte comme
  // Obsidian Sync — « upload en cours », « upload terminé »).
  const pushCount = decisions.filter((d) => d.kind === 'push' || d.kind === 'conflict-push-wins').length;
  const pullCount = decisions.filter((d) => d.kind === 'pull' || d.kind === 'conflict-pull-wins').length;
  if (pushCount > 0) journal.push(makeJournalEntry('upload-start', { detail: `${pushCount} fichier(s)` }));
  if (pullCount > 0) journal.push(makeJournalEntry('download-start', { detail: `${pullCount} fichier(s)` }));

  for (const decision of decisions) {
    try {
      switch (decision.kind) {
        case 'noop':
          break;
        case 'push': {
          const note = localByPath.get(decision.relPath);
          if (!note) break;
          await pushFile(remoteVaultId, ownerId, note, journal);
          summary.pushed += 1;
          journal.push(makeJournalEntry('push', { path: decision.relPath }));
          break;
        }
        case 'pull':
          // ANTI-CONTAMINATION (v0.4.67) : un chemin contenant un `\` est un
          // résidu backslashed du mélange — le créer créerait un FICHIER PLAT
          // au nom impossible (légal sur Android, pas sur le fs desktop) qui
          // re-contaminerait le cloud à son tour. La purge les tombestone
          // déjà au début du cycle ; ici on refuse par double sécurité.
          if (decision.relPath.includes('\\')) {
            journal.push(
              makeJournalEntry('error', { path: decision.relPath, detail: 'pull bloqué : chemin contaminé (backslash)' }),
            );
            break;
          }
          await pullFile(remoteVaultId, decision.relPath, remoteByPath.get(decision.relPath)?.storageObjectPath);
          summary.pulled += 1;
          journal.push(makeJournalEntry('pull', { path: decision.relPath }));
          break;
        case 'conflict-push-wins': {
          // v0.4.29 : fusion à trois voix d'abord (diff-match-patch) — deux
          // modifications de parties différentes sont réunies, aucune des
          // deux n'est archivée. Repli : gagnant local + perdant archivé.
          if (
            await attemptConflictMerge(
              remoteVaultId,
              ownerId,
              decision.relPath,
              remoteByPath.get(decision.relPath)?.storageObjectPath,
              journal,
            )
          ) {
            summary.conflicts += 1;
            break;
          }
          const note = localByPath.get(decision.relPath);
          if (!note) break;
          const losingRemoteContent = await downloadRemoteText(
            remoteVaultId,
            decision.relPath,
            remoteByPath.get(decision.relPath)?.storageObjectPath,
          );
          await backupLosingSide(decision.relPath, losingRemoteContent);
          await pushFile(remoteVaultId, ownerId, note, journal);
          summary.pushed += 1;
          summary.conflicts += 1;
          journal.push(makeJournalEntry('conflict', { path: decision.relPath, detail: 'version locale conservée, distante archivée' }));
          break;
        }
        case 'conflict-pull-wins': {
          if (
            await attemptConflictMerge(
              remoteVaultId,
              ownerId,
              decision.relPath,
              remoteByPath.get(decision.relPath)?.storageObjectPath,
              journal,
            )
          ) {
            summary.conflicts += 1;
            break;
          }
          const losingLocalContent = await bridges.vault.readNote(decision.relPath);
          await backupLosingSide(decision.relPath, losingLocalContent);
          await pullFile(remoteVaultId, decision.relPath, remoteByPath.get(decision.relPath)?.storageObjectPath);
          summary.pulled += 1;
          summary.conflicts += 1;
          journal.push(makeJournalEntry('conflict', { path: decision.relPath, detail: 'version distante conservée, locale archivée' }));
          break;
        }
      }
    } catch (error) {
      console.error(`[sync] échec sur ${decision.relPath} (${decision.kind}) :`, error);
      summary.errors.push(`${decision.relPath} : ${errorMessage(error)}`);
      journal.push(makeJournalEntry('error', { path: decision.relPath, detail: `${decision.kind} : ${errorMessage(error)}` }));
    }
  }

  if (pushCount > 0) journal.push(makeJournalEntry('upload-end', { detail: `${pushCount} fichier(s)` }));
  if (pullCount > 0) journal.push(makeJournalEntry('download-end', { detail: `${pullCount} fichier(s)` }));

  // Nouvel état de référence = ensemble local APRES le cycle : fichiers
  // locaux présents (push/noop/'skip' conservés), fichiers tirés avec le
  // hash distant, suppressions retirées. Une erreur avant ici laisse
  // l'ancien état : le prochain cycle re-détecte tout idempotemment.
  const nextFiles: Record<string, string> = {};
  for (const note of localFiles) {
    if (appliedDeletions.has(note.relPath)) continue;
    if (locallyDeleted.includes(note.relPath)) continue;
    nextFiles[note.relPath] = note.contentHash;
  }
  for (const decision of decisions) {
    if (decision.kind !== 'pull' && decision.kind !== 'conflict-pull-wins') continue;
    const remote = remoteByPath.get(decision.relPath);
    if (remote) nextFiles[decision.relPath] = remote.contentHash;
  }
  try {
    await saveSyncState({ files: nextFiles });
  } catch (error) {
    console.error('[sync] échec de la sauvegarde de l’état de synchro :', error);
    journal.push(makeJournalEntry('error', { detail: `sauvegarde de l'état : ${errorMessage(error)}` }));
  }

  // « Appareils connectés » (Paramètres → Coffres distants) : heartbeat
  // best-effort APRÈS le cycle de fichiers — jamais dans les erreurs du
  // résumé (voir heartbeatDevice).
  await heartbeatDevice(remoteVaultId, ownerId);

  journal.push(
    makeJournalEntry('cycle-end', {
      detail: `${summary.pushed} envoyé(s), ${summary.pulled} reçu(s), ${summary.deleted} supprimé(s), ${summary.conflicts} conflit(s)${summary.errors.length > 0 ? `, ${summary.errors.length} erreur(s)` : ''}`,
    }),
  );

  // Cycle SANS aucune action : la « Connexion au serveur » est retirée — le
  // journal ne garde que les cycles qui ont réellement fait quelque chose
  // (demande utilisateur : pas de spam de cycles à vide).
  if (journal.length > 1) {
    await appendJournalEntries(journal.slice(1));
  } else {
    await truncateJournalEntries(journalStartLength);
  }

  await bridges.sync.setVaultLock?.(false);
  return summary;
}
