// ✒️ 123ECRITURE — lib/sync/activeVault.ts — résolution du coffre actif pour la synchro
//////////////////////////////////////////////////////////////////////////////
//
// Pur et testé. Le moteur déduit TOUT (dossier local, coffre distant) du
// coffre actif AU MOMENT du cycle — une seule source de vérité, une
// désynchronisation entre les deux est impossible par construction.
//
// Invariants du fichier :
//   • L'identifiant du coffre distant ne vient JAMAIS d'un ref React mis à
//     jour dans un effet : le hachage et les opérations fichiers portent
//     sur le coffre actif du process principal. Un ref pris entre deux
//     cycles croise les deux pendant la fenêtre de course d'une bascule de
//     coffre — le contenu du coffre cliqué partirait dans le coffre
//     distant du coffre précédent (contamination croisée).
//   • null si le coffre actif est introuvable dans le registre ou non lié
//     au cloud : le cycle ne devine jamais un identifiant.
//
// SOMMAIRE :
//   1. Le coffre distant lié du coffre actif (pickActiveRemoteVault)
//
//////////////////////////////////////////////////////////////////////////////

//////// 1. Le coffre distant lié du coffre actif (pickActiveRemoteVault) ///////////

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
