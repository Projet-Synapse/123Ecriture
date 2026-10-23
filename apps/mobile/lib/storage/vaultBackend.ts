import { Platform } from "react-native";

import { VaultFs } from "../../modules/vault-fs/src";
import {
  ensureVaultIndexed as legacyEnsureIndexed,
  getVaultIndexEntry as legacyGetEntry,
  getVaultIndexKeys as legacyGetKeys,
  nativeVaultAdapter,
} from "./nativeVaultAdapter";
import { createDefaultVaultFsAdapter } from "./nativeVaultFsAdapter";

// ✒️ 123ECRITURE — lib/storage/vaultBackend.ts — choix du point d'accès fichiers Android
// Module natif VaultFs (modules/vault-fs, embarqué dans l'APK) par DÉFAUT sur
// Android dès qu'il est présent ; repli sur l'ancien pont SAF expo-file-system
// sinon (APK plus ancien) ou si EXPO_PUBLIC_VAULT_FS=0 (interrupteur de secours).

export function shouldUseVaultFs(
  os: string = Platform.OS,
  moduleAvailable: boolean = VaultFs !== null && VaultFs !== undefined,
  flag: string | undefined = process.env.EXPO_PUBLIC_VAULT_FS,
): boolean {
  return (
    os === "android" && moduleAvailable && flag !== "0" && flag !== "false"
  );
}

const native =
  shouldUseVaultFs() && VaultFs ? createDefaultVaultFsAdapter(VaultFs) : null;

export const vaultBackendName: "vault-fs" | "saf-legacy" = native
  ? "vault-fs"
  : "saf-legacy";
export const activeVaultAdapter: VaultBridge = native
  ? native.adapter
  : nativeVaultAdapter;
export const ensureActiveVaultIndexed: () => Promise<void> = native
  ? native.ensureIndexed
  : legacyEnsureIndexed;
export const getActiveVaultIndexKeys: () => string[] = native
  ? native.getIndexKeys
  : legacyGetKeys;
export const getActiveVaultIndexEntry: (
  relPath: string,
) => { isDirectory: boolean } | undefined = native
  ? native.getIndexEntry
  : legacyGetEntry;
