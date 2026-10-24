// ✒️ 123ECRITURE — lib/sync/deviceGateway.ts — passerelle à distance (commandes cloud adressées à cet appareil)
//////////////////////////////////////////////////////////////////////////////
//
// Exécution des commandes adressées à CET appareil via le cloud — les yeux
// et les mains, passerelle alternative au câble USB et au débogage sans
// fil. À chaque cycle de synchro, l'appareil traite les commandes `pending`
// de la table app_123ecriture.device_commands qui lui sont adressées, et
// publie le résultat (audit conservé dans la table). Le canal est Supabase,
// déjà authentifié (RLS owner) — aucun câble, aucun débogage sans fil.
//
// Invariants du fichier :
//   • La passerelle ne doit JAMAIS faire échouer un cycle de synchro :
//     tout échec est attrapé, tracé en console, et le cycle continue.
//   • LIMITATION HONNÊTE : les commandes s'exécutent quand l'app tourne un
//     cycle (app ouverte ou réveillée) — aucun réveil à distance.
//   • Aucun import de syncEngine : le chemin du journal et la résolution
//     des ponts sont repris localement, car syncEngine importe cette
//     passerelle (un cycle d'import casserait le bundle).
//
// Commandes v1 :
//   - dump-diagnostics  → rapport complet (diagnostics.ts) en résultat
//   - clear-sync-block  → réactive la synchronisation (ancien disjoncteur supprimé)
//   - lock-sync         → pose le bloc local (motif dans params.reason)
//   - unlock-sync       → lève le bloc local
//
// SOMMAIRE :
//   1. La boucle d'exécution (processDeviceCommands, buildLocalDiagnostics, setRemoteRowsDeleted)
//   2. Exécution unitaire (executeCommand)
//   3. Pose d'une commande (queueDeviceCommand, pour l'UI « Appareils connectés »)
//
//////////////////////////////////////////////////////////////////////////////

//////// 1. La boucle d'exécution (processDeviceCommands, buildLocalDiagnostics, setRemoteRowsDeleted) ///////////

import { loadPendingReview, type PendingReview } from './pendingReview';
import { Platform } from 'react-native';

import { APP_SCHEMA, DEVICE_COMMANDS_TABLE, VAULT_FILES_TABLE, supabase } from './supabaseClient';
import { errorMessage } from '../errorMessage';
import type { DiagnosticsReport } from './diagnostics';
// Le chemin du journal est défini dans syncEngine (repris ici sans
// import pour éviter un cycle : syncEngine importe cette passerelle).
const SYNC_JOURNAL_READ_PATH = '.123ecriture/sync-journal.json';

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

// Exportée : version installée sur TOUTES les plateformes (Android :
// constantes natives ; desktop : updater.getVersion) — utilisée aussi par
// le journal publié (sync_journals.app_version).
export async function myAppVersion(): Promise<string | null> {
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

// RAPPORT DE DIAGNOSTIC LOCAL : assemblé depuis les ponts de la fenêtre —
// réutilisé par la passerelle (dump-diagnostics) ET par le bouton
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

//////// 2. Exécution unitaire (executeCommand) ///////////

async function executeCommand(
  remoteVaultId: string,
  device: { id: string; name: string },
  command: string,
  params: CommandParams,
): Promise<string> {
  requireBridges();
  switch (command) {
    case 'dump-diagnostics': {
      const report = await buildLocalDiagnostics();
      return JSON.stringify(report, null, 2).slice(0, 30_000);
    }
    case 'export-diagnostics': {
      // §16 : l'export des états privés dans le coffre
      // (.123ecriture/diagnostic-export.json) — lisible par le câble ou le
      // PC sans passer par le résultat de commande.
      const { exporterDiagnosticDansCoffre } = await import('./diagnosticExport');
      const chemin = await exporterDiagnosticDansCoffre();
      return 'diagnostic exporté : ' + chemin;
    }
    case 'export-index': {
      // Inventaire local (fichiers + dossiers) : .123ecriture/devices/<id>.json
      // + table vault_device_inventories.
      const { publishDeviceInventory } = await import('./deviceInventory');
      return 'inventaire exporté : ' + (await publishDeviceInventory(remoteVaultId));
    }
    // Ancien disjoncteur supprimé : ces commandes pilotent désormais
    // l'interrupteur « Synchronisation activée » des paramètres.
    case 'lock-sync': {
      const { loadSyncSettings, saveSyncSettings } = await import('./syncSettings');
      saveSyncSettings({ ...loadSyncSettings(), enabled: false });
      return 'synchronisation désactivée sur cet appareil';
    }
    case 'clear-sync-block':
    case 'unlock-sync': {
      const { loadSyncSettings, saveSyncSettings } = await import('./syncSettings');
      saveSyncSettings({ ...loadSyncSettings(), enabled: true });
      return 'synchronisation réactivée sur cet appareil';
    }
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

//////// 3. Pose d'une commande (queueDeviceCommand, pour l'UI « Appareils connectés ») ///////////

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
