// ✒️ 123ECRITURE — lib/sync/stateMigration.ts — migrations d'état de synchro (pures, testables)
//
// v2 (0.4.96-test.6) : l'index VaultFs pouvait être PARTIEL (ensureIndexed
// s'arrêtait sur un index rempli par une simple lecture). Des marqueurs de
// dossier ont pu entrer dans la base alors que le dossier n'existait pas
// ici. Au premier cycle v2, ces entrées sont RETIRÉES de la base : le
// moteur voit alors « nouveau dans le cloud » et RECRÉE le dossier, au lieu
// de le croire « supprimé ici » et de tombstoner le cloud.

import type { SyncPlan } from './threeWay';
import { isFolderMarker } from './folderMarker';

export const SYNC_STATE_VERSION = 2;

export function migrateSyncStateFiles(
  files: Record<string, string>,
  version: number | undefined,
  localMarkers: Set<string>,
): { files: Record<string, string>; dropped: string[] } {
  if ((version ?? 1) >= SYNC_STATE_VERSION) return { files, dropped: [] };
  const next: Record<string, string> = {};
  const dropped: string[] = [];
  for (const [relPath, hash] of Object.entries(files)) {
    if (isFolderMarker(relPath) && !localMarkers.has(relPath)) dropped.push(relPath);
    else next[relPath] = hash;
  }
  return { files: next, dropped };
}

// Tant que le premier parcours COMPLET du coffre n'a pas réussi, aucune
// suppression (fichier ou dossier, locale ou distante) n'est propagée :
// une absence dans un index partiel ne prouve rien.
export function holdDeletionsUntilIndexed(plan: SyncPlan, fullyIndexed: boolean): { plan: SyncPlan; held: string[] } {
  if (fullyIndexed) return { plan, held: [] };
  const held: string[] = [];
  const actions = plan.actions.filter((a) => {
    if (a.kind === 'delete-local' || a.kind === 'tombstone-remote') {
      held.push(a.relPath);
      return false;
    }
    return true;
  });
  return { plan: { ...plan, actions }, held };
}
