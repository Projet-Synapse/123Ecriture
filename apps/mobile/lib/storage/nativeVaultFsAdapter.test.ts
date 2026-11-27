import { beforeEach, describe, expect, it, vi } from "vitest";

import type { VaultFsNativeModule } from "../../modules/vault-fs/src";
import {
  createVaultFsAdapter,
  isVaultFsNotFound,
  normalizeRelPath,
  reconcileRelocations,
} from "./nativeVaultFsAdapter";

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
    const files = this.heldListing?.files ?? this.files;
    const dirs = this.heldListing?.dirs ?? this.dirs;
    const entries = [];
    const errors = [];
    for (const d of dirs) {
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
    for (const [p, c] of files) {
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
  // Si défini, listTree renvoie cette photo (parcours SAF périmé).
  heldListing: { files: Map<string, string>; dirs: Set<string> } | null = null;

  holdListing() {
    this.heldListing = {
      files: new Map(this.files),
      dirs: new Set(this.dirs),
    };
  }

  async stat(_t: string, relPath: string) {
    const name = relPath.slice(relPath.lastIndexOf("/") + 1);
    if (this.files.has(relPath))
      return {
        docId: `f:${relPath}`,
        name,
        isDirectory: false,
        mtime: 5,
        size: this.files.get(relPath)!.length,
      };
    if (this.dirs.has(relPath))
      return {
        docId: `d:${relPath}`,
        name,
        isDirectory: true,
        mtime: 5,
        size: 0,
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
    if (!this.files.has(relPath) && !this.dirs.has(relPath)) {
      throw new Error(
        `Call to function 'VaultFs.rename' has been rejected. → Caused by: Introuvable : ${relPath}`,
      );
    }
    const parent = relPath.includes("/")
      ? relPath.slice(0, relPath.lastIndexOf("/"))
      : "";
    const target = parent ? `${parent}/${newName}` : newName;
    this.moveTree(relPath, target);
    return target;
  }
  async move(_t: string, relPath: string, dest: string) {
    if (!this.files.has(relPath) && !this.dirs.has(relPath)) {
      throw new Error(
        `Call to function 'VaultFs.move' has been rejected. → Caused by: Introuvable : ${relPath}`,
      );
    }
    const parent = relPath.includes("/")
      ? relPath.slice(0, relPath.lastIndexOf("/"))
      : "";
    if (parent === dest) return relPath;
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

describe("explorateur instantané (cache d'index)", () => {
  it("listTree rend le cache SANS attendre le parcours, puis notifie ; le cache ne vaut pas index complet", async () => {
    fs.dirs.add("Réel");
    fs.dirs.add("Réel/Vide");
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const realList = fs.listTree.bind(fs);
    fs.listTree = async (u: string) => {
      await gate;
      return realList(u);
    };
    let refreshed = 0;
    const { adapter, isFullyIndexed } = createVaultFsAdapter({
      fs,
      getRootUri: async () => ROOT,
      markDirty: () => undefined,
      confirm: async () => true,
      loadIndexCache: async () => [
        ["Ancien", { uri: "u1", isDirectory: true }],
        ["Ancien/Dossier vide", { uri: "u2", isDirectory: true }],
      ],
      onIndexRefreshed: () => refreshed++,
    });
    const first = await adapter.listTree();
    expect(JSON.stringify(first)).toContain("Dossier vide");
    expect(isFullyIndexed()).toBe(false);
    release();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(refreshed).toBe(1);
    expect(isFullyIndexed()).toBe(true);
    const second = JSON.stringify(await adapter.listTree());
    expect(second).toContain("Réel/Vide");
    expect(second).not.toContain("Ancien");
  });

  it("sans cache : parcours complet comme avant", async () => {
    fs.dirs.add("D");
    const { adapter, isFullyIndexed } = make();
    expect(JSON.stringify(await adapter.listTree())).toContain('"D"');
    expect(isFullyIndexed()).toBe(true);
  });
});

describe("isVaultFsNotFound", () => {
  it("reconnaît l'erreur native Android (Introuvable / E_NOT_FOUND)", () => {
    expect(
      isVaultFsNotFound(
        new Error(
          "Call to function 'VaultFs.rename' has been rejected. → Caused by: Introuvable : 👩🏻 Kyani Larsson.md",
        ),
      ),
    ).toBe(true);
    expect(isVaultFsNotFound(new Error("E_NOT_FOUND"))).toBe(true);
    expect(isVaultFsNotFound(new Error("existe déjà"))).toBe(false);
  });
});

describe("reconcileRelocations", () => {
  const entry = { uri: "u", isDirectory: false };

  it("réapplique un renommage ignoré par une liste périmée", () => {
    const listed = new Map([["note.md", entry]]);
    const memory = new Map([["note.mdx", entry]]);
    const { index, pending } = reconcileRelocations(
      listed,
      memory,
      [{ from: "note.md", to: "note.mdx", at: 1 }],
      0,
    );
    expect([...index.keys()]).toEqual(["note.mdx"]);
    expect(pending).toHaveLength(1);
  });

  it("garde le nouveau chemin si le parcours n'a encore ni l'ancien ni le nouveau", () => {
    const { index } = reconcileRelocations(
      new Map(),
      new Map([["note.mdx", entry]]),
      [{ from: "note.md", to: "note.mdx", at: 2 }],
      1,
    );
    expect([...index.keys()]).toEqual(["note.mdx"]);
  });

  it("oublie le déplacement une fois le parcours à jour", () => {
    const { index, pending } = reconcileRelocations(
      new Map([["note.mdx", entry]]),
      new Map([["note.mdx", entry]]),
      [{ from: "note.md", to: "note.mdx", at: 1 }],
      1,
    );
    expect([...index.keys()]).toEqual(["note.mdx"]);
    expect(pending).toEqual([]);
  });
});

describe("conversion .md ⇄ .mdx et index après renommage", () => {
  const character =
    "1. 👁 L'ENCHANTERESSE/📖 TEMPLATES/5. 👤 PERSONNAGES/🥇 PRINCIPAUX/👩🏻 Kyani Larsson.md";

  it("garde le nouveau chemin même si listTree renvoie encore l'ancien .md", async () => {
    const parent = character.slice(0, character.lastIndexOf("/"));
    fs.files.set(character, "fiche");
    for (let i = 1; i < parent.split("/").length; i++)
      fs.dirs.add(parent.split("/").slice(0, i).join("/"));
    fs.dirs.add(parent);
    const { adapter, getIndexKeys } = make();
    await adapter.listTree();
    fs.holdListing();
    const res = await adapter.rename(character, "👩🏻 Kyani Larsson.mdx");
    const next = character.replace(/\.md$/, ".mdx");
    expect(res.relPath).toBe(next);
    expect(getIndexKeys()).toContain(next);
    expect(getIndexKeys()).not.toContain(character);
    const tree = JSON.stringify(await adapter.listTree());
    expect(tree).toContain("👩🏻 Kyani Larsson.mdx");
    expect(getIndexKeys()).not.toContain(character);
  });

  it("un parcours commencé avant le renommage ne réinscrit pas l'ancien chemin", async () => {
    fs.files.set("note.md", "hello");
    const { adapter, getIndexKeys } = make();
    await adapter.listTree();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const stale = {
      files: new Map(fs.files),
      dirs: new Set(fs.dirs),
    };
    const realList = fs.listTree.bind(fs);
    let started = false;
    fs.listTree = async (u: string) => {
      started = true;
      await gate;
      const prev = fs.heldListing;
      fs.heldListing = stale;
      try {
        return await realList(u);
      } finally {
        fs.heldListing = prev;
      }
    };
    const rescan = adapter.rescan!();
    while (!started) await new Promise((r) => setTimeout(r, 0));
    const res = await adapter.rename("note.md", "note.mdx");
    expect(res.relPath).toBe("note.mdx");
    expect(getIndexKeys()).toContain("note.mdx");
    expect(getIndexKeys()).not.toContain("note.md");
    release();
    await rescan;
    expect(getIndexKeys()).toContain("note.mdx");
    expect(getIndexKeys()).not.toContain("note.md");
  });

  it("si la source est introuvable mais que la cible existe, resynchronise l'index", async () => {
    fs.files.set("note.md", "hello");
    const { adapter, getIndexKeys } = make();
    await adapter.listTree();
    fs.files.delete("note.md");
    fs.files.set("note.mdx", "hello");
    const res = await adapter.rename("note.md", "note.mdx");
    expect(res.relPath).toBe("note.mdx");
    expect(getIndexKeys()).toContain("note.mdx");
    expect(getIndexKeys()).not.toContain("note.md");
  });

  it("setPath dans le même dossier convertit .md → .mdx sans passer par move", async () => {
    fs.dirs.add("Dossier");
    fs.files.set("Dossier/note.md", "hello");
    const { adapter, getIndexKeys } = make();
    await adapter.listTree();
    const moves: unknown[] = [];
    const realMove = fs.move.bind(fs);
    fs.move = async (t, rel, dest) => {
      moves.push([rel, dest]);
      return realMove(t, rel, dest);
    };
    const res = await adapter.setPath("Dossier/note.md", "Dossier/note.mdx");
    expect(moves).toEqual([]);
    expect(res.relPath).toBe("Dossier/note.mdx");
    expect(fs.files.has("Dossier/note.mdx")).toBe(true);
    expect(fs.files.has("Dossier/note.md")).toBe(false);
    expect(getIndexKeys()).toContain("Dossier/note.mdx");
  });
});
