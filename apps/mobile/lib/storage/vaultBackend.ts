import { Platform } from "react-native";

import { VaultFs } from "../../modules/vault-fs/src";
import type { CloudSyncHandle } from "./cloud/cloudVaultCore";
import {
  ensureVaultIndexed as legacyEnsureIndexed,
  getVaultIndexEntry as legacyGetEntry,
  getVaultIndexKeys as legacyGetKeys,
  nativeVaultAdapter,
} from "./nativeVaultAdapter";
import { createDefaultVaultFsAdapter } from "./nativeVaultFsAdapter";

// ✒️ 123ECRITURE — lib/storage/vaultBackend.ts — choix du point d'accès fichiers Android
// v0.4.96-test.3 — RETOUR AU COFFRE LOCAL (local-first, comme le PC).
// Le coffre Android est un dossier du téléphone lu/écrit par le module natif
// VaultFs (modules/vault-fs, #197 : DocumentsContract + permission d'arbre
// PERSISTANTE). Le cloud n'est qu'une copie synchronisée par le moteur
// trois états. Si la permission est perdue : index en cache (lecture seule),
// demande de re-sélection, et AUCUNE suppression (VaultPermissionLostError).
// Repli sur l'ancien pont SAF expo-file-system si le module est absent ou si
// EXPO_PUBLIC_VAULT_FS=0.

export function shouldUseVaultFs(
  os: string = Platform.OS,
  moduleAvailable: boolean = VaultFs !== null && VaultFs !== undefined,
  flag: string | undefined = process.env.EXPO_PUBLIC_VAULT_FS,
): boolean {
  return os === "android" && moduleAvailable && flag !== "0" && flag !== "false";
}

// Le mode « Android 100 % cloud » (#201) est abandonné.
export function isAndroidCloudOnly(_os: string = Platform.OS): boolean {
  return false;
}

const native = shouldUseVaultFs() && VaultFs ? createDefaultVaultFsAdapter(VaultFs) : null;

export const vaultBackendName: "vault-fs" | "saf-legacy" = native ? "vault-fs" : "saf-legacy";
export const activeVaultAdapter: VaultBridge = native ? native.adapter : nativeVaultAdapter;
// Conservé pour compatibilité (import cloud) : toujours null désormais.
export const cloudSyncHandle: CloudSyncHandle | null = null;
export const hashActiveVaultFile: ((relPath: string) => Promise<{ hash: string; size: number }>) | null = native
  ? native.hashFile
  : null;
export const isActiveVaultFullyIndexed: () => boolean = native ? native.isFullyIndexed : () => true;
export const ensureActiveVaultIndexed: () => Promise<void> = native ? native.ensureIndexed : legacyEnsureIndexed;
export const getActiveVaultIndexKeys: () => string[] = native ? native.getIndexKeys : legacyGetKeys;
export const getActiveVaultIndexEntry: (relPath: string) => { isDirectory: boolean } | undefined = native
  ? native.getIndexEntry
  : legacyGetEntry;
// Avant un cycle de synchro : lève une erreur si l'accès au dossier est perdu.
export const assertActiveVaultAccess: () => Promise<void> = native ? native.assertAccess : async () => undefined;
export const isActiveVaultPermissionLost: () => boolean = native ? native.isPermissionLost : () => false;
