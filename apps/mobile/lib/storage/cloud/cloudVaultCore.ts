import { folderToMarker, isFolderMarker } from '../../sync/folderMarker';
// ✒️ 123ECRITURE — lib/storage/cloud/cloudVaultCore.ts — le coffre Android 100 % cloud
//////////////////////////////////////////////////////////////////////////////
//
// v0.4.96 — Décision produit : sur ANDROID, plus aucun coffre local (SAF).
// La SOURCE DE VÉRITÉ est Supabase (vault_files + Storage 123ecriture-vaults,
// RPC push_file / tombstone_file / restore_file à verrou optimiste). Ce
// module implémente le contrat VaultBridge au-dessus de ce cloud, avec un
// CACHE PRIVÉ de l'app (documentDirectory, zéro permission) :
//
//   • Lecture : cache si son hash correspond au manifeste distant, sinon
//     téléchargement puis mise en cache.
//   • Écriture : cache d'abord (hors ligne OK), puis une FILE D'OPÉRATIONS
//     persistée est rejouée vers le cloud (put / tombstone / restore) dès
//     que le réseau répond. Chaque put porte la version distante de base :
//     le serveur refuse d'écraser une version qu'on n'a pas vue.
//   • Conflit de version : le cloud garde SA version au chemin d'origine ;
//     la version locale est publiée à côté en « (conflit …) » — rien n'est
//     jamais écrasé ni perdu — et le conflit est listé (feuille de conflits).
//   • Le cache NE CRÉE JAMAIS de suppression distante : seule une action
//     explicite (delete / rename / move dans l'app) met une tombstone en
//     file. Un fichier absent du cache n'est qu'un fichier non téléchargé.
//   • Suppression = tombstone récupérable (restore_file) ; la corbeille liste
//     les tombstones du coffre distant.
//   • Métadonnées .123ecriture/** : locales (cache) sauf la liste
//     SYNCED_META_FILES, synchronisée comme un fichier ordinaire.
//
// Module PUR (aucun import React Native) : réseau et disque sont injectés
// (CloudApi, CacheStore) — voir cloudVaultAdapter.ts pour le câblage réel et
// cloudVaultCore.test.ts pour les tests (Supabase simulé).
//
//////////////////////////////////////////////////////////////////////////////

export type Encoding = 'utf8' | 'base64';

export type RemoteRow = {
  relPath: string;
  version: number;
  contentHash: string;
  sizeBytes: number;
  updatedAt: string;
  deleted: boolean;
  storagePath: string | null;
};

export type LockResult = {
  ok: boolean;
  conflict: boolean;
  currentVersion: number | null;
  currentHash: string | null;
  deleted: boolean;
};

export interface CloudApi {
  listFiles(vaultId: string): Promise<RemoteRow[]>;
  download(vaultId: string, row: RemoteRow, encoding: Encoding): Promise<string>;
  // Téléverse un objet ADRESSÉ PAR CONTENU (jamais la clé d'un autre fichier :
  // un put refusé n'écrase donc aucun objet existant) ; renvoie sa clé.
  upload(vaultId: string, hash: string, content: string, encoding: Encoding, relPath: string): Promise<string>;
  pushFile(
    vaultId: string,
    relPath: string,
    expectedVersion: number | null,
    hash: string,
    size: number,
    storagePath: string,
  ): Promise<LockResult>;
  tombstone(vaultId: string, relPath: string, expectedVersion: number | null, deviceId: string): Promise<LockResult>;
  restore(vaultId: string, relPath: string): Promise<LockResult>;
}

export interface CacheStore {
  read(key: string, encoding: Encoding): Promise<string | null>;
  write(key: string, content: string, encoding: Encoding): Promise<void>;
  size(): Promise<number>;
}

export type QueueOp =
  // storagePath : objet distant DÉJÀ présent (rename/move d'un fichier non
  // téléchargé) — rien à téléverser, le serveur réutilise l'objet.
  | { id: string; kind: 'put'; relPath: string; baseVersion: number | null; hash: string; size: number; encoding: Encoding; at: number; storagePath?: string }
  | { id: string; kind: 'tombstone'; relPath: string; baseVersion: number | null; at: number }
  | { id: string; kind: 'restore'; relPath: string; at: number };

export type CloudConflict = {
  relPath: string;
  conflictCopy: string | null;
  localHash: string | null;
  remoteHash: string | null;
  remoteVersion: number | null;
  reason: 'version' | 'suppression-refusee';
  at: string;
};

type CachedEntry = { hash: string; size: number; encoding: Encoding; at: number };

export type VaultCacheState = {
  version: 1;
  vaultId: string;
  manifest: Record<string, RemoteRow>;
  manifestAt: string | null;
  cached: Record<string, CachedEntry>;
  folders: string[];
  queue: QueueOp[];
  conflicts: CloudConflict[];
};

export type CloudVaultHelpers = {
  buildTree: (index: Map<string, { isDirectory: boolean }>) => VaultTreeNode[];
  findAvailableName: (name: string, siblings: Set<string>) => string;
  defaultContentForKind: (kind: VaultEntryKind, title: string) => string;
  extensionForKind: Record<VaultEntryKind, string>;
  knownContentExts: string[];
  extensionKind: (name: string) => VaultEntryKind | null;
  baseNameOf: (name: string) => string;
  isBinary: (relPath: string) => boolean;
  listTags?: (notes: { relPath: string; content: string }[]) => TagGroup[];
  pickAttachment?: () => Promise<{ name: string; base64: string } | null>;
};

export type CloudVaultDeps = {
  api: CloudApi;
  cache: CacheStore;
  hash: (content: string, encoding: Encoding) => { hash: string; size: number };
  // Coffre actif : id local (registre) + id distant. null = aucun coffre lié.
  getActive: () => Promise<{ localId: string; remoteVaultId: string; name: string } | null>;
  deviceId: () => Promise<string>;
  deviceName?: () => Promise<string>;
  confirm: (title: string, message: string) => Promise<boolean>;
  helpers: CloudVaultHelpers;
  now?: () => number;
  // Rejeu automatique de la file après une écriture (ms) ; 0 = immédiat, -1 = jamais (tests).
  flushDelayMs?: number;
  onChange?: () => void;
};

export const SYNCED_META_FILES_CLOUD = [
  '.123ecriture/appearance.json',
  '.123ecriture/tasks.json',
  '.123ecriture/tasklists.json',
  '.123ecriture/preferences.json',
];

export function normalizeCloudRelPath(relPath: string): string {
  return relPath
    .replace(/\\/g, '/')
    .split('/')
    .filter((s) => s && s !== '.')
    .join('/')
    .normalize('NFC');
}

// Clé de cache sûre (le chemin humain peut contenir émojis, accents, /).
export function cacheKeyForRelPath(relPath: string): string {
  const bytes = new TextEncoder().encode(relPath);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function isLocalOnlyMeta(relPath: string): boolean {
  return (relPath === '.123ecriture' || relPath.startsWith('.123ecriture/')) && !SYNCED_META_FILES_CLOUD.includes(relPath);
}

function isTrash(relPath: string): boolean {
  return relPath === '.trash' || relPath.startsWith('.trash/');
}

function parentOf(relPath: string): string {
  const i = relPath.lastIndexOf('/');
  return i >= 0 ? relPath.slice(0, i) : '';
}
function nameOf(relPath: string): string {
  return relPath.slice(relPath.lastIndexOf('/') + 1);
}
function join(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name;
}

export function isNetworkError(error: unknown): boolean {
  const msg = String((error as { message?: string })?.message ?? error).toLowerCase();
  return /network|fetch|timeout|délai|offline|hors ligne|failed to connect|unable to resolve|econn|aborted/.test(msg);
}

export function conflictCopyName(relPath: string, device: string, date: Date): string {
  const name = nameOf(relPath);
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  const stamp = date.toISOString().slice(0, 16).replace('T', ' ').replace(':', 'h');
  return join(parentOf(relPath), `${stem} (conflit ${device} ${stamp})${ext}`);
}

export type CloudCycleResult = {
  pushed: number;
  deleted: number;
  restored: number;
  conflicts: number;
  pending: number;
  errors: string[];
  offline: boolean;
};

export function createCloudVault(deps: CloudVaultDeps) {
  const now = deps.now ?? (() => Date.now());
  const h = deps.helpers;
  let state: VaultCacheState | null = null;
  let flushing: Promise<CloudCycleResult> | null = null;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let opSeq = 0;

  //////// État persisté par coffre (cache privé) ////////

  function stateKey(vaultId: string): string {
    return `vaults/${vaultId}/state.json`;
  }
  function fileKey(vaultId: string, relPath: string): string {
    return `vaults/${vaultId}/files/${cacheKeyForRelPath(relPath)}`;
  }
  function metaKey(localId: string, relPath: string): string {
    return `meta/${localId}/${cacheKeyForRelPath(relPath)}`;
  }

  async function active() {
    const a = await deps.getActive();
    if (!a) throw new Error('Aucun coffre cloud actif — connecte un coffre du compte (Réglages → Synchronisation).');
    return a;
  }

  async function load(): Promise<VaultCacheState> {
    const a = await active();
    if (state && state.vaultId === a.remoteVaultId) return state;
    const raw = await deps.cache.read(stateKey(a.remoteVaultId), 'utf8');
    let parsed: VaultCacheState | null = null;
    try {
      parsed = raw ? (JSON.parse(raw) as VaultCacheState) : null;
    } catch {
      parsed = null; // corrompu : on repart du cloud (le contenu en cache reste sur disque)
    }
    state = parsed && parsed.vaultId === a.remoteVaultId
      ? { ...parsed, folders: parsed.folders ?? [], conflicts: parsed.conflicts ?? [], queue: parsed.queue ?? [] }
      : { version: 1, vaultId: a.remoteVaultId, manifest: {}, manifestAt: null, cached: {}, folders: [], queue: [], conflicts: [] };
    return state;
  }

  async function save(s: VaultCacheState): Promise<void> {
    await deps.cache.write(stateKey(s.vaultId), JSON.stringify(s), 'utf8');
    deps.onChange?.();
  }

  //////// Vue effective = manifeste distant + file locale ////////

  function effective(s: VaultCacheState): Map<string, { hash: string; size: number }> {
    const out = new Map<string, { hash: string; size: number }>();
    for (const row of Object.values(s.manifest)) {
      if (!row.deleted) out.set(row.relPath, { hash: row.contentHash, size: row.sizeBytes });
    }
    for (const op of s.queue) {
      if (op.kind === 'put') out.set(op.relPath, { hash: op.hash, size: op.size });
      else if (op.kind === 'tombstone') out.delete(op.relPath);
      else if (op.kind === 'restore') {
        const row = s.manifest[op.relPath];
        if (row) out.set(op.relPath, { hash: row.contentHash, size: row.sizeBytes });
      }
    }
    return out;
  }

  function index(s: VaultCacheState): Map<string, { isDirectory: boolean }> {
    const idx = new Map<string, { isDirectory: boolean }>();
    const addParents = (p: string) => {
      let acc = '';
      for (const seg of parentOf(p).split('/').filter(Boolean)) {
        acc = join(acc, seg);
        idx.set(acc, { isDirectory: true });
      }
    };
    for (const p of effective(s).keys()) {
      if (isTrash(p) || p.startsWith('.123ecriture/')) continue;
      // Marqueur de dossier (folderMarker.ts) : rend le dossier visible,
      // même vide, sans jamais apparaître comme fichier.
      if (isFolderMarker(p)) {
        addParents(p);
        continue;
      }
      addParents(p);
      idx.set(p, { isDirectory: false });
    }
    for (const f of s.folders) {
      addParents(`${f}/x`);
    }
    return idx;
  }

  function siblings(s: VaultCacheState, parent: string): Set<string> {
    const out = new Set<string>();
    const prefix = parent ? `${parent}/` : '';
    for (const p of index(s).keys()) {
      if (!p.startsWith(prefix)) continue;
      const rest = p.slice(prefix.length);
      if (rest && !rest.includes('/')) out.add(rest);
    }
    return out;
  }

  function nextId(): string {
    opSeq += 1;
    return `${now().toString(36)}-${opSeq}`;
  }

  function scheduleFlush(): void {
    const delay = deps.flushDelayMs ?? 1500;
    if (delay < 0) return;
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(() => {
      flushTimer = null;
      void flush().catch(() => undefined);
    }, delay);
  }

  function enqueue(s: VaultCacheState, op: QueueOp): void {
    // Un put remplace le put en attente du même chemin (on garde SA version
    // de base : c'est la dernière version distante vue avant l'édition).
    if (op.kind === 'put') {
      const i = s.queue.findIndex((q) => q.kind === 'put' && q.relPath === op.relPath);
      if (i >= 0) {
        const prev = s.queue[i] as Extract<QueueOp, { kind: 'put' }>;
        s.queue.splice(i, 1);
        s.queue.push({ ...op, baseVersion: prev.baseVersion });
        return;
      }
    }
    s.queue.push(op);
  }

  function baseVersionOf(s: VaultCacheState, relPath: string): number | null {
    const row = s.manifest[relPath];
    return row && !row.deleted ? row.version : null;
  }

  //////// Lecture / écriture ////////

  async function read(relPathRaw: string, encoding: Encoding): Promise<string> {
    const relPath = normalizeCloudRelPath(relPathRaw);
    const a = await active();
    if (isLocalOnlyMeta(relPath)) {
      const v = await deps.cache.read(metaKey(a.localId, relPath), encoding);
      if (v === null) throw new Error(`« ${relPath} » est introuvable.`);
      return v;
    }
    const s = await load();
    const eff = effective(s).get(relPath);
    if (!eff) throw new Error(`« ${relPath} » est introuvable dans le coffre cloud.`);
    const cached = s.cached[relPath];
    if (cached && cached.hash === eff.hash) {
      const v = await deps.cache.read(fileKey(s.vaultId, relPath), encoding);
      if (v !== null) return v;
    }
    let row: RemoteRow | undefined = s.manifest[relPath];
    if (!row || row.deleted || row.contentHash !== eff.hash) {
      const op = [...s.queue].reverse().find((q) => q.kind === 'put' && q.relPath === relPath) as Extract<QueueOp, { kind: 'put' }> | undefined;
      row = op?.storagePath
        ? { relPath, version: 0, contentHash: op.hash, sizeBytes: op.size, updatedAt: '', deleted: false, storagePath: op.storagePath }
        : undefined;
    }
    if (!row) throw new Error(`« ${relPath} » n'est pas encore disponible hors ligne.`);
    const content = await deps.api.download(s.vaultId, row, encoding);
    await deps.cache.write(fileKey(s.vaultId, relPath), content, encoding);
    s.cached[relPath] = { hash: row.contentHash, size: row.sizeBytes, encoding, at: now() };
    await save(s);
    return content;
  }

  async function write(relPathRaw: string, content: string, encoding: Encoding): Promise<void> {
    const relPath = normalizeCloudRelPath(relPathRaw);
    if (!relPath) throw new Error('Chemin vide.');
    const a = await active();
    if (isLocalOnlyMeta(relPath)) {
      await deps.cache.write(metaKey(a.localId, relPath), content, encoding);
      return;
    }
    const s = await load();
    if (index(s).get(relPath)?.isDirectory) throw new Error(`« ${relPath} » est un dossier, pas une note.`);
    const { hash, size } = deps.hash(content, encoding);
    await deps.cache.write(fileKey(s.vaultId, relPath), content, encoding);
    s.cached[relPath] = { hash, size, encoding, at: now() };
    const eff = effective(s).get(relPath);
    if (!eff || eff.hash !== hash) {
      enqueue(s, { id: nextId(), kind: 'put', relPath, baseVersion: baseVersionOf(s, relPath), hash, size, encoding, at: now() });
    }
    await save(s);
    scheduleFlush();
  }

  // Copie d'un fichier vers un nouveau chemin (rename/move) : put SANS
  // version de base (création) — le serveur refuse si le chemin est pris.
  async function copyTo(s: VaultCacheState, from: string, to: string): Promise<void> {
    const enc: Encoding = h.isBinary(from) ? 'base64' : 'utf8';
    const eff = effective(s).get(from);
    const row = s.manifest[from];
    const cachedOk = eff && s.cached[from]?.hash === eff.hash;
    if (!cachedOk && eff && row && !row.deleted && row.contentHash === eff.hash && row.storagePath) {
      // Non téléchargé : on référence l'objet distant existant (hors ligne OK).
      enqueue(s, { id: nextId(), kind: 'put', relPath: to, baseVersion: null, hash: row.contentHash, size: row.sizeBytes, encoding: enc, at: now(), storagePath: row.storagePath });
      return;
    }
    const content = await read(from, enc);
    const { hash, size } = deps.hash(content, enc);
    await deps.cache.write(fileKey(s.vaultId, to), content, enc);
    s.cached[to] = { hash, size, encoding: enc, at: now() };
    enqueue(s, { id: nextId(), kind: 'put', relPath: to, baseVersion: null, hash, size, encoding: enc, at: now() });
  }

  function filesUnder(s: VaultCacheState, relPath: string): string[] {
    return [...effective(s).keys()].filter((p) => p === relPath || p.startsWith(`${relPath}/`));
  }

  async function relocate(fromRaw: string, toRaw: string): Promise<void> {
    const from = normalizeCloudRelPath(fromRaw);
    const to = normalizeCloudRelPath(toRaw);
    if (from === to) return;
    const s = await load();
    if (index(s).has(to)) throw new Error(`« ${to} » existe déjà — rien n'a été écrasé.`);
    const files = filesUnder(s, from);
    for (const f of files) await copyTo(s, f, to + f.slice(from.length));
    // Ancien chemin : tombstone RÉCUPÉRABLE, mise en file APRÈS les copies
    // (la file est rejouée dans l'ordre : jamais de suppression avant que la
    // copie ne soit acceptée — voir flush()).
    for (const f of files) {
      enqueue(s, { id: nextId(), kind: 'tombstone', relPath: f, baseVersion: baseVersionOf(s, f), at: now() });
    }
    s.folders = s.folders.map((d) => (d === from || d.startsWith(`${from}/`) ? to + d.slice(from.length) : d));
    await save(s);
    scheduleFlush();
  }

  //////// Rejeu de la file vers le cloud ////////

  async function refreshManifest(s: VaultCacheState): Promise<void> {
    const rows = await deps.api.listFiles(s.vaultId);
    const manifest: Record<string, RemoteRow> = {};
    for (const r of rows) manifest[normalizeCloudRelPath(r.relPath)] = { ...r, relPath: normalizeCloudRelPath(r.relPath) };
    s.manifest = manifest;
    s.manifestAt = new Date(now()).toISOString();
  }

  function applyResult(s: VaultCacheState, relPath: string, r: LockResult, patch?: Partial<RemoteRow>): void {
    const prev = s.manifest[relPath];
    s.manifest[relPath] = {
      relPath,
      version: r.currentVersion ?? prev?.version ?? 1,
      contentHash: r.currentHash ?? prev?.contentHash ?? '',
      sizeBytes: patch?.sizeBytes ?? prev?.sizeBytes ?? 0,
      updatedAt: new Date(now()).toISOString(),
      deleted: r.deleted,
      storagePath: patch?.storagePath ?? prev?.storagePath ?? null,
    };
  }

  async function runPut(s: VaultCacheState, op: Extract<QueueOp, { kind: 'put' }>, result: CloudCycleResult): Promise<void> {
    if (op.storagePath) {
      const r = await deps.api.pushFile(s.vaultId, op.relPath, op.baseVersion, op.hash, op.size, op.storagePath);
      if (r.ok) {
        applyResult(s, op.relPath, { ...r, currentHash: r.currentHash ?? op.hash }, { sizeBytes: op.size, storagePath: op.storagePath });
        result.pushed += 1;
      } else {
        // Destination prise entre-temps : on ne touche à rien ; la source
        // reste (sa tombstone sera refusée plus bas si elle dépend de ça).
        s.conflicts.push({ relPath: op.relPath, conflictCopy: null, localHash: op.hash, remoteHash: r.currentHash, remoteVersion: r.currentVersion, reason: 'version', at: new Date(now()).toISOString() });
        result.conflicts += 1;
        // Ne pas perdre la source : retirer les tombstones en file du même contenu.
        s.queue = s.queue.filter((q) => !(q.kind === 'tombstone' && s.manifest[q.relPath]?.storagePath === op.storagePath));
      }
      return;
    }
    const content = await deps.cache.read(fileKey(s.vaultId, op.relPath), op.encoding);
    if (content === null) {
      result.errors.push(`${op.relPath} : contenu local introuvable dans le cache — opération abandonnée.`);
      return;
    }
    const { hash, size } = deps.hash(content, op.encoding);
    const storagePath = await deps.api.upload(s.vaultId, hash, content, op.encoding, op.relPath);
    let r = await deps.api.pushFile(s.vaultId, op.relPath, op.baseVersion, hash, size, storagePath);
    // Création sur une ancienne tombstone : action explicite de
    // l'utilisatrice → restore_file puis mise à jour sur la version rendue.
    if (!r.ok && r.deleted && op.baseVersion === null) {
      const rr = await deps.api.restore(s.vaultId, op.relPath);
      if (rr.ok && rr.currentVersion !== null) {
        r = await deps.api.pushFile(s.vaultId, op.relPath, rr.currentVersion, hash, size, storagePath);
      }
    }
    if (r.ok) {
      applyResult(s, op.relPath, { ...r, currentHash: r.currentHash ?? hash }, { sizeBytes: size, storagePath });
      result.pushed += 1;
      return;
    }
    // CONFLIT : le cloud a une autre version. Elle reste au chemin d'origine ;
    // la version locale part à côté, sous un nom « (conflit …) ».
    const device = deps.deviceName ? await deps.deviceName() : 'Android';
    let copy = conflictCopyName(op.relPath, device, new Date(now()));
    const taken = new Set(Object.keys(s.manifest));
    for (let n = 2; taken.has(copy); n += 1) copy = conflictCopyName(op.relPath, `${device} ${n}`, new Date(now()));
    const rc = await deps.api.pushFile(s.vaultId, copy, null, hash, size, storagePath);
    if (rc.ok) {
      await deps.cache.write(fileKey(s.vaultId, copy), content, op.encoding);
      s.cached[copy] = { hash, size, encoding: op.encoding, at: now() };
      applyResult(s, copy, { ...rc, currentHash: rc.currentHash ?? hash }, { sizeBytes: size, storagePath });
    }
    delete s.cached[op.relPath]; // le cache de ce chemin n'est plus la version cloud
    s.conflicts.push({
      relPath: op.relPath,
      conflictCopy: rc.ok ? copy : null,
      localHash: hash,
      remoteHash: r.currentHash,
      remoteVersion: r.currentVersion,
      reason: 'version',
      at: new Date(now()).toISOString(),
    });
    result.conflicts += 1;
  }

  async function runOp(s: VaultCacheState, op: QueueOp, result: CloudCycleResult): Promise<void> {
    if (op.kind === 'put') return runPut(s, op, result);
    if (op.kind === 'restore') {
      const r = await deps.api.restore(s.vaultId, op.relPath);
      if (r.ok) {
        applyResult(s, op.relPath, r);
        result.restored += 1;
      } else result.errors.push(`${op.relPath} : restauration refusée (le chemin est occupé).`);
      return;
    }
    const r = await deps.api.tombstone(s.vaultId, op.relPath, op.baseVersion, await deps.deviceId());
    if (r.ok) {
      applyResult(s, op.relPath, { ...r, deleted: true });
      result.deleted += 1;
      return;
    }
    // Modifié ailleurs depuis : la suppression est ANNULÉE (jamais perdre
    // le travail d'un autre appareil) — le fichier réapparaît.
    s.conflicts.push({
      relPath: op.relPath,
      conflictCopy: null,
      localHash: null,
      remoteHash: r.currentHash,
      remoteVersion: r.currentVersion,
      reason: 'suppression-refusee',
      at: new Date(now()).toISOString(),
    });
    result.conflicts += 1;
  }

  async function flushOnce(): Promise<CloudCycleResult> {
    const s = await load();
    const result: CloudCycleResult = { pushed: 0, deleted: 0, restored: 0, conflicts: 0, pending: 0, errors: [], offline: false };
    // Les copies d'un déplacement doivent réussir AVANT la tombstone de
    // l'ancien chemin : un put en échec (hors réseau) arrête la file.
    while (s.queue.length > 0) {
      const op = s.queue[0];
      try {
        await runOp(s, op, result);
        s.queue.shift();
        await save(s);
      } catch (error) {
        if (isNetworkError(error)) {
          result.offline = true;
          break;
        }
        // Erreur non réseau : on journalise et on garde l'op en file pour un
        // nouvel essai au prochain cycle (aucune perte), sans bloquer celles
        // qui ne dépendent pas d'elle.
        result.errors.push(`${op.relPath} : ${String((error as Error)?.message ?? error)}`);
        break;
      }
    }
    if (!result.offline) {
      try {
        await refreshManifest(s);
        await save(s);
      } catch (error) {
        if (isNetworkError(error)) result.offline = true;
        else result.errors.push(`catalogue cloud : ${String((error as Error)?.message ?? error)}`);
      }
    }
    result.pending = s.queue.length;
    return result;
  }

  function flush(): Promise<CloudCycleResult> {
    if (!flushing) flushing = flushOnce().finally(() => (flushing = null));
    return flushing;
  }

  //////// Le contrat VaultBridge ////////

  async function stateValue<T>(key: string, fallback: T): Promise<T> {
    try {
      const parsed = JSON.parse(await read('.123ecriture/state.json', 'utf8')) as Record<string, unknown>;
      return (parsed[key] as T) ?? fallback;
    } catch {
      return fallback;
    }
  }
  async function patchState(patch: Record<string, unknown>): Promise<void> {
    let cur: Record<string, unknown> = {};
    try {
      cur = JSON.parse(await read('.123ecriture/state.json', 'utf8')) as Record<string, unknown>;
    } catch {
      cur = {};
    }
    await write('.123ecriture/state.json', JSON.stringify({ ...cur, ...patch }), 'utf8');
  }

  const adapter: VaultBridge = {
    chooseFolder: async () => {
      const a = await deps.getActive();
      return a ? `cloud://${a.remoteVaultId}` : null;
    },
    getCurrentPath: async () => {
      const a = await deps.getActive();
      return a ? `cloud://${a.remoteVaultId}` : null;
    },
    rescan: async () => {
      await flush();
    },
    listTree: async () => {
      const s = await load();
      if (!s.manifestAt) {
        try {
          await refreshManifest(s);
          await save(s);
        } catch (error) {
          if (!isNetworkError(error)) throw error;
        }
      }
      return h.buildTree(index(s));
    },
    readNote: (p) => read(p, 'utf8'),
    writeNote: (p, c) => write(p, c, 'utf8'),
    readNoteBinary: (p) => read(p, 'base64'),
    writeNoteBinary: (p, c) => write(p, c, 'base64'),

    createNote: async (name, parentRelPath, kind = 'markdown') => {
      const s = await load();
      const parent = normalizeCloudRelPath(parentRelPath ?? '');
      const ext = h.extensionForKind[kind];
      const base = h.knownContentExts.some((k) => name.toLowerCase().endsWith(k)) ? name : `${name}${ext}`;
      const finalName = h.findAvailableName(base, siblings(s, parent));
      const finalExt = h.knownContentExts.find((k) => finalName.toLowerCase().endsWith(k)) ?? ext;
      const relPath = join(parent, finalName);
      await write(relPath, h.defaultContentForKind(kind, finalName.slice(0, finalName.length - finalExt.length)), 'utf8');
      return { relPath, name: h.baseNameOf(finalName), modifiedAt: now(), kind };
    },

    createFolder: async (name, parentRelPath) => {
      const s = await load();
      const parent = normalizeCloudRelPath(parentRelPath ?? '');
      const finalName = h.findAvailableName(name, siblings(s, parent));
      const relPath = join(parent, finalName);
      // Dossier de PREMIÈRE CLASSE : visible tout de suite (cache), et son
      // marqueur vide part dans la file → le dossier existe aussi sur les
      // autres appareils, même vide.
      s.folders.push(relPath);
      await save(s);
      await write(folderToMarker(relPath), '', 'utf8');
      return { relPath, name: finalName };
    },

    rename: async (relPathRaw, newName) => {
      const relPath = normalizeCloudRelPath(relPathRaw);
      const s = await load();
      const isDir = index(s).get(relPath)?.isDirectory ?? false;
      const name = nameOf(relPath);
      const hadExt = isDir ? undefined : h.knownContentExts.find((k) => name.toLowerCase().endsWith(k));
      const carries = h.knownContentExts.some((k) => newName.toLowerCase().endsWith(k));
      const candidate = hadExt && !carries ? `${newName}${hadExt}` : newName;
      if (candidate === name) return { relPath, name: h.baseNameOf(name) };
      const sib = siblings(s, parentOf(relPath));
      sib.delete(name);
      const finalName = h.findAvailableName(candidate, sib);
      const target = join(parentOf(relPath), finalName);
      await relocate(relPath, target);
      return { relPath: target, name: isDir ? finalName : h.baseNameOf(finalName) };
    },

    move: async (relPathRaw, destinationParentRelPath) => {
      const relPath = normalizeCloudRelPath(relPathRaw);
      const dest = normalizeCloudRelPath(destinationParentRelPath ?? '');
      if (dest === relPath || dest.startsWith(`${relPath}/`)) throw new Error('Impossible de déplacer un dossier dans lui-même.');
      const s = await load();
      const isDir = index(s).get(relPath)?.isDirectory ?? false;
      const finalName = h.findAvailableName(nameOf(relPath), siblings(s, dest));
      const target = join(dest, finalName);
      await relocate(relPath, target);
      return { relPath: target, name: isDir ? finalName : h.baseNameOf(finalName) };
    },

    setPath: async (relPathRaw, newRelPathRaw) => {
      const relPath = normalizeCloudRelPath(relPathRaw);
      const target = normalizeCloudRelPath(newRelPathRaw);
      if (relPath.startsWith('.trash/')) {
        // Restauration depuis la corbeille cloud.
        await cloudSync.restore(relPath);
        return { relPath: relPath.slice('.trash/'.length), name: h.baseNameOf(nameOf(relPath)) };
      }
      await relocate(relPath, target);
      return { relPath: target, name: h.baseNameOf(nameOf(target)) };
    },

    delete: async (relPathRaw, options) => {
      const relPath = normalizeCloudRelPath(relPathRaw);
      const s = await load();
      const isDir = index(s).get(relPath)?.isDirectory ?? false;
      if (relPath.startsWith('.trash/') || options?.permanent) {
        // Destruction définitive : NON proposée sur Android (la corbeille
        // cloud se vide depuis le desktop) — jamais de perte depuis le mobile.
        return { deleted: false };
      }
      if (!options?.silent) {
        const ok = await deps.confirm(
          isDir ? 'Supprimer ce dossier ?' : 'Supprimer cette note ?',
          isDir
            ? `« ${nameOf(relPath)} » et tout son contenu iront dans la corbeille du coffre cloud (récupérable).`
            : `« ${nameOf(relPath)} » ira dans la corbeille du coffre cloud (récupérable).`,
        );
        if (!ok) return { deleted: false };
      }
      for (const f of filesUnder(s, relPath)) {
        enqueue(s, { id: nextId(), kind: 'tombstone', relPath: f, baseVersion: baseVersionOf(s, f), at: now() });
      }
      s.folders = s.folders.filter((d) => d !== relPath && !d.startsWith(`${relPath}/`));
      await save(s);
      scheduleFlush();
      return { deleted: true };
    },

    listTrash: async () => {
      const s = await load();
      const live = effective(s);
      return Object.values(s.manifest)
        .filter((r) => r.deleted && !live.has(r.relPath) && !isTrash(r.relPath))
        .map((r) => ({ relPath: `.trash/${r.relPath}`, sizeBytes: r.sizeBytes, modifiedAt: r.updatedAt }))
        .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
    },

    getLastOpened: () => stateValue<string | null>('lastOpenedRelPath', null),
    setLastOpened: (relPath) => patchState({ lastOpenedRelPath: relPath }),
    getCollapsedPaths: () => stateValue<string[]>('collapsedRelPaths', []),
    setCollapsedPaths: (relPaths) => patchState({ collapsedRelPaths: relPaths }),
    getOpenTabs: () => stateValue<string[]>('openTabRelPaths', []),
    setOpenTabs: (relPaths) => patchState({ openTabRelPaths: relPaths }),

    ensureDailyNote: async (dateIso) => {
      const relPath = `Journal/${dateIso}.mdx`;
      const s = await load();
      if (effective(s).has(relPath)) return { relPath, name: dateIso, modifiedAt: now(), kind: 'markdown' };
      return adapter.createNote(dateIso, 'Journal', 'markdown');
    },

    reorder: async () => adapter.listTree(),

    importAttachment: async () => {
      if (!h.pickAttachment) return null;
      const picked = await h.pickAttachment();
      if (!picked) return null;
      const s = await load();
      const folder = 'attachments';
      const name = h.findAvailableName(picked.name, siblings(s, folder));
      const relPath = join(folder, name);
      await write(relPath, picked.base64, 'base64');
      return { relPath, name };
    },

    readAttachmentDataUrl: async (relPath) => {
      const base64 = await read(relPath, 'base64');
      const ext = relPath.toLowerCase().split('.').pop() ?? '';
      const mime = ext === 'png' ? 'image/png' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : ext === 'svg' ? 'image/svg+xml' : 'application/octet-stream';
      return `data:${mime};base64,${base64}`;
    },

    duplicate: async (relPathRaw) => {
      const relPath = normalizeCloudRelPath(relPathRaw);
      const s = await load();
      if (index(s).get(relPath)?.isDirectory) throw new Error('Dupliquer un dossier n’est pas pris en charge sur Android.');
      const segment = nameOf(relPath);
      const kind = h.extensionKind(segment) ?? 'markdown';
      const ext = h.knownContentExts.find((k) => segment.toLowerCase().endsWith(k)) ?? h.extensionForKind[kind];
      const base = segment.slice(0, segment.length - ext.length);
      const sib = siblings(s, parentOf(relPath));
      let candidate = `${base} (copie)${ext}`;
      for (let n = 2; sib.has(candidate); n += 1) candidate = `${base} (copie ${n})${ext}`;
      const target = join(parentOf(relPath), candidate);
      await write(target, await read(relPath, 'utf8'), 'utf8');
      return { relPath: target, name: candidate.slice(0, candidate.length - ext.length), modifiedAt: now(), kind };
    },

    listTags: async () => {
      if (!h.listTags) return [];
      const s = await load();
      const notes: { relPath: string; content: string }[] = [];
      for (const p of effective(s).keys()) {
        if (h.extensionKind(p) !== 'markdown' || p.startsWith('.')) continue;
        // Hors ligne : seules les notes déjà en cache comptent (pas de rafale de téléchargements).
        const c = s.cached[p];
        if (!c || c.hash !== effective(s).get(p)?.hash) continue;
        const content = await deps.cache.read(fileKey(s.vaultId, p), 'utf8');
        if (content !== null) notes.push({ relPath: p, content });
      }
      return h.listTags(notes);
    },
  };

  const cloudSync = {
    flush,
    refresh: async () => {
      const s = await load();
      await refreshManifest(s);
      await save(s);
    },
    restore: async (trashRelPath: string) => {
      const relPath = normalizeCloudRelPath(trashRelPath.replace(/^\.trash\//, ''));
      const s = await load();
      if (effective(s).has(relPath)) throw new Error(`« ${relPath} » existe déjà — restauration refusée pour ne rien écraser.`);
      enqueue(s, { id: nextId(), kind: 'restore', relPath, at: now() });
      await save(s);
      await flush();
      return relPath;
    },
    // Résumé pour l'écran Synchronisation et l'inventaire appareil.
    status: async () => {
      const s = await load();
      const eff = effective(s);
      const cachedCount = [...eff.entries()].filter(([p, e]) => s.cached[p]?.hash === e.hash).length;
      return {
        vaultId: s.vaultId,
        files: eff.size,
        cached: cachedCount,
        pending: s.queue.length,
        conflicts: s.conflicts,
        manifestAt: s.manifestAt,
        cacheBytes: await deps.cache.size().catch(() => 0),
      };
    },
    // Inventaire de l'appareil = ce que le CACHE contient (chemin + hash).
    inventory: async () => {
      const s = await load();
      return Object.entries(s.cached).map(([relPath, c]) => ({ relPath, contentHash: c.hash, sizeBytes: c.size, modifiedAt: c.at }));
    },
    dismissConflict: async (relPath: string) => {
      const s = await load();
      s.conflicts = s.conflicts.filter((c) => c.relPath !== relPath);
      await save(s);
    },
    // Télécharge tout le coffre dans le cache (lecture hors ligne).
    prefetchAll: async (onProgress?: (done: number, total: number) => void) => {
      const s = await load();
      const todo = [...effective(s).entries()].filter(([p, e]) => s.cached[p]?.hash !== e.hash && s.manifest[p]);
      let done = 0;
      for (const [p] of todo) {
        await read(p, h.isBinary(p) ? 'base64' : 'utf8').catch(() => undefined);
        done += 1;
        onProgress?.(done, todo.length);
      }
      return done;
    },
    // Import unique : publie un fichier lu ailleurs (ancien dossier SAF) comme
    // CRÉATION (version de base nulle) — jamais d'écrasement côté cloud.
    importFile: async (relPathRaw: string, content: string, encoding: Encoding) => {
      const relPath = normalizeCloudRelPath(relPathRaw);
      const s = await load();
      if (!s.manifestAt) await refreshManifest(s); // import = en ligne : on connaît l'existant
      if (effective(s).has(relPath)) return 'exists' as const;
      const { hash, size } = deps.hash(content, encoding);
      await deps.cache.write(fileKey(s.vaultId, relPath), content, encoding);
      s.cached[relPath] = { hash, size, encoding, at: now() };
      enqueue(s, { id: nextId(), kind: 'put', relPath, baseVersion: null, hash, size, encoding, at: now() });
      await save(s);
      return 'queued' as const;
    },
    // Remise à zéro de l'état mémoire (changement de coffre actif).
    reset: () => {
      state = null;
    },
  };

  return { adapter, cloudSync };
}

export type CloudSyncHandle = ReturnType<typeof createCloudVault>['cloudSync'];
