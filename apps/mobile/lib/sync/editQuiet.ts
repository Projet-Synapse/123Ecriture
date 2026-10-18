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

export const SYNC_EDIT_QUIET_MS = 60_000;

// « Chaud » = modifié trop récemment pour être synchronisé sans risque.
// Un horodatage FUTUR (horloge de l'appareil décalée en avant) n'est JAMAIS
// chaud : un fichier ne doit pas rester bloqué éternellement à cause d'une
// horloge fausse — il est traité comme froid et synchronisé normalement.
export function isEditHot(modifiedAt: number, nowMs: number): boolean {
  const age = nowMs - modifiedAt;
  return age >= 0 && age < SYNC_EDIT_QUIET_MS;
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
    if (isEditHot(file.modifiedAt, nowMs)) hotPaths.add(file.relPath);
    else cold.push(file);
  }
  return { cold, hotPaths };
}
