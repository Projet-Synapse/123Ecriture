// ✒️ 123ECRITURE — lib/sync/ownWrites.ts — écritures de l'app pendant la frappe (surveillance desktop)
//////////////////////////////////////////////////////////////////////////////
//
// Desktop : la surveillance du dossier (fs.watch, ponts-desktop/sync.ts)
// voit chaque sauvegarde automatique de la note EN COURS de frappe, et
// relançait un cycle de synchro complet ~2 s après chacune — pendant toute
// la frappe, un cycle toutes les 2-3 s sur le même fil que l'éditeur, alors
// que ce cycle DIFFÈRE justement ce fichier « chaud » (lib/sync/editQuiet,
// 60 s de silence exigés). Travail inutile, frappe ralentie ; Android n'a
// pas de surveillance de dossier, donc pas ce coût.
//
// Ici : l'éditeur note ses propres écritures ; un événement de surveillance
// qui ne porte QUE sur elles ne lance pas de cycle immédiat, mais un seul
// cycle « fin d'édition » quand la note redevient froide. Tout autre
// fichier modifié (autre app, Obsidian, explorateur) déclenche le cycle
// comme avant.
//
//////////////////////////////////////////////////////////////////////////////

import { SYNC_EDIT_QUIET_MS } from './editQuiet';

const ownWrites = new Map<string, number>();

function key(relPath: string): string {
  return relPath.replace(/\\/g, '/').replace(/^\/+/, '').normalize('NFC').toLowerCase();
}

// À appeler juste avant que l'app écrive une note qu'on est en train de taper.
export function noteOwnEdit(relPath: string, now: number = Date.now()): void {
  ownWrites.set(key(relPath), now);
  // Ménage : on ne garde que les écritures encore « chaudes ».
  for (const [k, at] of ownWrites) if (now - at > SYNC_EDIT_QUIET_MS * 2) ownWrites.delete(k);
}

// Partage des fichiers signalés par la surveillance : `others` = à
// synchroniser tout de suite ; `ownHotUntil` = date à laquelle la dernière
// de NOS écritures (signalée) redevient froide (null si aucune).
export function partitionWatchEvents(
  filenames: Iterable<string>,
  now: number = Date.now(),
  quietMs: number = SYNC_EDIT_QUIET_MS,
): { others: string[]; ownHotUntil: number | null } {
  const others: string[] = [];
  let ownHotUntil: number | null = null;
  for (const name of filenames) {
    const at = ownWrites.get(key(name));
    if (at !== undefined && now - at < quietMs) {
      ownHotUntil = Math.max(ownHotUntil ?? 0, at + quietMs);
    } else {
      others.push(name);
    }
  }
  return { others, ownHotUntil };
}

// Tests uniquement.
export function resetOwnWritesForTests(): void {
  ownWrites.clear();
}
