// ✒️ 123ECRITURE — lib/sync/editQuiet.ts — période de silence « fichier en cours d'édition »
//////////////////////////////////////////////////////////////////////////////
//
// Un fichier modifié il y a moins de SYNC_EDIT_QUIET_MS est peut-être
// OUVERT dans un éditeur (l'app, Obsidian, n'importe lequel — seul
// l'horodatage du fichier compte). Sans cette garde, la surveillance du
// coffre relance un cycle pendant la frappe : chaque cycle reprend le
// fichier à moitié écrit, le déclare en conflit et l'archive — un conflit
// à chaque frappe.
//
// Invariants du fichier :
//   • Un fichier « chaud » (modifié trop récemment) est SORTI du cycle :
//     ni poussé, ni écrasé par un pull, ni archivé comme perdant de
//     conflit. Une fois silencieux (fermé, ou frappe arrêtée), le cycle
//     suivant le synchronise normalement.
//   • Un horodatage FUTUR (horloge de l'appareil décalée en avant) n'est
//     JAMAIS chaud : un fichier ne doit pas rester bloqué éternellement à
//     cause d'une horloge fausse — il est traité comme froid et
//     synchronisé normalement.
//
// SOMMAIRE :
//   1. Le seuil et le test « chaud » (SYNC_EDIT_QUIET_MS, isEditHot)
//   2. Le partage froid/chaud des notes du cycle (splitEditHot)
//
//////////////////////////////////////////////////////////////////////////////

//////// 1. Le seuil et le test « chaud » (SYNC_EDIT_QUIET_MS, isEditHot) ///////////

import { SYNCED_META_FILES } from './syncRules';

export const SYNC_EDIT_QUIET_MS = 60_000;
// Métadonnées synchronisées (tâches, listes, préférences, apparence) :
// jamais « tapées » dans un éditeur, écrites d'un bloc par l'app — 5 s
// suffisent à absorber une rafale d'écritures (création + réordonnancement)
// sans retarder d'une minute l'envoi d'une tâche.
export const SYNC_META_EDIT_QUIET_MS = 5_000;

export function editQuietMsFor(relPath: string): number {
  return SYNCED_META_FILES.includes(relPath.split('\\').join('/')) ? SYNC_META_EDIT_QUIET_MS : SYNC_EDIT_QUIET_MS;
}

// « Chaud » = modifié trop récemment pour être synchronisé sans risque.
// Un horodatage FUTUR (horloge de l'appareil décalée en avant) n'est JAMAIS
// chaud : un fichier ne doit pas rester bloqué éternellement à cause d'une
// horloge fausse — il est traité comme froid et synchronisé normalement.
export function isEditHot(modifiedAt: number, nowMs: number, quietMs: number = SYNC_EDIT_QUIET_MS): boolean {
  const age = nowMs - modifiedAt;
  return age >= 0 && age < quietMs;
}

//////// 2. Le partage froid/chaud des notes du cycle (splitEditHot) ///////////

// Partage les notes locales du cycle en « froides » (synchronisables) et
// « chaudes » (différées — on ne garde que leurs chemins pour les gardes
// pull/conflict du même cycle).
export function splitEditHot<T extends { relPath: string; modifiedAt: number }>(
  files: T[],
  nowMs: number,
): { cold: T[]; hotPaths: Set<string> } {
  const cold: T[] = [];
  const hotPaths = new Set<string>();
  for (const file of files) {
    if (isEditHot(file.modifiedAt, nowMs, editQuietMsFor(file.relPath))) hotPaths.add(file.relPath);
    else cold.push(file);
  }
  return { cold, hotPaths };
}

// DATE DE MODIFICATION RÉELLE (mtime de l'index du coffre). Avant :
// Date.now() pour TOUS les fichiers, donc à chaque cycle les 435 fichiers
// paraissaient « modifiés il y a 0 s » → tous « en cours d'édition »
// (editQuiet.ts) → sortis du plan : 0 envoyé, 0 reçu, à vie. Inconnue →
// 0 = « ancien » (froid, synchronisable), jamais « maintenant ».
// + la DERNIÈRE ÉCRITURE PAR L'APP (éditeur, pull) : la garde 60 s reste
// active même si l'index n'a pas de mtime (chemin SAF hérité).
const recentLocalWrites = new Map<string, number>();
export function noteLocalWrite(relPath: string, nowMs: number = Date.now()): void {
  recentLocalWrites.set(relPath.split('\\').join('/'), nowMs);
}
// Instant (ms) où TOUS les fichiers chauds seront silencieux (+1 s de marge).
export function quietRetryAt(files: { relPath: string; modifiedAt: number }[], hotPaths: Set<string>): number | undefined {
  let latest = 0;
  for (const f of files) {
    if (!hotPaths.has(f.relPath) || !(f.modifiedAt > 0)) continue;
    const quietAt = f.modifiedAt + editQuietMsFor(f.relPath);
    if (quietAt > latest) latest = quietAt;
  }
  return latest > 0 ? latest + 1_000 : undefined;
}

//////// 3. La base des fichiers chauds (preserveHotBases) ///////////

// Un fichier CHAUD est sorti du cycle : il n'a été ni poussé ni tiré. Sa
// base (sync-state) doit donc rester la DERNIÈRE VERSION SYNCHRONISÉE, pas
// son hash actuel. Sinon le cycle suivant voit « local = base, cloud ≠
// base » → pull « modifié ailleurs » qui ÉCRASE la modif jamais envoyée
// (incident du 26/10 : tâche créée sur LORDI qui disparaît). Jamais vu
// synchronisé (pas d'ancienne base) → aucune entrée : le cycle suivant le
// traite en nouveau fichier (push, ou conflit si le cloud l'a aussi) —
// jamais en suppression, puisqu'il est toujours sur le disque.
export function preserveHotBases(
  nextFiles: Record<string, string>,
  hotPaths: Iterable<string>,
  previousFiles: Record<string, string>,
): Record<string, string> {
  for (const relPath of hotPaths) {
    if (relPath in previousFiles) nextFiles[relPath] = previousFiles[relPath];
    else delete nextFiles[relPath];
  }
  return nextFiles;
}

export function indexedModifiedAt(entry: unknown, relPath?: string): number {
  const mtime = (entry as { mtime?: unknown } | undefined)?.mtime;
  const fromIndex = typeof mtime === 'number' && Number.isFinite(mtime) && mtime > 0 ? mtime : 0;
  const written = relPath ? (recentLocalWrites.get(relPath) ?? 0) : 0;
  return Math.max(fromIndex, written);
}
