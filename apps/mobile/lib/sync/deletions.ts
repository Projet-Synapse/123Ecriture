// Logique pure de la SYNCHRONISATION DES SUPPRESSIONS (v0.4.17) — voir
// docs/ARCHITECTURE.md §6. Le moteur (syncEngine.ts) persiste dans
// .123ecriture/sync-state.json l'ensemble des fichiers présents à la fin de
// chaque synchro réussie (rel_path -> hash) : c'est la base de référence qui
// distingue « jamais existé ici » de « existait et a été supprimé ici ».

// Fichiers supprimés localement depuis la dernière synchro : présents dans
// l'état précédent, absents du disque maintenant. Ils deviennent des
// pierres tombales distantes (vault_files.deleted = true) pour que les
// autres appareils les retirent aussi — au lieu de réapparaître ici au
// cycle suivant (l'ancien comportement « pull » les ressuscitait).
export function computeLocalDeletions(
  lastSynced: Record<string, string>,
  currentRelPaths: Set<string>,
): string[] {
  return Object.keys(lastSynced).filter((relPath) => !currentRelPaths.has(relPath));
}

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
