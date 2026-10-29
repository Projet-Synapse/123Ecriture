// ✒️ 123ECRITURE — lib/sync/versionLock.ts — verrou optimiste (logique pure)
//////////////////////////////////////////////////////////////////////////////
//
// Contrat des RPC push_file / tombstone_file / restore_file
// (migration 20261023110000_vault_optimistic_lock.sql) et état de référence
// versionné. Logique PURE et testée (versionLock.test.ts).
//
// Invariants :
//   • Une écriture distante n'aboutit QUE si la version attendue est la
//     version courante : sinon refus structuré (conflict) — jamais
//     d'écrasement silencieux, jamais de résurrection d'une pierre tombale.
//   • Un ancien sync-state (sans `versions`) reste lisible : version
//     inconnue = comportement prudent (conflit plutôt qu'écrasement).
//
//////////////////////////////////////////////////////////////////////////////
import { isTrashRelPath } from './relPath';


export type LockResult = {
  ok: boolean;
  conflict: boolean;
  currentVersion: number | null;
  currentHash: string | null;
  deleted: boolean;
};

export class VersionConflictError extends Error {
  readonly relPath: string;
  readonly result: LockResult;
  constructor(relPath: string, result: LockResult) {
    super(
      `version distante plus récente (v${result.currentVersion ?? '?'}${result.deleted ? ', supprimé' : ''}) — rien écrasé`,
    );
    this.name = 'VersionConflictError';
    this.relPath = relPath;
    this.result = result;
  }
}

export function isVersionConflictError(error: unknown): error is VersionConflictError {
  return error instanceof VersionConflictError || (error as { name?: string } | null)?.name === 'VersionConflictError';
}

const asNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
  return null;
};

// Réponse jsonb de la RPC → LockResult. Réponse illisible = REFUS
// (prudence : on ne considère jamais un écrit comme accepté sans preuve).
export function parseLockResult(data: unknown): LockResult {
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null | undefined;
  if (!row || typeof row !== 'object') {
    return { ok: false, conflict: true, currentVersion: null, currentHash: null, deleted: false };
  }
  const ok = row.ok === true;
  return {
    ok,
    conflict: row.conflict === true || !ok,
    currentVersion: asNumber(row.current_version),
    currentHash: typeof row.current_hash === 'string' ? row.current_hash : null,
    deleted: row.deleted === true,
  };
}

// RPC absente (migration pas encore appliquée) : PostgREST PGRST202 ou
// Postgres 42883. Seul cas où le client retombe sur l'ancien chemin.
export function isMissingRpcError(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | null;
  if (!e) return false;
  if (e.code === 'PGRST202' || e.code === '42883') return true;
  return /could not find the function/i.test(e.message ?? '');
}

export type ParsedSyncState = {
  files: Record<string, string>;
  versions: Record<string, number>;
  rootPath: string | null;
};

// Lecture tolérante du sync-state : ancien format (files seuls) accepté,
// clés backslashed jetées, versions non numériques ignorées.
export function parseSyncState(raw: string): ParsedSyncState {
  const parsed = JSON.parse(raw) as { files?: Record<string, unknown>; versions?: Record<string, unknown>; rootPath?: string | null };
  const files: Record<string, string> = {};
  for (const [relPath, hash] of Object.entries(parsed.files ?? {})) {
    if (relPath.includes('\\') || typeof hash !== 'string') continue;
    // `.trash/` n'est plus synchronisé : ses anciennes références ne
    // doivent pas devenir des « suppressions locales » (tombstones).
    if (isTrashRelPath(relPath)) continue;
    files[relPath] = hash;
  }
  const versions: Record<string, number> = {};
  for (const [relPath, version] of Object.entries(parsed.versions ?? {})) {
    const n = asNumber(version);
    if (relPath.includes('\\') || n === null || !(relPath in files)) continue;
    versions[relPath] = n;
  }
  return { files, versions, rootPath: parsed.rootPath ?? null };
}

// Nouvel état de référence après un cycle. `keepPrevious` = chemins dont
// l'issue n'est PAS confirmée (échec, conflit de version, fichier en cours
// d'édition, tombstone annulée) : leur ancienne référence est CONSERVÉE
// telle quelle — sinon le cycle suivant prendrait le hash local pour la
// référence et une modification locale non poussée serait écrasée par un
// pull.
export function buildNextReference(args: {
  candidateFiles: Record<string, string>;
  previous: { files: Record<string, string>; versions: Record<string, number> };
  keepPrevious: Set<string>;
  pushedVersions: Record<string, number>;
  remoteVersions: Record<string, number | undefined>;
}): { files: Record<string, string>; versions: Record<string, number> } {
  const files: Record<string, string> = {};
  const versions: Record<string, number> = {};
  for (const [relPath, hash] of Object.entries(args.candidateFiles)) {
    if (args.keepPrevious.has(relPath)) continue;
    files[relPath] = hash;
    const v = args.pushedVersions[relPath] ?? args.remoteVersions[relPath];
    if (typeof v === 'number') versions[relPath] = v;
  }
  for (const relPath of args.keepPrevious) {
    const old = args.previous.files[relPath];
    if (old === undefined) continue;
    files[relPath] = old;
    const v = args.previous.versions[relPath];
    if (typeof v === 'number') versions[relPath] = v;
  }
  return { files, versions };
}
