// Résolution du coffre actif pour la synchro (v0.4.28). Pur et testé.
//
// Contexte : jusqu'à v0.4.27, l'identifiant du coffre distant venait d'un
// ref React (latestRef) mis à jour dans un effet, tandis que le hachage et
// les opérations fichiers portaient TOUJOURS sur le coffre actif du
// processus principal. Entre les deux, une fenêtre de course (bascule de
// coffre immédiatement suivie d'une synchro) croisait les deux : le contenu
// du coffre cliqué partait dans le coffre distant du coffre précédent —
// la contamination croisée vécue pendant des jours. v0.4.28 : le moteur
// déduit TOUT (dossier, distant) du coffre actif au moment du cycle — une
// seule source de vérité, désynchronisation impossible.

// Retourne le coffre distant lié du coffre actif, ou null si le coffre
// actif est introuvable dans le registre ou non lié au cloud.
// (VaultRegistryEntry est un type global, voir types/global.d.ts.)
export function pickActiveRemoteVault(
  entries: VaultRegistryEntry[],
  activeId: string | null,
): VaultRegistryEntry | null {
  if (!activeId) return null;
  const entry = entries.find((v) => v.id === activeId);
  if (!entry || !entry.cloudLinked || !entry.remoteVaultId) return null;
  return entry;
}
