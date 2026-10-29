// ✒️ 123ECRITURE — lib/sync/safetyNet.ts — décisions pures du filet de sécurité
//////////////////////////////////////////////////////////////////////////////
//
// Logique PURE (testée sans pont ni réseau) partagée par cloud.ts et
// syncEngine.ts :
//   1. Archiver avant écrasement ? (shouldArchiveBeforeOverwrite, #191)
//   2. Suppressions distantes à mettre en revue (collectRemoteDeletionCandidates, #193)
//   3. Disjoncteur (shouldTripBreaker)
//
//////////////////////////////////////////////////////////////////////////////

import { isFolderMarker } from './folderMarker';
import { SYNC_ERROR_BLOCK_THRESHOLD, type RemoteDeletionReview } from './pendingReview';

//////// 1. Archiver avant écrasement ? ///////////////////////////////////////

export type ArchiveCandidate = { content_hash: string; storage_object_path: string | null; deleted?: boolean };

// Oui si une version distante existe avec un contenu DIFFÉRENT et qu'elle
// vit à l'emplacement que l'envoi va écraser (un chemin versionné `@hash`
// n'est jamais écrasé : rien à archiver). Une ligne tombstonée est archivée
// aussi : son objet Storage est toujours là et va être remplacé.
export function shouldArchiveBeforeOverwrite(current: ArchiveCandidate | null | undefined, nextHash: string): boolean {
  if (!current || !current.content_hash) return false;
  if (current.content_hash === nextHash) return false;
  if ((current.storage_object_path ?? '').includes('@')) return false;
  return true;
}

//////// 2. Suppressions distantes à mettre en revue //////////////////////////

// TOUTE pierre tombale venue d'un autre appareil dont le fichier existe
// encore ici part en revue — aucune suppression locale automatique. Les
// marqueurs de dossier ne sont pas concernés (un dossier vide n'est retiré
// que s'il ne contient rien).
export function collectRemoteDeletionCandidates(args: {
  tombstones: Map<string, { deletedByDevice?: string | null; deletedAt?: string | null; version?: number | null }>;
  local: Map<string, { contentHash: string }>;
  base: Record<string, string>;
  queuedAt: string;
}): { paths: Set<string>; candidates: RemoteDeletionReview[] } {
  const paths = new Set<string>();
  const candidates: RemoteDeletionReview[] = [];
  for (const [relPath, row] of args.tombstones) {
    if (isFolderMarker(relPath)) continue;
    const local = args.local.get(relPath);
    if (!local) continue;
    paths.add(relPath);
    candidates.push({
      path: relPath,
      modified: args.base[relPath] !== local.contentHash,
      at: args.queuedAt,
      deletedByDevice: row.deletedByDevice ?? null,
      deletedAt: row.deletedAt ?? null,
      remoteVersion: row.version ?? null,
    });
  }
  return { paths, candidates };
}

//////// 3. Disjoncteur ////////////////////////////////////////////////////////

export function shouldTripBreaker(errorCount: number): boolean {
  return errorCount >= SYNC_ERROR_BLOCK_THRESHOLD;
}
