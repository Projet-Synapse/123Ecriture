//////////
// ✒️ 123ECRITURE — deviceGateway.ts
// PASSERELLE À DISTANCE (v0.4.76) : exécution des commandes adressées à
// CET appareil via le cloud — les yeux et les mains, sans adb
//////////

// INTRODUCTION — Demande de Catelina : « une passerelle alternative au
// câble USB et au débogage sans fil qui te permet de contrôler si
// nécessaire mon téléphone Android ». Chaque appareil exécute, à chaque
// cycle de synchro, les commandes `pending` de la table
// app_123ecriture.device_commands qui lui sont adressées, et publie le
// résultat (audit conservé dans la table). Le canal est Supabase, déjà
// authentifié (RLS owner) — aucun câble, aucun débogage sans fil.
//
// LIMITATION HONNÊTE : les commandes s'exécutent quand l'app tourne un
// cycle (app ouverte ou réveillée). Aucun réveil à distance en v1.
//
// Commandes v1 :
//   - dump-diagnostics  → rapport complet (diagnostics.ts) en résultat
//   - clear-sync-block  → lève le disjoncteur (après revue)
//   - lock-sync         → pose le bloc local (motif dans params.reason)
//   - unlock-sync       → lève le bloc local
//
// SOMMAIRE :
//   1. 📥 processDeviceCommands — la boucle d'exécution
//   2. 🛠️ Exécution unitaire (executeCommand)
//   3. 📤 queueDeviceCommand (pose d'une commande, pour l'UI)

import { Platform } from 'react-native';

import { APP_SCHEMA, DEVICE_COMMANDS_TABLE, VAULT_FILES_TABLE, supabase } from './supabaseClient';
import { errorMessage } from '../errorMessage';
// Le chemin du journal est défini dans syncEngine (repris ici sans
// import pour éviter un cycle : syncEngine importe cette passerelle).
const SYNC_JOURNAL_READ_PATH = '.123ecriture/sync-journal.json';
import { clearPendingReviewSyncBlock, loadPendingReview, savePendingReview, type PendingReview } from './pendingReview';
import type { DiagnosticsReport } from './diagnostics';

type CommandParams = Record<string, unknown>;

export type DeviceCommandRow = {
  id: string;
  command: string;
  params: CommandParams | null;
};

async function myDeviceInfo(): Promise<{ id: string; name: string } | null> {
  if (typeof window === 'undefined' || !window.vaults) return null;
  return window.vaults.deviceInfo();
}

async function myAppVersion(): Promise<string | null> {
  if (Platform.OS === 'android') {
    const constants = Platform.constants as { appVersion?: string };
    if (typeof constants.appVersion === 'string' && constants.appVersion) return constants.appVersion;
  }
  try {
    if (typeof window === 'undefined') return null;
    const updater = (window as unknown as { updater?: { getVersion?: () => Promise<string> } }).updater;
    const version = await updater?.getVersion?.();
    return typeof version === 'string' && version ? version : null;
  } catch {
    return null;
  }
}

//////// 1. 📥 LA BOUCLE D'EXÉCUTION ///////////

export async function processDeviceCommands(remoteVaultId: string, ownerId: string): Promise<void> {
  try {
    if (!supabase) return;
    const info = await myDeviceInfo();
    if (!info) return;
    const { data, error } = await supabase
      .schema(APP_SCHEMA)
      .from(DEVICE_COMMANDS_TABLE)
      .select('*')
      .eq('vault_id', remoteVaultId)
      .eq('device_id', info.id)
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(10);
    if (error) {
      // Migration non appliquée : silencieux (une seule trace console).
      if (!/column|relation|PGRST20[45]|schema/i.test(error.message ?? '')) {
        console.error('[gateway] lecture des commandes :', error.message);
      }
      return;
    }
    for (const row of data ?? []) {
      const command = String(row.command ?? '');
      const params = (row.params ?? {}) as CommandParams;
      let status = 'done';
      let result = '';
      try {
        result = await executeCommand(String(remoteVaultId), info, command, params);
      } catch (commandError) {
        status = 'error';
        result = errorMessage(commandError);
      }
      const { error: updateError } = await supabase
        .schema(APP_SCHEMA)
        .from(DEVICE_COMMANDS_TABLE)
        .update({ status, result: result.slice(0, 60_000), completed_at: new Date().toISOString() })
        .eq('id', row.id);
      if (updateError) console.error('[gateway] résultat non publié :', updateError.message);
    }
  } catch (error) {
    // La passerelle ne doit JAMAIS faire échouer un cycle.
    console.error('[gateway] processDeviceCommands ignoré :', errorMessage(error));
  }
}

// v0.4.76 — RAPPORT DE DIAGNOSTIC LOCAL : assemblé depuis les ponts de la
// fenêtre — réutilisé par la passerelle (dump-diagnostics) ET par le bouton
// « copier le diagnostic » de l'UI.
export async function buildLocalDiagnostics(): Promise<DiagnosticsReport> {
  const collectionErrors: string[] = [];
  const vaultBridge = typeof window !== 'undefined' ? window.vault : undefined;
  const pendingReview = vaultBridge
    ? await loadPendingReview(vaultBridge).catch(() => ({}) as PendingReview)
    : ({} as PendingReview);
  let journalTail: DiagnosticsReport['journalTail'] = [];
  if (vaultBridge) {
    try {
      const parsed = JSON.parse(await vaultBridge.readNote(SYNC_JOURNAL_READ_PATH)) as {
        entries?: DiagnosticsReport['journalTail'];
      };
      journalTail = (parsed.entries ?? []).slice(-40);
    } catch {
      collectionErrors.push('journal illisible ou absent');
    }
  } else {
    collectionErrors.push('pont vault absent');
  }
  let syncStateFileCount: number | null = null;
  if (vaultBridge) {
    try {
      const state = JSON.parse(await vaultBridge.readNote('.123ecriture/sync-state.json')) as {
        files?: Record<string, string>;
      };
      syncStateFileCount = Object.keys(state.files ?? {}).length;
    } catch {
      collectionErrors.push('sync-state illisible ou absent');
    }
  }
  const vaultsList = typeof window !== 'undefined' && window.vaults ? await window.vaults.list() : [];
  const device = typeof window !== 'undefined' && window.vaults ? await window.vaults.deviceInfo() : { id: '?', name: '?' };
  const activeVaultPath = vaultBridge ? await vaultBridge.getCurrentPath().catch(() => null) : null;
  return {
    at: new Date().toISOString(),
    platform: Platform.OS,
    device: { id: device.id, name: device.name, appVersion: await myAppVersion() },
    activeVaultPath,
    vaults: vaultsList.map((v) => ({
      name: v.name,
      path: v.path,
      cloudLinked: Boolean(v.cloudLinked),
      remoteVaultId: v.remoteVaultId ?? null,
    })),
    syncStateFileCount,
    pendingReview,
    journalTail,
    collectionErrors,
  };
}

// Marque/démarque des lignes distantes (revue : « Supprimer vraiment » pose
// les tombstones, « Restaurer » les lève — le diff fait le reste au cycle
// suivant).
export async function setRemoteRowsDeleted(
  remoteVaultId: string,
  relPaths: string[],
  deleted: boolean,
): Promise<void> {
  if (!supabase) throw new Error('Non connecté au cloud.');
  for (let i = 0; i < relPaths.length; i += 100) {
    const chunk = relPaths.slice(i, i + 100);
    const { error } = await supabase
      .schema(APP_SCHEMA)
      .from(VAULT_FILES_TABLE)
      .update({ deleted, updated_at: new Date().toISOString() })
      .eq('vault_id', remoteVaultId)
      .in('rel_path', chunk);
    if (error) throw error;
  }
}

//////// 2. 🛠️ EXÉCUTION UNITAIRE ///////////

async function executeCommand(
  remoteVaultId: string,
  device: { id: string; name: string },
  command: string,
  params: CommandParams,
): Promise<string> {
  const { vault } = requireBridges();
  switch (command) {
    case 'dump-diagnostics': {
      const report = await buildLocalDiagnostics();
      return JSON.stringify(report, null, 2).slice(0, 30_000);
    }
    case 'clear-sync-block':
      await clearPendingReviewSyncBlock(vault);
      return 'disjoncteur levé';
    case 'lock-sync': {
      const review = await loadPendingReview(vault).catch(() => ({}) as PendingReview);
      const next: PendingReview = {
        ...review,
        syncBlocked: {
          at: new Date().toISOString(),
          errorCount: 0,
          samples: [String(params.reason ?? 'Verrou posé à distance (lock-sync)')],
        },
      };
      await savePendingReview(vault, next);
      return 'bloc local posé';
    }
    case 'unlock-sync':
      await clearPendingReviewSyncBlock(vault);
      return 'bloc local levé';
    default:
      throw new Error(`Commande inconnue : ${command}`);
  }
}

// requireBridges vit dans syncEngine — ici, résolution locale minimale pour
// ne pas créer de cycle d'import : le pont vault suffit (readNote/writeNote
// de la file de revue et du journal).
function requireBridges(): { vault: VaultBridge } {
  if (typeof window === 'undefined' || !window.vault) {
    throw new Error('Pont vault absent — la passerelle ne fonctionne que dans l\'app.');
  }
  return { vault: window.vault };
}

//////// 3. 📤 POSE D'UNE COMMANDE (pour l'UI « Appareils connectés ») ///////////

export async function queueDeviceCommand(
  ownerId: string,
  remoteVaultId: string,
  deviceId: string,
  command: string,
  params?: CommandParams,
): Promise<void> {
  if (!supabase) throw new Error('Non connecté au cloud.');
  const { error } = await supabase
    .schema(APP_SCHEMA)
    .from(DEVICE_COMMANDS_TABLE)
    .insert({ owner_id: ownerId, vault_id: remoteVaultId, device_id: deviceId, command, params: params ?? {} });
  if (error) throw error;
}
