// ✒️ 123ECRITURE — lib/sync/conflictStore.ts — file de conflits persistée + abonnements UI
// La file vit dans le coffre (.123ecriture/pending-conflicts.json) : elle
// survit à un redémarrage et suit le coffre. Les écritures sont sérialisées.

import {
  decisionsForAll,
  enqueueConflict,
  frozenPaths,
  parseConflictQueue,
  PENDING_CONFLICTS_REL_PATH,
  removeConflict,
  type ConflictDecision,
  type ConflictQueue,
  type PendingConflict,
} from './conflictQueue';
import { resolveConflict, type ResolverDeps } from './conflictResolver';

type Listener = (queue: ConflictQueue) => void;

export type ConflictStoreIO = {
  read: () => Promise<string | null>;
  write: (raw: string) => Promise<void>;
  resolverDeps: () => Promise<ResolverDeps>;
  // Chemins existants (pour proposer « nom (2) » libre).
  takenPaths: () => Promise<string[]>;
};

export function createConflictStore(io: ConflictStoreIO) {
  let queue: ConflictQueue = { conflicts: [], ignoredRemote: {} };
  let loaded = false;
  let chain: Promise<unknown> = Promise.resolve();
  const listeners = new Set<Listener>();

  const emit = () => {
    for (const l of listeners) l(queue);
  };
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = chain.then(fn, fn);
    chain = next.catch(() => undefined);
    return next;
  };
  async function ensureLoaded() {
    if (loaded) return;
    queue = parseConflictQueue(await io.read().catch(() => null));
    loaded = true;
  }
  async function persist() {
    await io.write(JSON.stringify(queue, null, 2));
    emit();
  }

  return {
    subscribe(l: Listener): () => void {
      listeners.add(l);
      l(queue);
      return () => listeners.delete(l);
    },
    getQueue: () => queue,
    load: () =>
      serial(async () => {
        loaded = false;
        await ensureLoaded();
        emit();
        return queue;
      }),
    enqueue: (conflicts: PendingConflict[]) =>
      serial(async () => {
        await ensureLoaded();
        if (conflicts.length === 0) return queue;
        for (const c of conflicts) queue = enqueueConflict(queue, c);
        await persist();
        return queue;
      }),
    frozenPaths: async () => {
      await serial(ensureLoaded);
      return frozenPaths(queue);
    },
    ignoredRemote: async () => {
      await serial(ensureLoaded);
      return { ...(queue.ignoredRemote ?? {}) };
    },
    // Résout un conflit (et, si demandé, tous les restants avec le même choix).
    // Un échec laisse le conflit EN FILE et remonte l'erreur à la feuille.
    resolve: (id: string, decision: ConflictDecision, applyToAll = false) =>
      serial(async () => {
        await ensureLoaded();
        const first = queue.conflicts.find((c) => c.id === id);
        if (!first) return { resolved: 0, failed: [] as { id: string; message: string }[] };
        const deps = await io.resolverDeps();
        const ignored: Record<string, string> = {};
        const wrapped: ResolverDeps = { ...deps, ignoreRemote: (p, h) => (ignored[p] = h) };
        const targets = [{ conflict: first, decision }];
        if (applyToAll) {
          const rest = decisionsForAll(removeConflict(queue, id), decision);
          targets.push(...rest.apply);
        }
        const failed: { id: string; message: string }[] = [];
        let resolved = 0;
        const taken = new Set(await io.takenPaths().catch(() => []));
        for (const t of targets) {
          try {
            const plan = await resolveConflict(t.conflict, t.decision, taken, wrapped);
            for (const a of plan) if (a.type === 'write-incoming') taken.add(a.to);
            queue = removeConflict(queue, t.conflict.id);
            resolved += 1;
          } catch (error) {
            failed.push({ id: t.conflict.id, message: error instanceof Error ? error.message : String(error) });
          }
        }
        queue = { ...queue, ignoredRemote: { ...(queue.ignoredRemote ?? {}), ...ignored } };
        await persist();
        return { resolved, failed };
      }),
  };
}

export type ConflictStore = ReturnType<typeof createConflictStore>;

// Instance de l'app : branchée sur le pont du coffre actif (window.vault).
export const conflictStore = createConflictStore({
  read: async () => (typeof window !== 'undefined' && window.vault ? window.vault.readNote(PENDING_CONFLICTS_REL_PATH) : null),
  write: async (raw) => {
    if (typeof window === 'undefined' || !window.vault) return;
    await window.vault.writeNote(PENDING_CONFLICTS_REL_PATH, raw);
  },
  takenPaths: async () => {
    const walk = (nodes: VaultTreeNode[]): string[] =>
      nodes.flatMap((n) => [n.relPath, ...('children' in n && n.children ? walk(n.children) : [])]);
    return typeof window !== 'undefined' && window.vault ? walk(await window.vault.listTree()) : [];
  },
  resolverDeps: async () => {
    const cloud = await import('./cloud');
    const engine = await import('./syncEngine');
    const vault = window.vault;
    if (!vault) throw new Error('Aucun coffre ouvert.');
    return {
      vault,
      isBinary: cloud.isBinaryAttachmentRelPath,
      downloadText: cloud.downloadRemoteText,
      downloadBinary: cloud.downloadRemoteBinary,
      loadBase: cloud.loadSyncBase,
      saveBase: cloud.saveSyncBase,
      setReference: async (relPath, contentHash) => {
        const state = await engine.loadSyncState();
        state.files[relPath] = contentHash;
        await engine.saveSyncState(state);
      },
      ignoreRemote: () => undefined,
      backup: engine.backupLosingSide,
    };
  },
});
