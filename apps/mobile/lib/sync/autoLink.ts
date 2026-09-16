// Sélection des coffres à lier automatiquement au compte — pur et testé
// (même philosophie que lib/authCallback.ts) : connecté·e, TOUT coffre du
// registre est une donnée du compte (voir docs/ARCHITECTURE.md §6). Le
// guetteur de VaultsContext délègue ici le choix de ses cibles du tour :
// non liés uniquement, hors tentatives déjà en cours (garde anti-boucle —
// un échec n'écrit rien dans le registre, les dépendances de l'effet ne
// changent donc pas).
export function pickVaultsToAutoLink(
  vaultList: VaultRegistryEntry[],
  inFlightIds: ReadonlySet<string>,
): VaultRegistryEntry[] {
  return vaultList.filter((v) => !v.cloudLinked && !inFlightIds.has(v.id));
}
