import { Alert } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";

import { parseFrontmatter } from "../properties/frontmatter";
import {
  getActiveVaultRootUri,
  requestAndRegisterVault,
} from "./nativeVaultsAdapter";
import {
  baseNameOf,
  buildTreeFromIndex,
  defaultContentForKind,
  EXTENSION_FOR_KIND,
  extensionKind,
  findAvailableName,
  KNOWN_CONTENT_EXTS,
  markVaultFileDirty,
  readLegacyJsonArrayFile,
  readLegacyStringFile,
  TAG_PATTERN,
} from "./nativeVaultAdapter";
import type {
  VaultFsNativeModule,
  VaultFsTreeEntry,
} from "../../modules/vault-fs/src";

// ✒️ 123ECRITURE — lib/storage/nativeVaultFsAdapter.ts — le coffre Android via le module natif VaultFs
//////////////////////////////////////////////////////////////////////////////
//
// Même contrat VaultBridge que nativeVaultAdapter.ts (ancien pont SAF
// expo-file-system), mais CHAQUE accès fichier passe par le module Kotlin
// modules/vault-fs (DocumentsContract + URI d'arbre persistante) :
//   • l'index ne contient que des relPath POSIX → docId (jamais d'URI file://) ;
//   • listTree = parcours natif batch, hors thread UI ; un dossier illisible
//     est « inconnu » : ses anciennes entrées d'index sont CONSERVÉES (rien ne
//     paraît supprimé, donc aucune tombstone ne part) ;
//   • writeNote/writeNoteBinary ne résolvent qu'après une écriture atomique
//     relue et vérifiée (taille + SHA-256) — sinon la promesse est rejetée et
//     le moteur de synchro ne marque PAS le fichier synchronisé ;
//   • supprimer = déplacer dans `.trash/` du coffre (confirmation sauf silent).
//
//////////////////////////////////////////////////////////////////////////////

export type VaultFsIndexEntry = {
  uri: string;
  isDirectory: boolean;
  size?: number;
  mtime?: number;
};

export type VaultFsAdapterDeps = {
  fs: VaultFsNativeModule;
  getRootUri: () => Promise<string | null>;
  markDirty: (relPath: string) => void;
  confirm: (title: string, message: string) => Promise<boolean>;
  // Cache d'index PERSISTÉ (hors du coffre) : l'UI reste lisible même si
  // l'accès au dossier est perdu (permission SAF révoquée, carte retirée…).
  loadIndexCache?: (rootUri: string) => Promise<[string, VaultFsIndexEntry][] | null>;
  saveIndexCache?: (rootUri: string, entries: [string, VaultFsIndexEntry][]) => Promise<void>;
  onPermissionLost?: (rootUri: string) => void;
};

// Accès au dossier du coffre PERDU : jamais interprété comme « coffre vide »
// (aucune suppression, aucune tombstone) — l'utilisateur doit re-sélectionner.
export class VaultPermissionLostError extends Error {
  constructor() {
    super("Accès au dossier du coffre perdu : re-sélectionne le dossier (Réglages → Coffres). Rien n'a été supprimé.");
    this.name = "VaultPermissionLostError";
  }
}

// Fichiers temporaires de writeFileAtomic (VaultFsCore.kt) : jamais indexés.
const TEMP_PREFIX = ".vfs-";

function isMetaRelPath(relPath: string): boolean {
  return (
    relPath === ".123ecriture" ||
    relPath.startsWith(".123ecriture/") ||
    relPath === ".trash" ||
    relPath.startsWith(".trash/")
  );
}

function keepInIndex(relPath: string): boolean {
  const segments = relPath.split("/");
  if (segments.some((s) => s.startsWith(TEMP_PREFIX))) return false;
  if (isMetaRelPath(relPath)) return true;
  return !segments.some((s) => s.startsWith(".")); // cachés masqués, comme le desktop
}

function parentOf(relPath: string): string {
  const i = relPath.lastIndexOf("/");
  return i >= 0 ? relPath.slice(0, i) : "";
}

function nameOf(relPath: string): string {
  return relPath.slice(relPath.lastIndexOf("/") + 1);
}

function join(parent: string | undefined, name: string): string {
  return parent ? `${parent}/${name}` : name;
}

export function normalizeRelPath(relPath: string): string {
  return relPath
    .replace(/\\/g, "/")
    .split("/")
    .filter((s) => s && s !== ".")
    .join("/")
    .normalize("NFC");
}

export function createVaultFsAdapter(deps: VaultFsAdapterDeps) {
  const { fs } = deps;
  let index = new Map<string, VaultFsIndexEntry>();
  let indexedRoot: string | null = null;
  let lastErrors: { relPath: string; message: string }[] = [];
  let cachedTree: VaultTreeNode[] | null = null;
  let permissionLost = false;
  // Index COMPLET (parcours natif ou cache chargé) ? read()/write() ajoutent
  // des entrées isolées à l'index : sa taille ne prouve PAS qu'il est complet.
  let fullyIndexed = false;

  async function root(): Promise<string> {
    const uri = await deps.getRootUri();
    if (!uri) throw new Error("Aucun coffre sélectionné.");
    if (uri !== indexedRoot) {
      index = new Map();
      indexedRoot = uri;
      cachedTree = null;
      fullyIndexed = false;
    }
    return uri;
  }

  async function refresh(): Promise<void> {
    const treeUri = await root();
    let allowed = true;
    try {
      allowed = await fs.hasPermission(treeUri);
    } catch {
      allowed = false;
    }
    if (!allowed) {
      // On GARDE l'index connu (cache) : lecture seule, rien ne paraît supprimé.
      if (!permissionLost) deps.onPermissionLost?.(treeUri);
      permissionLost = true;
      throw new VaultPermissionLostError();
    }
    permissionLost = false;
    const { entries, errors } = await fs.listTree(treeUri);
    const next = new Map<string, VaultFsIndexEntry>();
    for (const e of entries as VaultFsTreeEntry[]) {
      const relPath = normalizeRelPath(e.relPath);
      if (!keepInIndex(relPath)) continue;
      next.set(relPath, {
        uri: e.docId,
        isDirectory: e.isDirectory,
        size: e.size,
        mtime: e.mtime,
      });
    }
    // Dossier illisible = contenu INCONNU : on garde ce que l'on savait dessous.
    for (const err of errors) {
      const prefix = err.relPath ? `${normalizeRelPath(err.relPath)}/` : "";
      for (const [relPath, entry] of index) {
        if (relPath.startsWith(prefix) && !next.has(relPath))
          next.set(relPath, entry);
      }
    }
    index = next;
    fullyIndexed = true;
    lastErrors = errors;
    cachedTree = null;
    await deps.saveIndexCache?.(treeUri, [...index.entries()]).catch(() => undefined);
  }

  function invalidate(): void {
    cachedTree = null;
  }

  function siblings(parent: string): Set<string> {
    const out = new Set<string>();
    const prefix = parent ? `${parent}/` : "";
    for (const relPath of index.keys()) {
      if (!relPath.startsWith(prefix)) continue;
      const rest = relPath.slice(prefix.length);
      if (rest && !rest.includes("/")) out.add(rest);
    }
    return out;
  }

  async function write(
    relPathRaw: string,
    content: string,
    encoding: "utf8" | "base64",
  ): Promise<void> {
    const relPath = normalizeRelPath(relPathRaw);
    const treeUri = await root();
    const known = index.get(relPath);
    if (known?.isDirectory)
      throw new Error(`« ${relPath} » est un dossier, pas une note.`);
    // Rejette si la relecture ne correspond pas : AUCUN « succès » non vérifié.
    const res = await fs.writeFileAtomic(treeUri, relPath, content, encoding);
    let acc = "";
    for (const seg of parentOf(relPath).split("/").filter(Boolean)) {
      acc = join(acc, seg);
      if (!index.has(acc)) index.set(acc, { uri: "", isDirectory: true });
    }
    index.set(relPath, {
      uri: res.docId,
      isDirectory: false,
      size: res.size,
      mtime: Date.now(),
    });
    if (!relPath.startsWith(".123ecriture/")) invalidate();
    deps.markDirty(relPath);
  }

  async function read(
    relPathRaw: string,
    encoding: "utf8" | "base64",
  ): Promise<string> {
    const relPath = normalizeRelPath(relPathRaw);
    const treeUri = await root();
    const res = await fs.readFile(treeUri, relPath, encoding);
    if (!index.has(relPath))
      index.set(relPath, {
        uri: res.docId,
        isDirectory: false,
        size: res.size,
        mtime: res.mtime,
      });
    return res.content;
  }

  function removeSubtree(relPath: string): string[] {
    const removed: string[] = [];
    for (const key of [...index.keys()]) {
      if (key === relPath || key.startsWith(`${relPath}/`)) {
        if (!index.get(key)?.isDirectory) removed.push(key);
        index.delete(key);
      }
    }
    return removed;
  }

  async function relocate(from: string, to: string): Promise<void> {
    const moved = removeSubtree(from);
    for (const old of moved) deps.markDirty(old);
    await refresh(); // docIds changent au déplacement (ExternalStorageProvider) : on relit
    for (const old of moved) deps.markDirty(to + old.slice(from.length));
  }

  type State = {
    lastOpenedRelPath?: string | null;
    collapsedRelPaths?: string[];
    openTabRelPaths?: string[];
  };
  async function readState(): Promise<State> {
    try {
      const parsed: unknown = JSON.parse(
        await read(".123ecriture/state.json", "utf8"),
      );
      return parsed && typeof parsed === "object" ? (parsed as State) : {};
    } catch {
      return {};
    }
  }
  async function patchState(patch: State): Promise<void> {
    await write(
      ".123ecriture/state.json",
      JSON.stringify({ ...(await readState()), ...patch }, null, 2),
      "utf8",
    );
  }

  const adapter: VaultBridge = {
    rescan: async () => {
      await refresh();
    },
    chooseFolder: async () => {
      const uri = await deps.getRootUri();
      if (uri) return uri;
      const liste = await requestAndRegisterVault("Nouveau coffre");
      return liste.length > 0 ? liste[liste.length - 1].path : null;
    },
    getCurrentPath: () => deps.getRootUri(),
    listTree: async () => {
      await root();
      if (cachedTree) return cachedTree;
      if (index.size === 0) await refresh();
      cachedTree = buildTreeFromIndex(index);
      return cachedTree;
    },
    readNote: (relPath) => read(relPath, "utf8"),
    writeNote: (relPath, content) => write(relPath, content, "utf8"),
    readNoteBinary: (relPath) => read(relPath, "base64"),
    writeNoteBinary: (relPath, base64) => write(relPath, base64, "base64"),

    createNote: async (name, parentRelPath, kind = "markdown") => {
      const parent = normalizeRelPath(parentRelPath ?? "");
      const ext = EXTENSION_FOR_KIND[kind];
      const base = KNOWN_CONTENT_EXTS.some((k) =>
        name.toLowerCase().endsWith(k),
      )
        ? name
        : `${name}${ext}`;
      const finalName = findAvailableName(base, siblings(parent));
      const finalExt =
        KNOWN_CONTENT_EXTS.find((k) => finalName.toLowerCase().endsWith(k)) ??
        ext;
      const relPath = join(parent, finalName);
      await write(
        relPath,
        defaultContentForKind(
          kind,
          finalName.slice(0, finalName.length - finalExt.length),
        ),
        "utf8",
      );
      return {
        relPath,
        name: baseNameOf(finalName),
        modifiedAt: Date.now(),
        kind,
      };
    },

    createFolder: async (name, parentRelPath) => {
      const parent = normalizeRelPath(parentRelPath ?? "");
      const finalName = findAvailableName(name, siblings(parent));
      const relPath = join(parent, finalName);
      const docId = await fs.mkdirs(await root(), relPath);
      index.set(relPath, { uri: docId, isDirectory: true });
      invalidate();
      return { relPath, name: finalName };
    },

    // Renommer/déplacer : opérations NATIVES (renameDocument/moveDocument),
    // dossiers compris — plus de copie + suppression côté JS.
    rename: async (relPathRaw, newName) => {
      const relPath = normalizeRelPath(relPathRaw);
      const entry = index.get(relPath);
      const name = nameOf(relPath);
      const parent = parentOf(relPath);
      const hadExt = entry?.isDirectory
        ? undefined
        : KNOWN_CONTENT_EXTS.find((k) => name.toLowerCase().endsWith(k));
      const carries = KNOWN_CONTENT_EXTS.some((k) =>
        newName.toLowerCase().endsWith(k),
      );
      const candidate = hadExt && !carries ? `${newName}${hadExt}` : newName;
      if (candidate === name) return { relPath, name: baseNameOf(name) };
      const sib = siblings(parent);
      sib.delete(name);
      const finalName = findAvailableName(candidate, sib);
      const newRelPath = await fs.rename(await root(), relPath, finalName);
      await relocate(relPath, newRelPath);
      return {
        relPath: newRelPath,
        name: entry?.isDirectory ? finalName : baseNameOf(finalName),
      };
    },

    move: async (relPathRaw, destinationParentRelPath) => {
      const relPath = normalizeRelPath(relPathRaw);
      const dest = normalizeRelPath(destinationParentRelPath ?? "");
      const entry = index.get(relPath);
      const newRelPath = await fs.move(await root(), relPath, dest);
      await relocate(relPath, newRelPath);
      const name = nameOf(newRelPath);
      return {
        relPath: newRelPath,
        name: entry?.isDirectory ? name : baseNameOf(name),
      };
    },

    setPath: async (relPath, newRelPath) => {
      const target = normalizeRelPath(newRelPath);
      const moved = await adapter.move(relPath, parentOf(target) || undefined);
      if (nameOf(moved.relPath) !== nameOf(target))
        return adapter.rename(moved.relPath, nameOf(target));
      return moved;
    },

    delete: async (relPathRaw, options) => {
      const relPath = normalizeRelPath(relPathRaw);
      const entry = index.get(relPath);
      if (!options?.silent) {
        const name = nameOf(relPath);
        const ok = await deps.confirm(
          entry?.isDirectory
            ? "Supprimer ce dossier ?"
            : "Supprimer cette note ?",
          entry?.isDirectory
            ? `« ${name} » et tout son contenu seront déplacés vers la corbeille (.trash).`
            : `« ${name} » sera déplacée vers la corbeille (.trash).`,
        );
        if (!ok) return { deleted: false };
      }
      const { trashRelPath } = await fs.deleteFile(
        await root(),
        relPath,
        Boolean(options?.permanent),
      );
      for (const removed of removeSubtree(relPath)) deps.markDirty(removed);
      if (trashRelPath)
        index.set(trashRelPath, {
          uri: "",
          isDirectory: Boolean(entry?.isDirectory),
        });
      invalidate();
      return { deleted: true };
    },

    listTrash: async () => {
      await root();
      return [...index.entries()]
        .filter(([p, e]) => p.startsWith(".trash/") && !e.isDirectory)
        .map(([relPath, e]) => ({
          relPath,
          sizeBytes: e.size ?? 0,
          modifiedAt: new Date(e.mtime ?? 0).toISOString(),
        }))
        .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
    },

    getLastOpened: async () => {
      const s = await readState();
      if (s.lastOpenedRelPath !== undefined) return s.lastOpenedRelPath ?? null;
      return readLegacyStringFile("123ecriture-last-opened.txt");
    },
    setLastOpened: (relPath) => patchState({ lastOpenedRelPath: relPath }),
    getCollapsedPaths: async () => {
      const s = await readState();
      return (
        s.collapsedRelPaths ??
        readLegacyJsonArrayFile("123ecriture-collapsed.json")
      );
    },
    setCollapsedPaths: (relPaths) =>
      patchState({ collapsedRelPaths: relPaths }),
    getOpenTabs: async () => {
      const s = await readState();
      return (
        s.openTabRelPaths ??
        readLegacyJsonArrayFile("123ecriture-open-tabs.json")
      );
    },
    setOpenTabs: (relPaths) => patchState({ openTabRelPaths: relPaths }),

    ensureDailyNote: async (dateIso) => {
      const relPath = `Journal/${dateIso}.mdx`;
      const treeUri = await root();
      const existing = await fs.stat(treeUri, relPath);
      if (existing && !existing.isDirectory) {
        return {
          relPath,
          name: dateIso,
          modifiedAt: existing.mtime || Date.now(),
          kind: "markdown",
        };
      }
      return adapter.createNote(dateIso, "Journal", "markdown");
    },

    reorder: async () => {
      await refresh();
      return adapter.listTree();
    },

    importAttachment: async () => {
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
      });
      if (result.canceled) return null;
      const asset = result.assets?.[0];
      if (!asset) return null;
      let folder = "attachments";
      try {
        const prefs =
          (await window.preferences?.get()) as Partial<Preferences> | null;
        if (
          prefs?.attachmentsFolder &&
          typeof prefs.attachmentsFolder === "string"
        )
          folder = prefs.attachmentsFolder;
      } catch {
        // défaut
      }
      const name = findAvailableName(
        asset.name,
        siblings(normalizeRelPath(folder)),
      );
      const relPath = join(normalizeRelPath(folder), name);
      // asset.uri = copie dans le CACHE PRIVÉ de l'app (hors coffre).
      const base64 = await FileSystem.readAsStringAsync(asset.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      await write(relPath, base64, "base64");
      return { relPath, name };
    },

    readAttachmentDataUrl: async (relPath) => {
      const base64 = await read(relPath, "base64");
      const ext = relPath.toLowerCase().split(".").pop() ?? "";
      const mime =
        ext === "png"
          ? "image/png"
          : ext === "jpg" || ext === "jpeg"
            ? "image/jpeg"
            : ext === "gif"
              ? "image/gif"
              : ext === "webp"
                ? "image/webp"
                : "application/octet-stream";
      return `data:${mime};base64,${base64}`;
    },

    duplicate: async (relPathRaw) => {
      const relPath = normalizeRelPath(relPathRaw);
      if (index.get(relPath)?.isDirectory)
        throw new Error(
          "Dupliquer un dossier n’est pas encore pris en charge sur Android.",
        );
      const parent = parentOf(relPath);
      const segment = nameOf(relPath);
      const kind = extensionKind(segment) ?? "markdown";
      const ext =
        KNOWN_CONTENT_EXTS.find((k) => segment.toLowerCase().endsWith(k)) ??
        EXTENSION_FOR_KIND[kind];
      const base = segment.slice(0, segment.length - ext.length);
      const sib = siblings(parent);
      let candidate = `${base} (copie)${ext}`;
      for (let n = 2; sib.has(candidate); n++)
        candidate = `${base} (copie ${n})${ext}`;
      const content = await read(relPath, "utf8");
      const newRelPath = join(parent, candidate);
      await write(newRelPath, content, "utf8");
      return {
        relPath: newRelPath,
        name: candidate.slice(0, candidate.length - ext.length),
        modifiedAt: Date.now(),
        kind,
      };
    },

    listTags: async () => {
      await refresh();
      const byTag = new Map<string, { relPath: string; name: string }[]>();
      for (const [relPath, entry] of index) {
        if (
          entry.isDirectory ||
          isMetaRelPath(relPath) ||
          extensionKind(relPath) !== "markdown"
        )
          continue;
        let content: string;
        try {
          content = await read(relPath, "utf8");
        } catch {
          continue;
        }
        const { body } = parseFrontmatter(content);
        for (const match of body.matchAll(TAG_PATTERN)) {
          const tag = match[2].toLowerCase();
          const list = byTag.get(tag) ?? [];
          list.push({ relPath, name: baseNameOf(nameOf(relPath)) });
          byTag.set(tag, list);
        }
      }
      return [...byTag.entries()]
        .map(([tag, notes]) => ({ tag, notes }))
        .sort((a, b) => a.tag.localeCompare(b.tag, "fr"));
    },
  };

  return {
    adapter,
    ensureIndexed: async () => {
      const uri = await root();
      if (fullyIndexed) return;
      const cached = await deps.loadIndexCache?.(uri).catch(() => null);
      if (cached && cached.length > 0) index = new Map([...cached, ...index]);
      try {
        await refresh();
      } catch (error) {
        // Permission perdue mais cache présent : l'UI reste lisible.
        if (!(error instanceof VaultPermissionLostError) || index.size === 0) throw error;
      }
    },
    // Vérifie l'accès AVANT un cycle de synchro : lève VaultPermissionLostError.
    assertAccess: async () => {
      const uri = await root();
      let ok = false;
      try {
        ok = await fs.hasPermission(uri);
      } catch {
        ok = false;
      }
      if (!ok) {
        if (!permissionLost) deps.onPermissionLost?.(uri);
        permissionLost = true;
        throw new VaultPermissionLostError();
      }
      permissionLost = false;
    },
    isPermissionLost: () => permissionLost,
    isFullyIndexed: () => fullyIndexed,
    getIndexKeys: () => [...index.keys()],
    getIndexEntry: (relPath: string) => index.get(relPath),
    // Dossiers illisibles au dernier parcours : leurs fichiers sont « inconnus ».
    getLastListErrors: () => lastErrors,
  };
}

export function alertConfirm(title: string, message: string): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { text: "Annuler", style: "cancel", onPress: () => resolve(false) },
        {
          text: "Supprimer",
          style: "destructive",
          onPress: () => resolve(true),
        },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

function indexCachePath(rootUri: string): string {
  let h = 0;
  for (let i = 0; i < rootUri.length; i++) h = (h * 31 + rootUri.charCodeAt(i)) | 0;
  return `${FileSystem.documentDirectory}vaultfs-index-${(h >>> 0).toString(36)}.json`;
}

export function createDefaultVaultFsAdapter(fs: VaultFsNativeModule) {
  return createVaultFsAdapter({
    fs,
    getRootUri: getActiveVaultRootUri,
    markDirty: markVaultFileDirty,
    confirm: alertConfirm,
    loadIndexCache: async (rootUri) => {
      const raw = await FileSystem.readAsStringAsync(indexCachePath(rootUri));
      const parsed = JSON.parse(raw) as { rootUri: string; entries: [string, VaultFsIndexEntry][] };
      return parsed.rootUri === rootUri ? parsed.entries : null;
    },
    saveIndexCache: (rootUri, entries) =>
      FileSystem.writeAsStringAsync(indexCachePath(rootUri), JSON.stringify({ rootUri, entries })),
    onPermissionLost: () => {
      Alert.alert(
        "Accès au coffre perdu",
        "Android a retiré l'accès au dossier du coffre. Tes notes restent lisibles depuis le cache et RIEN n'a été supprimé. Re-sélectionne le dossier pour reprendre (Réglages → Coffres → Ouvrir un coffre existant).",
        [{ text: "OK" }],
      );
    },
  });
}
