import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';

import { createCloudVault, type CacheStore, type CloudApi, type Encoding, type LockResult, type RemoteRow } from './cloudVaultCore';
import { importLegacyFiles, shouldImportRelPath } from './legacyImportCore';

// Serveur Supabase SIMULÉ : mêmes règles que les RPC prod (push_file /
// tombstone_file / restore_file, verrou optimiste, storage_path préfixé).
class FakeSupabase implements CloudApi {
  rows = new Map<string, RemoteRow>();
  objects = new Map<string, string>();
  offline = false;
  calls: string[] = [];
  private guard() {
    if (this.offline) throw new Error('Network request failed');
  }
  private res(row: RemoteRow | undefined, ok: boolean): LockResult {
    return { ok, conflict: !ok, currentVersion: row?.version ?? null, currentHash: row?.contentHash ?? null, deleted: row?.deleted ?? false };
  }
  async listFiles(vaultId: string) {
    this.guard();
    return [...this.rows.values()].filter(() => vaultId === 'R1').map((r) => ({ ...r }));
  }
  async download(_v: string, row: RemoteRow) {
    this.guard();
    const o = this.objects.get(row.storagePath ?? '');
    if (o === undefined) throw new Error('objet absent');
    return o;
  }
  async upload(vaultId: string, hash: string, content: string) {
    this.guard();
    const key = `${vaultId}/c/${hash}`;
    this.objects.set(key, content);
    this.calls.push(`upload ${key}`);
    return key;
  }
  async pushFile(vaultId: string, relPath: string, expected: number | null, hash: string, size: number, storagePath: string) {
    this.guard();
    if (!storagePath.startsWith(`${vaultId}/`)) throw new Error('storage_path hors coffre');
    this.calls.push(`push ${relPath} @${expected}`);
    const row = this.rows.get(relPath);
    if (row && row.contentHash === hash && !row.deleted) return this.res(row, true);
    if (expected === null) {
      if (row) return this.res(row, false);
      const n: RemoteRow = { relPath, version: 1, contentHash: hash, sizeBytes: size, updatedAt: 'now', deleted: false, storagePath };
      this.rows.set(relPath, n);
      return this.res(n, true);
    }
    if (!row || row.deleted || row.version !== expected) return this.res(row, false);
    Object.assign(row, { version: row.version + 1, contentHash: hash, sizeBytes: size, storagePath });
    return this.res(row, true);
  }
  async tombstone(_v: string, relPath: string, expected: number | null) {
    this.guard();
    this.calls.push(`tombstone ${relPath} @${expected}`);
    const row = this.rows.get(relPath);
    if (!row || row.deleted) return this.res(row, !!row);
    if (expected !== null && row.version !== expected) return this.res(row, false);
    row.deleted = true;
    row.version += 1;
    return this.res(row, true);
  }
  async restore(_v: string, relPath: string) {
    this.guard();
    this.calls.push(`restore ${relPath}`);
    const row = this.rows.get(relPath);
    if (!row || !row.deleted) return this.res(row, false);
    row.deleted = false;
    row.version += 1;
    return this.res(row, true);
  }
  seed(relPath: string, content: string) {
    const hash = sha(content);
    const key = `R1/c/${hash}`;
    this.objects.set(key, content);
    this.rows.set(relPath, { relPath, version: 1, contentHash: hash, sizeBytes: content.length, updatedAt: 'then', deleted: false, storagePath: key });
  }
  // Un AUTRE appareil modifie le fichier.
  remoteEdit(relPath: string, content: string) {
    const row = this.rows.get(relPath)!;
    const hash = sha(content);
    this.objects.set(`R1/c/${hash}`, content);
    Object.assign(row, { version: row.version + 1, contentHash: hash, storagePath: `R1/c/${hash}` });
  }
}

function sha(s: string) {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

class MemCache implements CacheStore {
  m = new Map<string, string>();
  async read(k: string) {
    return this.m.get(k) ?? null;
  }
  async write(k: string, c: string) {
    this.m.set(k, c);
  }
  async size() {
    return [...this.m.values()].reduce((a, b) => a + b.length, 0);
  }
}

const helpers = {
  buildTree: (idx: Map<string, { isDirectory: boolean }>) =>
    [...idx.entries()].sort().map(([relPath, e]) =>
      e.isDirectory
        ? ({ type: 'folder', relPath, name: relPath, children: [] } as VaultTreeNode)
        : ({ type: 'note', relPath, name: relPath, modifiedAt: 0, kind: 'markdown' } as unknown as VaultTreeNode),
    ),
  findAvailableName: (name: string, sib: Set<string>) => {
    if (!sib.has(name)) return name;
    const dot = name.lastIndexOf('.');
    for (let n = 1; ; n += 1) {
      const c = dot > 0 ? `${name.slice(0, dot)} ${n}${name.slice(dot)}` : `${name} ${n}`;
      if (!sib.has(c)) return c;
    }
  },
  defaultContentForKind: () => '',
  extensionForKind: { markdown: '.md' } as Record<VaultEntryKind, string>,
  knownContentExts: ['.md', '.mdx'],
  extensionKind: (n: string) => (n.endsWith('.md') || n.endsWith('.mdx') ? ('markdown' as VaultEntryKind) : null),
  baseNameOf: (n: string) => n.replace(/\.(md|mdx)$/, ''),
  isBinary: (p: string) => p.endsWith('.png'),
};

let server: FakeSupabase;
let cache: MemCache;
let active: { localId: string; remoteVaultId: string; name: string } | null;
let confirmAnswer: boolean;

function make() {
  return createCloudVault({
    api: server,
    cache,
    hash: (c: string, e: Encoding) => ({ hash: e === 'utf8' ? sha(c) : createHash('sha256').update(Buffer.from(c, 'base64')).digest('hex'), size: c.length }),
    getActive: async () => active,
    deviceId: async () => 'dev-1',
    deviceName: async () => 'Pixel',
    confirm: async () => confirmAnswer,
    helpers,
    now: () => Date.parse('2026-10-23T18:00:00Z'),
    flushDelayMs: -1,
  });
}

beforeEach(() => {
  server = new FakeSupabase();
  cache = new MemCache();
  active = { localId: 'L1', remoteVaultId: 'R1', name: 'DIVERS' };
  confirmAnswer = true;
});

const paths = (tree: VaultTreeNode[]) => tree.map((n) => n.relPath);

describe('coffre cloud Android — lecture', () => {
  it('arbre = lignes distantes non supprimées ; lecture téléchargée puis servie par le cache', async () => {
    server.seed('Notes/a.md', 'A');
    server.seed('b.md', 'B');
    server.rows.set('gone.md', { relPath: 'gone.md', version: 3, contentHash: 'x', sizeBytes: 1, updatedAt: '', deleted: true, storagePath: null });
    const { adapter } = make();
    expect(paths(await adapter.listTree())).toEqual(['Notes', 'Notes/a.md', 'b.md']);
    expect(await adapter.readNote('Notes/a.md')).toBe('A');
    server.offline = true;
    expect(await adapter.readNote('Notes/a.md')).toBe('A');
  });

  it('sans coffre lié : erreur claire, aucune requête', async () => {
    active = null;
    const { adapter } = make();
    await expect(adapter.readNote('a.md')).rejects.toThrow(/Aucun coffre cloud actif/);
    expect(await adapter.getCurrentPath()).toBeNull();
  });
});

describe('coffre cloud Android — écriture', () => {
  it('save = cache + file ; flush = upload adressé par contenu puis push_file avec la version de base', async () => {
    server.seed('a.md', 'v1');
    const { adapter, cloudSync } = make();
    await adapter.listTree();
    await adapter.writeNote('a.md', 'v2');
    expect((await cloudSync.status()).pending).toBe(1);
    const r = await cloudSync.flush();
    expect(r.pushed).toBe(1);
    expect(server.calls).toContain('push a.md @1');
    expect(server.rows.get('a.md')!.version).toBe(2);
    expect(server.rows.get('a.md')!.storagePath).toBe(`R1/c/${sha('v2')}`);
    expect((await cloudSync.status()).pending).toBe(0);
  });

  it('contenu identique : aucune opération', async () => {
    server.seed('a.md', 'v1');
    const { adapter, cloudSync } = make();
    await adapter.listTree();
    await adapter.writeNote('a.md', 'v1');
    expect((await cloudSync.status()).pending).toBe(0);
  });

  it('hors ligne : la file est gardée (et persistée), puis envoyée au retour du réseau', async () => {
    server.seed('a.md', 'v1');
    const first = make();
    await first.adapter.listTree();
    server.offline = true;
    await first.adapter.writeNote('a.md', 'v2');
    await first.adapter.createNote('Nouvelle', '');
    const off = await first.cloudSync.flush();
    expect(off.offline).toBe(true);
    expect(off.pending).toBe(2);
    expect(await first.adapter.readNote('a.md')).toBe('v2');
    // Redémarrage de l'app : l'état vient du cache privé.
    server.offline = false;
    const second = make();
    const on = await second.cloudSync.flush();
    expect(on.pushed).toBe(2);
    expect(server.rows.has('Nouvelle.md')).toBe(true);
    expect(server.rows.get('a.md')!.contentHash).toBe(sha('v2'));
  });

  it('CONFLIT : la version cloud reste en place, la locale part en copie « (conflit …) », listée', async () => {
    server.seed('a.md', 'v1');
    const { adapter, cloudSync } = make();
    await adapter.listTree();
    await adapter.writeNote('a.md', 'mobile');
    server.remoteEdit('a.md', 'desktop');
    const r = await cloudSync.flush();
    expect(r.conflicts).toBe(1);
    expect(server.objects.get(server.rows.get('a.md')!.storagePath!)).toBe('desktop');
    const copy = [...server.rows.keys()].find((k) => k.includes('(conflit'))!;
    expect(copy).toBe('a (conflit Pixel 2026-10-23 18h00).md');
    expect(server.objects.get(server.rows.get(copy)!.storagePath!)).toBe('mobile');
    expect(await adapter.readNote('a.md')).toBe('desktop');
    const st = await cloudSync.status();
    expect(st.conflicts[0]).toMatchObject({ relPath: 'a.md', conflictCopy: copy, reason: 'version' });
  });

  it('création sur une ancienne tombstone : restore_file puis push (action explicite)', async () => {
    server.seed('a.md', 'old');
    server.rows.get('a.md')!.deleted = true;
    const { adapter, cloudSync } = make();
    await adapter.listTree();
    await adapter.writeNote('a.md', 'neuf');
    await cloudSync.flush();
    expect(server.calls).toEqual(expect.arrayContaining(['restore a.md']));
    expect(server.rows.get('a.md')).toMatchObject({ deleted: false, contentHash: sha('neuf') });
  });

  it('métadonnées locales .123ecriture/state.json : jamais envoyées', async () => {
    const { adapter, cloudSync } = make();
    await adapter.setLastOpened('a.md');
    expect(await adapter.getLastOpened()).toBe('a.md');
    expect((await cloudSync.status()).pending).toBe(0);
  });
});

describe('coffre cloud Android — suppression / renommage', () => {
  it('delete = tombstone récupérable après confirmation ; refus = rien', async () => {
    server.seed('a.md', 'A');
    const { adapter, cloudSync } = make();
    await adapter.listTree();
    confirmAnswer = false;
    expect(await adapter.delete('a.md')).toEqual({ deleted: false });
    confirmAnswer = true;
    expect(await adapter.delete('a.md')).toEqual({ deleted: true });
    await cloudSync.flush();
    expect(server.rows.get('a.md')!.deleted).toBe(true);
    expect(server.objects.size).toBe(1); // l'objet Storage n'est jamais supprimé
    const trash = await adapter.listTrash!();
    expect(trash.map((t) => t.relPath)).toEqual(['.trash/a.md']);
    await cloudSync.restore('.trash/a.md');
    expect(server.rows.get('a.md')!.deleted).toBe(false);
  });

  it('suppression définitive : refusée sur Android', async () => {
    server.seed('a.md', 'A');
    const { adapter } = make();
    await adapter.listTree();
    expect(await adapter.delete('a.md', { permanent: true })).toEqual({ deleted: false });
  });

  it('suppression refusée si modifiée ailleurs : le fichier reste', async () => {
    server.seed('a.md', 'A');
    const { adapter, cloudSync } = make();
    await adapter.listTree();
    await adapter.delete('a.md');
    server.remoteEdit('a.md', 'A2');
    const r = await cloudSync.flush();
    expect(r.conflicts).toBe(1);
    expect(server.rows.get('a.md')!.deleted).toBe(false);
    expect(paths(await adapter.listTree())).toContain('a.md');
  });

  it('rename : création au nouveau chemin AVANT tombstone de l’ancien ; jamais d’écrasement', async () => {
    server.seed('a.md', 'A');
    server.seed('b.md', 'B');
    const { adapter, cloudSync } = make();
    await adapter.listTree();
    const r = await adapter.rename('a.md', 'b');
    expect(r.relPath).toBe('b 1.md');
    await cloudSync.flush();
    expect(server.calls.filter((c) => !c.startsWith('upload'))).toEqual(['push b 1.md @null', 'tombstone a.md @1']);
    expect(server.objects.get(server.rows.get('b.md')!.storagePath!)).toBe('B');
    expect(paths(await adapter.listTree())).toEqual(['b 1.md', 'b.md']);
  });

  it('move d’un dossier hors ligne : aucune tombstone ne part tant que les copies ne sont pas acceptées', async () => {
    server.seed('D/x.md', 'X');
    const { adapter, cloudSync } = make();
    await adapter.listTree();
    await adapter.createFolder('E', '');
    server.offline = true;
    await adapter.move('D', 'E');
    await cloudSync.flush();
    expect(server.rows.get('D/x.md')!.deleted).toBe(false);
    server.offline = false;
    await cloudSync.flush();
    expect(server.rows.get('E/D/x.md')!.deleted).toBe(false);
    expect(server.rows.get('D/x.md')!.deleted).toBe(true);
  });

  it('un fichier absent du cache ne crée JAMAIS de suppression distante', async () => {
    server.seed('a.md', 'A');
    const { adapter, cloudSync } = make();
    await adapter.listTree();
    cache.m.clear(); // cache effacé (Android « Vider le stockage »)
    const r = await cloudSync.flush();
    expect(r.deleted).toBe(0);
    expect(server.calls.some((c) => c.startsWith('tombstone'))).toBe(false);
    expect(server.rows.get('a.md')!.deleted).toBe(false);
  });
});

describe('import unique d’un ancien coffre (lecture seule)', () => {
  it('filtre .trash / cachés, garde les méta synchronisées', () => {
    expect(shouldImportRelPath('.trash/x.md')).toBe(false);
    expect(shouldImportRelPath('.123ecriture/state.json')).toBe(false);
    expect(shouldImportRelPath('.123ecriture/tasks.json')).toBe(true);
    expect(shouldImportRelPath('Dossier/.cache/x')).toBe(false);
    expect(shouldImportRelPath('Dossier/note.md')).toBe(true);
  });

  it('publie en CRÉATION, n’écrase pas un chemin déjà présent, ignore les trop gros', async () => {
    server.seed('deja.md', 'cloud');
    const { cloudSync } = make();
    const files = [
      { relPath: 'deja.md', uri: 'u1', binary: false },
      { relPath: 'n.md', uri: 'u2', binary: false },
      { relPath: 'gros.md', uri: 'u3', binary: false },
      { relPath: '.trash/t.md', uri: 'u4', binary: false },
    ];
    const reads: string[] = [];
    const report = await importLegacyFiles('content://old', {
      list: async () => files,
      read: async (f) => {
        reads.push(f.uri);
        return `local ${f.relPath}`;
      },
      size: async (f) => (f.relPath === 'gros.md' ? 60 * 1024 * 1024 : 10),
    }, { importFile: cloudSync.importFile, flush: cloudSync.flush });
    await cloudSync.refresh();
    expect(report).toMatchObject({ total: 3, imported: 1, skippedExisting: 1, skippedTooLarge: ['gros.md'] });
    expect(server.objects.get(server.rows.get('deja.md')!.storagePath!)).toBe('cloud');
    expect(server.rows.get('n.md')).toBeTruthy();
    expect(reads).not.toContain('u4');
  });
});
