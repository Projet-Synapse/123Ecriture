// ✒️ 123ECRITURE — lib/sync/diagnosticExport.ts — l'export des états privés
//////////////////////////////////////////////////////////////////////////////
//
// §16 de l'objectif de synchronisation : « lire les états privés de l'app
// mobile ». Ces états (registre des coffres, index SAF, session, sync-state,
// revue) vivent dans le stockage privé Android — invisibles depuis le câble.
// L'export les assemble dans `.123ecriture/diagnostic-export.json` DANS le
// coffre : lisible par adb et par le PC, jamais synchronisé (hors liste
// blanche de syncRules.ts).
//
// Invariants du fichier :
//   • AUCUN jeton d'authentification n'est exporté — la session est
//     masquée (identifiant, courriel, expiration seulement).
//   • L'export est best-effort : chaque état illisible devient une note
//     d'erreur dans le rapport, jamais un échec d'ensemble.
//
// SOMMAIRE :
//   1. Le masquage de session
//   2. La construction du rapport
//   3. L'écriture dans le coffre
//
//////////////////////////////////////////////////////////////////////////////

import * as FileSystem from 'expo-file-system/legacy';
import { vaultStorageObjectKey } from './storageKeys';
import { getActiveVaultRootUri } from '../storage/nativeVaultsAdapter';

//////// 1. Le masquage de session /////////////////////////////////////////

type SessionBrute = {
  user?: { id?: string; email?: string };
  expires_at?: number;
} | null;

// La session est exportée SANS jetons : identifiant, courriel et
// expiration suffisent au diagnostic (« l'app est-elle connectée ? quand
// la session expire-t-elle ? »).
export function masqueSession(session: SessionBrute): Record<string, unknown> | null {
  if (!session?.user) return null;
  return {
    user_id: session.user.id ?? null,
    email: session.user.email ?? null,
    expire_le: session.expires_at ?? null,
  };
}

//////// 2. La construction du rapport /////////////////////////////////////

export async function construireDiagnostic(): Promise<Record<string, unknown>> {
  const rootUri = await getActiveVaultRootUri().catch(() => null);

  // Le registre des coffres (les chemins SAF : pas secrets).
  let registre: unknown = null;
  try {
    const { readRegistry } = await import('../storage/nativeVaultRegistry');
    registre = await readRegistry();
  } catch (error) {
    registre = { erreur: String((error as Error)?.message ?? error) };
  }

  // L'index SAF persisté (documentDirectory, hors coffre).
  let index: unknown = null;
  if (rootUri) {
    try {
      const raw = await FileSystem.readAsStringAsync(
        `${FileSystem.documentDirectory}vault-index-${vaultStorageObjectKey(rootUri)}.json`,
      );
      index = JSON.parse(raw);
    } catch {
      index = { erreur: 'index absent ou illisible' };
    }
  }

  // Les états du coffre : journal, sync-state, revue.
  const { requireBridges } = await import('./bridges');
  const lire = async (relPath: string): Promise<unknown> => {
    try {
      return JSON.parse(await requireBridges().vault.readNote(relPath));
    } catch {
      return null;
    }
  };
  const [journal, syncState, revue] = await Promise.all([
    lire('.123ecriture/sync-journal.json'),
    lire('.123ecriture/sync-state.json'),
    lire('.123ecriture/pending-review.json'),
  ]);

  // La session (masquée) : connecté ? jusqu'à quand ?
  let session: unknown = { erreur: 'session illisible' };
  try {
    const { supabase } = await import('./supabaseClient');
    if (!supabase) throw new Error('Client Supabase non configuré');
    const s = await supabase.auth.getSession();
    session = masqueSession(s.data.session as SessionBrute);
  } catch (error) {
    session = { erreur: String((error as Error)?.message ?? error) };
  }

  // L'appareil et la version.
  let appareil: unknown = null;
  let versionApp: string | null = null;
  try {
    const { vaults } = requireBridges();
    appareil = await vaults.deviceInfo();
  } catch (error) {
    appareil = { erreur: String((error as Error)?.message ?? error) };
  }
  try {
    const { installedAppVersion } = await import('../updaterAndroid');
    versionApp = installedAppVersion();
  } catch {
    versionApp = null;
  }

  const journalObj = journal as { entries?: unknown[] } | null;
  return {
    exporte_le: new Date().toISOString(),
    version_app: versionApp,
    appareil,
    coffre_actif: { rootUri },
    registre_des_coffres: registre,
    index_coffre: index,
    session,
    journal_dernieres_entrees: (journalObj?.entries as unknown[] | undefined)?.slice(-30) ?? null,
    sync_state: syncState,
    revue_en_attente: revue,
  };
}

//////// 3. L'écriture dans le coffre //////////////////////////////////////

// Écrit le rapport dans le coffre (hors liste blanche de synchronisation) :
// lisible par le câble (adb) et par le PC, jamais envoyé au cloud.
export async function exporterDiagnosticDansCoffre(): Promise<string> {
  const données = await construireDiagnostic();
  const { requireBridges } = await import('./bridges');
  await requireBridges().vault.writeNote(
    '.123ecriture/diagnostic-export.json',
    JSON.stringify(données, null, 2),
  );
  return '.123ecriture/diagnostic-export.json';
}
