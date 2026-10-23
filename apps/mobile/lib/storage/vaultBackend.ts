import { Platform } from "react-native";

import { createDefaultCloudVault } from "./cloud/cloudVaultAdapter";
import type { CloudSyncHandle } from "./cloud/cloudVaultCore";
import {
  ensureVaultIndexed as legacyEnsureIndexed,
  getVaultIndexEntry as legacyGetEntry,
  getVaultIndexKeys as legacyGetKeys,
  nativeVaultAdapter,
} from "./nativeVaultAdapter";

// ✒️ 123ECRITURE — lib/storage/vaultBackend.ts — choix du point d'accès fichiers
// v0.4.96 — ANDROID = 100 % CLOUD. Le coffre actif est lu/écrit dans
// Supabase (vault_files + Storage), avec un cache privé de l'app
// (cloud/cloudVaultAdapter.ts). Plus aucun accès SAF / content:// /
// module vault-fs pour les données. Les anciens dossiers SAF du
// téléphone ne sont JAMAIS touchés (l'import unique, cloud/legacyImport.ts,
// les lit sans y écrire).
//
// Hors Android (web de dev Expo), on garde l'ancien pont (inchangé).

export function isAndroidCloudOnly(os: string = Platform.OS): boolean {
  return os === "android";
}

const cloud = isAndroidCloudOnly() ? createDefaultCloudVault() : null;

export const vaultBackendName: "cloud" | "saf-legacy" = cloud ? "cloud" : "saf-legacy";

export const activeVaultAdapter: VaultBridge = cloud
  ? { ...cloud.adapter, cloudSync: cloud.cloudSync }
  : nativeVaultAdapter;

export const cloudSyncHandle: CloudSyncHandle | null = cloud ? cloud.cloudSync : null;

export const ensureActiveVaultIndexed: () => Promise<void> = cloud
  ? async () => undefined
  : legacyEnsureIndexed;
export const getActiveVaultIndexKeys: () => string[] = cloud ? () => [] : legacyGetKeys;
export const getActiveVaultIndexEntry: (
  relPath: string,
) => { isDirectory: boolean } | undefined = cloud ? () => undefined : legacyGetEntry;
