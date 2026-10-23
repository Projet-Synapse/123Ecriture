// ✒️ 123ECRITURE — lib/sync/conflictResolver.ts — exécution d'une décision de conflit
// Traduit le plan de conflictQueue.planResolution en écritures via le pont
// du coffre (vault-fs sur Android) : rien n'est écrit avant que l'humain ait
// choisi ; une fusion qui laisse des chevauchements est REFUSÉE (erreur
// visible), jamais écrite.

import { tryThreeWayMerge } from './merge';
import { planResolution, type ConflictAction, type ConflictDecision, type PendingConflict } from './conflictQueue';

export type ResolverDeps = {
  vault: Pick<VaultBridge, 'readNote' | 'writeNote' | 'delete' | 'readNoteBinary' | 'writeNoteBinary'>;
  isBinary: (relPath: string) => boolean;
  downloadText: (remoteVaultId: string, relPath: string, objectPath?: string) => Promise<string>;
  downloadBinary: (remoteVaultId: string, relPath: string, objectPath?: string) => Promise<string>;
  loadBase: (relPath: string) => Promise<string | null>;
  saveBase: (relPath: string, content: string) => Promise<void>;
  setReference: (relPath: string, contentHash: string) => Promise<void>;
  ignoreRemote: (relPath: string, contentHash: string) => void;
  markDirty?: (relPath: string) => void;
  // Copie cachée (.123ecriture/conflits/…, hors synchro) de la version écrasée.
  backup?: (relPath: string, content: string) => Promise<void>;
};

async function readIncoming(c: PendingConflict, deps: ResolverDeps, binary: boolean): Promise<string> {
  if (c.origin === 'pull') {
    if (!c.incoming.remoteVaultId) throw new Error('Coffre distant inconnu pour ce conflit.');
    return binary
      ? deps.downloadBinary(c.incoming.remoteVaultId, c.incoming.relPath, c.incoming.storageObjectPath)
      : deps.downloadText(c.incoming.remoteVaultId, c.incoming.relPath, c.incoming.storageObjectPath);
  }
  const source = c.origin === 'import' ? c.incoming.stagedRelPath : c.incoming.relPath;
  if (!source) throw new Error('Copie importée introuvable.');
  if (binary) {
    if (!deps.vault.readNoteBinary) throw new Error('Lecture binaire indisponible.');
    return deps.vault.readNoteBinary(source);
  }
  return deps.vault.readNote(source);
}

async function runAction(c: PendingConflict, action: ConflictAction, deps: ResolverDeps): Promise<void> {
  const binary = !c.isText || deps.isBinary(c.existing.relPath);
  switch (action.type) {
    case 'merge': {
      const incoming = await readIncoming(c, deps, false);
      const local = await deps.vault.readNote(action.target);
      const base = (await deps.loadBase(action.target)) ?? '';
      const merged = tryThreeWayMerge(base, local, incoming);
      if (merged.kind !== 'merged' || !merged.clean) {
        throw new Error('Fusion impossible : les deux versions modifient les mêmes passages. Choisissez Renommer, Remplacer ou Garder les deux.');
      }
      if (deps.backup) await deps.backup(action.target, local);
      await deps.vault.writeNote(action.target, merged.text);
      if (c.origin === 'pull') await deps.saveBase(action.target, incoming);
      deps.markDirty?.(action.target);
      return;
    }
    case 'write-incoming': {
      const content = await readIncoming(c, deps, binary);
      if (!binary && deps.backup && action.to === c.existing.relPath && c.existing.sizeBytes !== null) {
        const previous = await deps.vault.readNote(action.to).catch(() => null);
        if (previous !== null) await deps.backup(action.to, previous);
      }
      if (binary) {
        if (!deps.vault.writeNoteBinary) throw new Error('Écriture binaire indisponible.');
        await deps.vault.writeNoteBinary(action.to, content);
      } else {
        await deps.vault.writeNote(action.to, content);
        if (c.origin === 'pull' && action.to === c.existing.relPath) await deps.saveBase(action.to, content);
      }
      deps.markDirty?.(action.to);
      return;
    }
    case 'trash':
      await deps.vault.delete(action.relPath, { silent: true });
      return;
    case 'drop-staged':
      if (c.incoming.stagedRelPath) await deps.vault.delete(c.incoming.stagedRelPath, { silent: true, permanent: true });
      return;
    case 'adopt-remote-reference':
      await deps.setReference(action.relPath, action.contentHash);
      return;
    case 'ignore-remote':
      deps.ignoreRemote(action.relPath, action.contentHash);
      return;
  }
}

export async function resolveConflict(
  c: PendingConflict,
  decision: ConflictDecision,
  taken: Iterable<string>,
  deps: ResolverDeps,
): Promise<ConflictAction[]> {
  const plan = planResolution(c, decision, taken);
  for (const action of plan) await runAction(c, action, deps);
  return plan;
}
