// ✒️ 123ECRITURE — lib/sync/deletions.ts — synchronisation des suppressions (logique pure)
//////////////////////////////////////////////////////////////////////////////
//
// Détection des suppressions locales, décision d'application des
// tombstones distantes, garde anti-destruction massive. Logique pure et
// testée (deletions.test.ts) — le moteur (syncEngine.ts) se contente
// d'appliquer. Il persiste dans .123ecriture/sync-state.json l'ensemble
// des fichiers présents à la fin de chaque synchro réussie (rel_path ->
// hash) : c'est cette référence qui distingue « jamais existé ici » de
// « existait et a été supprimé ici ».
//
// Invariants du fichier :
//   • Une suppression locale devient une tombstone distante
//     (vault_files.deleted = true) pour que les autres appareils retirent
//     le fichier aussi — sinon le pull suivant le ressuscite ici.
//   • On n'efface JAMAIS localement un fichier que la synchronisation
//     n'avait pas apporté : absent de l'état précédent → skip
//     (conservateur — ce fichier vient du dossier de l'utilisatrice).
//   • Une liste de suppressions suspecte part en revue humaine, jamais
//     propagée en silence (JAMAIS de façon silencieuse).
//
// SOMMAIRE :
//   1. Détection des suppressions locales (computeLocalDeletions)
//   2. Décision d'application d'une tombstone distante (remoteDeletionAction)
//   3. Garde anti-destruction massive (isMassiveDeletion)
//
//////////////////////////////////////////////////////////////////////////////

//////// 1. Détection des suppressions locales (computeLocalDeletions) ///////////

// Fichiers supprimés localement depuis la dernière synchro : présents dans
// l'état précédent, absents du disque maintenant. Ils deviennent des
// pierres tombales distantes (vault_files.deleted = true) pour que les
// autres appareils les retirent aussi.
export function computeLocalDeletions(
  lastSynced: Record<string, string>,
  currentRelPaths: Set<string>,
): string[] {
  return Object.keys(lastSynced).filter((relPath) => !currentRelPaths.has(relPath));
}

//////// 2. Décision d'application d'une tombstone distante (remoteDeletionAction) ///////////

export type RemoteDeletionAction = 'delete' | 'keep-copy' | 'skip';

// Décision d'application locale d'une pierre tombale distante (le fichier a
// été supprimé sur un autre appareil) :
//  - fichier absent localement            → 'skip' (rien à faire)
//  - jamais synchro ici (pas dans l'état) → 'skip' (conservateur : ce
//    fichier vient du dossier de l'utilisatrice, pas de la synchro — on
//    n'efface jamais quelque chose qu'on n'a pas apporté)
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

//////// 3. Garde anti-destruction massive (isMassiveDeletion) ///////////

// Seuil au-delà duquel une liste de suppressions locales est considérée
// SUSPECTE et part en revue manuelle au lieu d'être propagée : 20 fichiers
// absolus, ou plus du tiers de l'état précédent. Déclencheurs typiques :
// permission SAF perdue (dossier « non inscriptible », écritures
// rejetées), index vide, dossier mal reconnecté — un parcours partiel
// ressemble à une suppression TOTALE.
export const MAX_DELETIONS_WITHOUT_REVIEW = 20;

export function isMassiveDeletion(candidateCount: number, localFileCount: number): boolean {
  if (candidateCount <= 0) return false;
  // Parcours VIDE (permission SAF perdue, index vide…) : jamais fiable.
  if (localFileCount <= 0) return true;
  // Suspect si AU-DESSUS du seuil absolu OU si plus du tiers de l'état
  // précédent disparaît d'un coup (les deux déclenchent la revue).
  return candidateCount > MAX_DELETIONS_WITHOUT_REVIEW || candidateCount > localFileCount / 3;
}
