//////////
// ✒️ 123ECRITURE — deletions.ts
// SYNCHRONISATION DES SUPPRESSIONS : logique pure (testée) — détection des
// suppressions locales, décision d'application des tombstones distantes,
// garde anti-destruction massive
//////////

// INTRODUCTION — Logique pure de la SYNCHRONISATION DES SUPPRESSIONS
// (v0.4.17) — voir docs/ARCHITECTURE.md §6. Le moteur (syncEngine.ts)
// persiste dans .123ecriture/sync-state.json l'ensemble des fichiers
// présents à la fin de chaque synchro réussie (rel_path -> hash) : c'est la
// base de référence qui distingue « jamais existé ici » de « existait et a
// été supprimé ici ». v0.4.72 : le garde anti-destruction massive devient
// une fonction pure TESTÉE — plus jamais de propagation d'une liste de
// suppressions suspecte sans revue humaine (demande de Catelina :
// « JAMAIS de façon silencieuse »).
//
// SOMMAIRE :
//   1. 🔍 Détection des suppressions locales (computeLocalDeletions)
//   2. ⚖️ Décision d'application d'une tombstone distante (remoteDeletionAction)
//   3. 🛡️ Garde anti-destruction massive (isMassiveDeletion)

// Fichiers supprimés localement depuis la dernière synchro : présents dans
// l'état précédent, absents du disque maintenant. Ils deviennent des
// pierres tombales distantes (vault_files.deleted = true) pour que les
// autres appareils les retirent aussi — au lieu de réapparaître ici au
// cycle suivant (l'ancien comportement « pull » les ressuscitait).

//////// 1. 🔍 DÉTECTION DES SUPPRESSIONS LOCALES ///////////

export function computeLocalDeletions(
  lastSynced: Record<string, string>,
  currentRelPaths: Set<string>,
): string[] {
  return Object.keys(lastSynced).filter((relPath) => !currentRelPaths.has(relPath));
}

//////// 2. ⚖️ DÉCISION D'APPLICATION D'UNE TOMBSTONE DISTANTE ///////////

export type RemoteDeletionAction = 'delete' | 'keep-copy' | 'skip';

// Décision d'application locale d'une pierre tombale distante (le fichier a
// été supprimé sur un autre appareil) :
//  - fichier absent localement            → 'skip' (rien à faire)
//  - jamais synchro ici (pas dans l'état) → 'skip' (conservateur : ce
//    fichier vient du dossier de l'utilisatrice, pas de la synchro — on ne
//    efface jamais quelque chose qu'on n'a pas apporté)
//  - synchro ici et inchangé depuis       → 'delete' (propagation directe)
//  - synchro ici mais MODIFIÉ depuis      → 'keep-copy' (le moteur garde une
//    copie « (conflit …) » avant de supprimer — jamais de perte silencieuse)
export function remoteDeletionAction(args: {
  localExists: boolean;
  lastSyncedHash?: string;
  localHash?: string;
}): RemoteDeletionAction {
  if (!args.localExists) return 'skip';
  if (!args.lastSyncedHash) return 'skip';
  return args.lastSyncedHash === args.localHash ? 'delete' : 'keep-copy';
}

//////// 3. 🛡️ GARDE ANTI-DESTRUCTION MASSIVE (isMassiveDeletion) ///////////

// Seuil au-delà duquel une liste de suppressions locales est considérée
// SUSPECTE et part en revue manuelle au lieu d'être propagée : 20 fichiers
// absolus, ou plus du tiers de l'état précédent. Déclencheurs vécus :
// permission SAF perdue (dossier « non inscriptible », 555 écritures
// rejetées le 17/10), index vide, dossier mal reconnecté — un parcours
// partiel ressemble à une suppression TOTALE.
export const MAX_DELETIONS_WITHOUT_REVIEW = 20;

export function isMassiveDeletion(candidateCount: number, localFileCount: number): boolean {
  if (candidateCount <= 0) return false;
  // Parcours VIDE (permission SAF perdue, index vide…) : jamais fiable.
  if (localFileCount <= 0) return true;
  // Suspect si AU-DESSUS du seuil absolu OU si plus du tiers de l'état
  // précédent disparaît d'un coup (les deux déclenchent la revue).
  return candidateCount > MAX_DELETIONS_WITHOUT_REVIEW || candidateCount > localFileCount / 3;
}
