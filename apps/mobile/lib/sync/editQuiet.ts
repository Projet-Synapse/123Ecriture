// Période de silence « fichier en cours d'édition » (v0.4.71) — incident du
// 17/10 : l'utilisatrice écrivait dans un fichier pendant que la
// surveillance du coffre relançait un cycle toutes les 2 s ; chaque cycle
// reprenait le fichier à moitié écrit, le déclarait en conflit et
// l'archivait — « un conflit à chaque frappe » (docs/vault-incidents.md §9).
//
// Principe (demande explicite de l'utilisatrice) : un fichier modifié il y
// a moins de SYNC_EDIT_QUIET_MS est peut-être OUVERT dans un éditeur (l'app,
// Obsidian, n'importe lequel — seul l'horodatage du fichier compte). Il est
// sorti du cycle : ni poussé, ni écrasé par un pull, ni archivé comme
// perdant de conflit. Une fois le fichier silencieux (fermé, ou frappe
// arrêtée), le cycle suivant le synchronise normalement.

export const SYNC_EDIT_QUIET_MS = 60_000;

// « Chaud » = modifié trop récemment pour être synchronisé sans risque.
// Un horodatage FUTUR (horloge de l'appareil décalée en avant) n'est JAMAIS
// chaud : un fichier ne doit pas rester bloqué éternellement à cause d'une
// horloge fausse — il est traité comme froid et synchronisé normalement.
export function isEditHot(modifiedAt: number, nowMs: number): boolean {
  const age = nowMs - modifiedAt;
  return age >= 0 && age < SYNC_EDIT_QUIET_MS;
}

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
