import { requireOptionalNativeModule } from "expo";

// ✒️ 123ECRITURE — modules/vault-fs — API TypeScript du module natif VaultFs (Android)
// Module LOCAL embarqué dans l'APK de l'app (autolinking Expo : dossier modules/).
// Toutes les fonctions prennent l'URI d'ARBRE SAF du coffre (content://…/tree/…)
// et un relPath POSIX ; aucune URI file:// n'est jamais acceptée ni renvoyée.

export type VaultFsEncoding = "utf8" | "base64";

export type VaultFsTreeEntry = {
  relPath: string;
  docId: string;
  isDirectory: boolean;
  mtime: number;
  size: number;
};
export type VaultFsTreeError = { relPath: string; message: string };
export type VaultFsTree = {
  entries: VaultFsTreeEntry[];
  errors: VaultFsTreeError[];
};
export type VaultFsStat = {
  docId: string;
  name: string;
  isDirectory: boolean;
  mtime: number;
  size: number;
};
export type VaultFsReadResult = {
  content: string;
  size: number;
  sha256: string;
  mtime: number;
  docId: string;
};
export type VaultFsWriteResult = {
  relPath: string;
  docId: string;
  size: number;
  sha256: string;
  method: "rename" | "direct";
};

export interface VaultFsNativeModule {
  hasPermission(treeUri: string): Promise<boolean>;
  takePersistablePermission(treeUri: string): Promise<boolean>;
  listTree(treeUri: string): Promise<VaultFsTree>;
  stat(treeUri: string, relPath: string): Promise<VaultFsStat | null>;
  readFile(
    treeUri: string,
    relPath: string,
    encoding: VaultFsEncoding,
  ): Promise<VaultFsReadResult>;
  writeFileAtomic(
    treeUri: string,
    relPath: string,
    content: string,
    encoding: VaultFsEncoding,
  ): Promise<VaultFsWriteResult>;
  mkdirs(treeUri: string, relPath: string): Promise<string>;
  deleteFile(
    treeUri: string,
    relPath: string,
    permanent: boolean,
  ): Promise<{ trashRelPath: string | null }>;
  rename(treeUri: string, relPath: string, newName: string): Promise<string>;
  move(
    treeUri: string,
    relPath: string,
    destParentRelPath: string,
  ): Promise<string>;
}

// null hors Android ou si l'APK installé ne contient pas encore le module.
export const VaultFs: VaultFsNativeModule | null =
  requireOptionalNativeModule<VaultFsNativeModule>("VaultFs");
