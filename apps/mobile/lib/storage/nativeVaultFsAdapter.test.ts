import { beforeEach, describe, expect, it, vi } from "vitest";

import type { VaultFsNativeModule } from "../../modules/vault-fs/src";
import { createVaultFsAdapter, normalizeRelPath } from "./nativeVaultFsAdapter";

vi.mock("react-native", () => ({
  Alert: { alert: vi.fn() },
  Platform: { OS: "android" },
}));
vi.mock("expo", () => ({ requireOptionalNativeModule: () => null }));
vi.mock("expo-document-picker", () => ({ getDocumentAsync: vi.fn() }));
vi.mock("expo-file-system/legacy", () => ({
  documentDirectory: "file:///data/",
  cacheDirectory: "file:///cache/",
  readAsStringAsync: vi.fn(async () => {
    throw new Error("absent");
  }),
  writeAsStringAsync: vi.fn(async () => undefined),
  getInfoAsync: vi.fn(async () => ({ exists: false })),
  StorageAccessFramework: {},
  EncodingType: { Base64: "base64" },
}));
vi.mock("./nativeVaultsAdapter", () => ({
  getActiveVaultRootUri: vi.fn(async () => ROOT),
  requestAndRegisterVault: vi.fn(async () => []),
}));

const ROOT =
  "content://com.android.externalstorage.documents/tree/primary%3ADocuments%2F%E2%9C%92%EF%B8%8F%20123Ecriture";

// Faux module natif : un coffre en mémoire (relPath → contenu), dossiers explicites.
class FakeVaultFs implements VaultFsNativeModule {
  files = new Map<string, string>();
  dirs = new Set<string>();
  unreadable = new Set<string>();
  failWrites = false;
  calls: string[] = [];
  private id = 0;

  async hasPermission() {
    return true;
  }
  async takePersistablePermission() {
    return true;
  }
  async listTree(treeUri: string) {
    expect(treeUri).toBe(ROOT);
    this.calls.push("listTree");
    const entries = [];
    const errors = [];
    for (const d of this.dirs) {
      if ([...this.unreadable].some((u) => d.startsWith(`${u}/`))) continue;
      entries.push({
        relPath: d,
        docId: `d:${d}`,
        isDirectory: true,
        mtime: 1,
        size: 0,
      });
    }
    for (const u of this.unreadable)
      errors.push({ relPath: u, message: "Function not implemented" });
    for (const [p, c] of this.files) {
      if ([...this.unreadable].some((u) => p.startsWith(`${u}/`))) continue;
      entries.push({
        relPath: p,
        docId: `f:${p}`,
        isDirectory: false,
        mtime: 2,
        size: c.length,
      });
    }
    return { entries, errors };
  }
  async stat(_t: string, relPath: string) {
    if (this.files.has(relPath))
      return {
        docId: `f:${relPath}`,
        name: relPath,
        isDirectory: false,
        mtime: 5,
        size: 1,
      };
    return null;
  }
  async readFile(_t: string, relPath: string) {
    const c = this.files.get(relPath);
    if (c === undefined) throw new Error("E_NOT_FOUND");
    return {
      content: c,
      size: c.length,
      sha256: "x",
      mtime: 3,
      docId: `f:${relPath}`,
    };
  }
  async writeFileAtomic(_t: string, relPath: string, content: string) {
    this.calls.push(`write:${relPath}`);
    if (this.failWrites) throw new Error("E_VERIFY");
    const parts = relPath.split("/");
    for (let i = 1; i < parts.length; i++)
      this.dirs.add(parts.slice(0, i).join("/"));
    this.files.set(relPath, content);
    this.id += 1;
    return {
      relPath,
      docId: `f:${relPath}#${this.id}`,
      size: content.length,
      sha256: "x",
      method: "rename" as const,
    };
  }
  async mkdirs(_t: string, relPath: string) {
    this.dirs.add(relPath);
    return `d:${relPath}`;
  }
  async deleteFile(_t: string, relPath: string, permanent: boolean) {
    const c = this.files.get(relPath);
    this.files.delete(relPath);
    if (permanent) return { trashRelPath: null };
    const t = `.trash/2026-10-23T02-00-00-${relPath.split("/").pop()}`;
    this.dirs.add(".trash");
    this.files.set(t, c ?? "");
    return { trashRelPath: t };
  }
  async rename(_t: string, relPath: string, newName: string) {
    const parent = relPath.includes("/")
      ? relPath.slice(0, relPath.lastIndexOf("/"))
      : "";
    const target = parent ? `${parent}/${newName}` : newName;
    this.moveTree(relPath, target);
    return target;
  }
  async move(_t: string, relPath: string, dest: string) {
    const target = dest
      ? `${dest}/${relPath.split("/").pop()}`
      : relPath.split("/").pop()!;
    this.moveTree(relPath, target);
    return target;
  }
  private moveTree(from: string, to: string) {
    for (const [p, c] of [...this.files]) {
      if (p === from || p.startsWith(`${from}/`)) {
        this.files.delete(p);
        this.files.set(to + p.slice(from.length), c);
      }
    }
    for (const d of [...this.dirs]) {
      if (d === from || d.startsWith(`${from}/`)) {
        this.dirs.delete(d);
        this.dirs.add(to + d.slice(from.length));
      }
    }
  }
}

let fs: FakeVaultFs;
let dirty: string[];
let confirmAnswer: boolean;
function make() {
  return createVaultFsAdapter({
    fs,
    getRootUri: async () => ROOT,
    markDirty: (p) => dirty.push(p),
    confirm: async () => confirmAnswer,
  });
}

beforeEach(() => {
  fs = new FakeVaultFs();
  dirty = [];
  confirmAnswer = true;
});

describe("normalizeRelPath", () => {
  it("convertit les `\\` Windows et retire les segments vides", () => {
    expect(normalizeRelPath("PROGRAMMATION\\Kotlin\\\\note.md")).toBe(
      "PROGRAMMATION/Kotlin/note.md",
    );
    expect(normalizeRelPath("/a/./b/")).toBe("a/b");
  });
});

describe("adaptateur VaultFs", () => {
  it("listTree : dossiers par MIME, noms avec « : », emoji, accents et espaces intacts", async () => {
    fs.dirs.add("✒️ Idées");
    fs.dirs.add("PROGRAMMATION");
    fs.files.set("✒️ Idées/Réunion 10:30 — été.md", "x");
    fs.files.set("PROGRAMMATION/a.md", "y");
    fs.files.set(".123ecriture/state.json", "{}");
    const { adapter, getIndexKeys } = make();
    const tree = await adapter.listTree();
    const folder = tree.find(
      (n) => n.type === "folder" && n.name === "✒️ Idées",
    );
    expect(folder).toBeTruthy();
    expect(JSON.stringify(tree)).toContain("Réunion 10:30 — été");
    expect(getIndexKeys()).toContain(".123ecriture/state.json");
    expect(JSON.stringify(tree)).not.toContain(".123ecriture");
  });

  it("ignore les temporaires .vfs-* d’une écriture interrompue", async () => {
    fs.files.set(".vfs-1234abcd-note.md", "moitié");
    fs.files.set("note.md", "ok");
    const { getIndexKeys, ensureIndexed } = make();
    await ensureIndexed();
    expect(getIndexKeys()).toEqual(["note.md"]);
  });

  it("ensureIndexed : un index partiel (lecture isolée) déclenche quand même le parcours complet", async () => {
    fs.dirs.add("🌲 ENVIRONNEMENT");
    fs.files.set(".123ecriture/state.json", "{}");
    fs.files.set("Sans titre.base", "b");
    const { adapter, getIndexKeys, ensureIndexed } = make();
    await adapter.readNote(".123ecriture/state.json");
    expect(getIndexKeys()).toEqual([".123ecriture/state.json"]);
    await ensureIndexed();
    expect(getIndexKeys()).toEqual(expect.arrayContaining(["🌲 ENVIRONNEMENT", "Sans titre.base"]));
  });

  it("hashFile : empreinte calculée côté natif (aucun tableau d'octets en JS), chemin Windows normalisé", async () => {
    fs.files.set("A/grosse note.md", "contenu");
    const { hashFile } = make();
    await expect(hashFile("A\\grosse note.md")).resolves.toEqual({ hash: "x", size: 7 });
  });

  it("dossier illisible = contenu INCONNU : les fichiers déjà indexés ne disparaissent pas", async () => {
    fs.dirs.add("WORLDBUILDING");
    fs.files.set("WORLDBUILDING/carte.md", "c");
    const { adapter, getIndexKeys, getLastListErrors } = make();
    await adapter.rescan!();
    expect(getIndexKeys()).toContain("WORLDBUILDING/carte.md");
    fs.unreadable.add("WORLDBUILDING");
    await adapter.rescan!();
    expect(getLastListErrors()).toHaveLength(1);
    expect(getIndexKeys()).toContain("WORLDBUILDING/carte.md");
  });

  it("writeNote : succès seulement après écriture vérifiée, sinon rejet sans marquer « modifié »", async () => {
    const { adapter, getIndexEntry } = make();
    await adapter.writeNote("A/B/n.md", "bonjour");
    expect(fs.files.get("A/B/n.md")).toBe("bonjour");
    expect(getIndexEntry("A/B/n.md")?.isDirectory).toBe(false);
    expect(getIndexEntry("A/B")?.isDirectory).toBe(true);
    expect(dirty).toEqual(["A/B/n.md"]);

    fs.failWrites = true;
    await expect(adapter.writeNote("A/c.md", "z")).rejects.toThrow("E_VERIFY");
    expect(getIndexEntry("A/c.md")).toBeUndefined();
    expect(dirty).toEqual(["A/B/n.md"]);
  });

  it("writeNote normalise un chemin Windows hérité", async () => {
    const { adapter } = make();
    await adapter.writeNote("PROGRAMMATION\\x.md", "1");
    expect(fs.calls).toContain("write:PROGRAMMATION/x.md");
  });

  it("delete : demande confirmation, puis déplace dans .trash (jamais de destruction)", async () => {
    fs.files.set("n.md", "contenu");
    const { adapter, getIndexKeys } = make();
    await adapter.listTree();
    confirmAnswer = false;
    expect(await adapter.delete("n.md")).toEqual({ deleted: false });
    expect(fs.files.has("n.md")).toBe(true);
    confirmAnswer = true;
    expect(await adapter.delete("n.md")).toEqual({ deleted: true });
    expect(
      [...fs.files.keys()].some(
        (k) => k.startsWith(".trash/") && k.endsWith("n.md"),
      ),
    ).toBe(true);
    expect(getIndexKeys()).not.toContain("n.md");
    expect(dirty).toContain("n.md");
  });

  it("rename garde l’extension réelle et marque ancien + nouveau chemin", async () => {
    fs.files.set("Dossier/old.md", "x");
    fs.dirs.add("Dossier");
    const { adapter, getIndexKeys } = make();
    await adapter.listTree();
    const res = await adapter.rename("Dossier/old.md", "Nouveau : titre");
    expect(res.relPath).toBe("Dossier/Nouveau : titre.md");
    expect(getIndexKeys()).toContain("Dossier/Nouveau : titre.md");
    expect(dirty).toEqual(
      expect.arrayContaining(["Dossier/old.md", "Dossier/Nouveau : titre.md"]),
    );
  });

  it("move d’un DOSSIER entier (natif) réindexe ses enfants", async () => {
    fs.dirs.add("A");
    fs.dirs.add("B");
    fs.files.set("A/1.md", "1");
    const { adapter, getIndexKeys } = make();
    await adapter.listTree();
    const res = await adapter.move("A", "B");
    expect(res.relPath).toBe("B/A");
    expect(getIndexKeys()).toContain("B/A/1.md");
    expect(getIndexKeys()).not.toContain("A/1.md");
  });

  it("createNote évite les collisions sans doublon « (1) »", async () => {
    fs.files.set("Note.mdx", "");
    const { adapter } = make();
    await adapter.listTree();
    const created = await adapter.createNote("Note", undefined, "markdown");
    expect(created.relPath).toBe("Note 2.mdx");
  });
});
