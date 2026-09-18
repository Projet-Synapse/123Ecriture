import {
  APP_SCHEMA,
  supabase,
  VAULT_DEVICES_TABLE,
  VAULT_FILES_BUCKET,
  VAULT_FILES_TABLE,
  VAULTS_TABLE,
} from './supabaseClient';
import { diffVault, type LocalHashedNote, type RemoteVaultFile } from './diff';
import { errorMessage } from '../errorMessage';
import { sortDevicesByLastSeen, type RemoteVaultDevice } from './devices';
import { vaultStorageObjectKey } from './storageKeys';

// Orchestrateur de synchro (v0, manuel, sans timer — voir
// docs/ARCHITECTURE.md §6) : appelle le pont Electron (hash local, lecture/
// écriture de notes) et le client Supabase (Storage + table de métadonnées),
// applique les décisions de diff.ts. Volontairement fin et non testable
// unitairement (trop d'effets de bord réels) — toute la logique de décision
// qui mérite des tests vit dans diff.ts.

export type SyncSummary = {
  pushed: number;
  pulled: number;
  conflicts: number;
  errors: string[];
};

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
  if (typeof window === 'undefined' || !window.vault || !window.sync) {
    throw new Error('Synchronisation indisponible sur cette plateforme.');
  }
  return { supabase, vault: window.vault, sync: window.sync };
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
export type RemoteVaultSummary = {
  id: string;
  name: string;
  localVaultId: string | null;
  createdAt: string;
  devices: RemoteVaultDevice[];
  createdByDevice: string | null;
};

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
  const [vaultsResult, devicesByVault] = await Promise.all([
    supabase
      .schema(APP_SCHEMA)
      .from(VAULTS_TABLE)
      .select('id, name, local_vault_id, created_at, created_by_device')
      .order('created_at', { ascending: true }),
    fetchDevicesByVault(),
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
  }));
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

async function fetchRemoteFiles(remoteVaultId: string): Promise<RemoteVaultFile[]> {
  const { supabase: client } = requireBridges();
  const { data, error } = await client
    .schema(APP_SCHEMA)
    .from(VAULT_FILES_TABLE)
    .select('rel_path, content_hash, size_bytes, updated_at, deleted, storage_object_path')
    .eq('vault_id', remoteVaultId);
  if (error) throw error;
  return (data ?? []).map((row) => ({
    relPath: row.rel_path as string,
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
async function downloadRemoteText(remoteVaultId: string, relPath: string, objectPath?: string): Promise<string> {
  const { supabase: client } = requireBridges();
  const key = objectPath ?? storageObjectPath(remoteVaultId, relPath);
  const { data, error } = await client.storage.from(VAULT_FILES_BUCKET).download(key);
  if (error) throw error;
  return data.text();
}

async function pushFile(remoteVaultId: string, ownerId: string, note: LocalHashedNote): Promise<void> {
  const { supabase: client, vault } = requireBridges();
  const content = await vault.readNote(note.relPath);
  const { error: uploadError } = await client.storage
    .from(VAULT_FILES_BUCKET)
    .upload(storageObjectPath(remoteVaultId, note.relPath), content, {
      upsert: true,
      contentType: 'text/plain;charset=UTF-8',
    });
  if (uploadError) throw uploadError;

  const { error: upsertError } = await client
    .schema(APP_SCHEMA)
    .from(VAULT_FILES_TABLE)
    .upsert(
      {
        vault_id: remoteVaultId,
        owner_id: ownerId,
        rel_path: note.relPath,
        content_hash: note.contentHash,
        size_bytes: note.sizeBytes,
        storage_object_path: storageObjectPath(remoteVaultId, note.relPath),
        updated_at: new Date(note.modifiedAt).toISOString(),
        deleted: false,
      },
      { onConflict: 'vault_id,rel_path' },
    );
  if (upsertError) throw upsertError;
}

async function pullFile(remoteVaultId: string, relPath: string, objectPath?: string): Promise<void> {
  const { vault } = requireBridges();
  const content = await downloadRemoteText(remoteVaultId, relPath, objectPath);
  await vault.writeNote(relPath, content);
}

// Écrit le côté PERDANT d'un conflit dans un fichier normal et visible avant
// de l'écraser — jamais de perte silencieuse (règle CLAUDE.md). Un fichier
// ordinaire (même extension que l'original — `.mdx`, `.md`...) que
// l'utilisatrice peut ouvrir/comparer/supprimer, pas un mécanisme caché.
async function backupLosingSide(relPath: string, content: string): Promise<void> {
  const { vault } = requireBridges();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dot = relPath.lastIndexOf('.');
  const withoutExt = dot >= 0 ? relPath.slice(0, dot) : relPath;
  const extension = dot >= 0 ? relPath.slice(dot) : '';
  const parentSlash = withoutExt.lastIndexOf('/');
  const parent = parentSlash >= 0 ? withoutExt.slice(0, parentSlash + 1) : '';
  const baseName = parentSlash >= 0 ? withoutExt.slice(parentSlash + 1) : withoutExt;
  const backupRelPath = `${parent}${baseName} (conflit ${timestamp})${extension}`;
  await vault.writeNote(backupRelPath, content);
}

// Lance une synchro complète (push + pull + résolution de conflit) pour le
// vault lié `remoteVaultId`. v0 : ne propage pas les suppressions locales
// (voir docs/ARCHITECTURE.md §6) — assumé et documenté, pas un oubli.
export async function runSync(remoteVaultId: string, ownerId: string): Promise<SyncSummary> {
  const summary: SyncSummary = { pushed: 0, pulled: 0, conflicts: 0, errors: [] };
  let bridges;
  try {
    bridges = requireBridges();
  } catch (error) {
    summary.errors.push(errorMessage(error));
    return summary;
  }

  const [localFiles, remoteFiles] = await Promise.all([
    bridges.sync.hashVaultTree(),
    fetchRemoteFiles(remoteVaultId),
  ]);
  const localByPath = new Map(localFiles.map((note) => [note.relPath, note]));
  const remoteByPath = new Map(remoteFiles.map((file) => [file.relPath, file]));
  const decisions = diffVault(localFiles, remoteFiles);

  for (const decision of decisions) {
    try {
      switch (decision.kind) {
        case 'noop':
          break;
        case 'push': {
          const note = localByPath.get(decision.relPath);
          if (!note) break;
          await pushFile(remoteVaultId, ownerId, note);
          summary.pushed += 1;
          break;
        }
        case 'pull':
          await pullFile(remoteVaultId, decision.relPath, remoteByPath.get(decision.relPath)?.storageObjectPath);
          summary.pulled += 1;
          break;
        case 'conflict-push-wins': {
          const note = localByPath.get(decision.relPath);
          if (!note) break;
          const losingRemoteContent = await downloadRemoteText(
            remoteVaultId,
            decision.relPath,
            remoteByPath.get(decision.relPath)?.storageObjectPath,
          );
          await backupLosingSide(decision.relPath, losingRemoteContent);
          await pushFile(remoteVaultId, ownerId, note);
          summary.pushed += 1;
          summary.conflicts += 1;
          break;
        }
        case 'conflict-pull-wins': {
          const losingLocalContent = await bridges.vault.readNote(decision.relPath);
          await backupLosingSide(decision.relPath, losingLocalContent);
          await pullFile(remoteVaultId, decision.relPath, remoteByPath.get(decision.relPath)?.storageObjectPath);
          summary.pulled += 1;
          summary.conflicts += 1;
          break;
        }
      }
    } catch (error) {
      console.error(`[sync] échec sur ${decision.relPath} (${decision.kind}) :`, error);
      summary.errors.push(`${decision.relPath} : ${errorMessage(error)}`);
    }
  }

  // « Appareils connectés » (Paramètres → Coffres distants) : heartbeat
  // best-effort APRÈS le cycle de fichiers — jamais dans les erreurs du
  // résumé (voir heartbeatDevice).
  await heartbeatDevice(remoteVaultId, ownerId);

  return summary;
}
