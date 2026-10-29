// ✒️ 123ECRITURE — lib/sync/linkGate.ts — quand le dialogue de fusion est OBLIGATOIRE
//
// Toute liaison à un coffre distant qui contient DÉJÀ des fichiers passe par
// le dialogue de fusion (MergeLinkDialog) : « Connecter » un coffre
// existant, « Créer un coffre distant » qui retombe sur un coffre existant
// (upsert owner_id+local_vault_id), « Reprendre la synchronisation » après
// une mise à jour. Seul un coffre distant VIDE (fraîchement créé) se lie
// directement. Compte inconnu (lecture échouée) = dialogue (prudence).

import type { RemoteVaultSummary } from './syncTypes';

export function needsMergeDialog(remoteFileCount: number | null | undefined): boolean {
  return remoteFileCount !== 0;
}

// Coffres liés (remoteVaultId) qui exigent le dialogue avant la reprise.
// `remotes` null = liste illisible → tous les coffres liés l'exigent.
export function remotesNeedingMerge(
  linkedRemoteIds: string[],
  remotes: Pick<RemoteVaultSummary, 'id' | 'fileCount'>[] | null,
): string[] {
  return linkedRemoteIds.filter((id) => needsMergeDialog(remotes ? (remotes.find((r) => r.id === id)?.fileCount ?? null) : null));
}
