// ✒️ 123ECRITURE — lib/sync/syncTypes.ts — les types partagés du moteur de synchronisation
import type { RemoteVaultDevice } from './devices';
//
// Les types que PLUSIEURS modules du dossier partagent (moteur, cloud,
// appareils, interface). Un type vit ici dès que deux fichiers en ont
// besoin — jamais dupliqué.
//
// SOMMAIRE :
//   1. Le résumé d'un cycle
//   2. Le résumé d'un coffre distant
//
//////////////////////////////////////////////////////////////////////////////

//////// 1. Le résumé d'un cycle ///////////////////////////////////////////

export type SyncSummary = {
  pushed: number;
  pulled: number;
  // Fichiers supprimés comptés ce cycle : suppressions LOCALES propagées au
  // cloud (pierres tombales) + suppressions DISTANTES appliquées ici.
  deleted: number;
  // Pushes dont le chemin vit sous `.trash/` — le continu d'un déplacement
  // en corbeille. Comptés À PART (ni « envoyé(s) » ni « modifié(s) ») pour
  // que le résumé ne compte pas deux fois le même geste.
  trashed: number;
  // v0.4.89 (la demande de Catelina) : les fichiers modifiés à l'extérieur
  // et reçus — annoncés « modification », jamais « reçu ».
  modifications: number;
  conflicts: number;
  errors: string[];
};

// État de synchro par coffre : ensemble des fichiers présents à la fin du
// dernier cycle réussi (rel_path -> hash de contenu), persisté DANS le

//////// 2. Le résumé d'un coffre distant //////////////////////////////////

// Coffres distants du compte connecté — lecture seule, pour lister ce qui
// existe déjà côté cloud (Paramètres → « Coffres distants ») : s'y connecter
// depuis un nouvel appareil, ou y raccrocher un coffre local dont le dossier
// a été recréé, sans créer de doublon. RLS côté serveur : on ne reçoit que
// ses propres lignes, pas de filtre owner_id à dupliquer ici. `local_vault_id`
// reste l'identité du dossier CRÉATEUR (informatif) — la référence distante
// utilisée par la sync vit dans le registre local de chaque machine.
// `devices` : appareils ayant synchronisé ce coffre (table vault_devices),
// du plus récemment vu au plus ancien — la carte « Coffres distants »
// affiche « qui » est connecté et quand.
// `createdByDevice` : appareil CRÉATEUR du coffre — d'où il « provient »,
// distinct de qui l'a synchronisé depuis.
// `fileCount` : nombre de fichiers dans le coffre distant — distinguer
// « vide, en attente de contenu » d'un coffre rempli.
export type RemoteVaultSummary = {
  id: string;
  name: string;
  localVaultId: string | null;
  createdAt: string;
  devices: RemoteVaultDevice[];
  createdByDevice: string | null;
  fileCount: number;
};
