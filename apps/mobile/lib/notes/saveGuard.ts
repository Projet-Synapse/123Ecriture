// ✒️ 123ECRITURE — lib/notes/saveGuard.ts — jamais d'écriture sur un chemin en cours de renommage
//////////////////////////////////////////////////////////////////////////////
//
// Cause du « .md et .mdx côte à côte » après une conversion (#230) côté
// éditeur : une sauvegarde automatique (600 ms) ou un flush déjà lancé
// visait l'ANCIEN chemin ; arrivée après le déplacement, elle RECRÉAIT
// l'ancien fichier (writeNote crée s'il n'existe pas), que la synchro
// renvoyait ensuite partout. Règle : une sauvegarde n'écrit que si son
// chemin est toujours celui de la note ouverte et qu'aucun renommage /
// déplacement ne le touche (lui ou un dossier parent).
//
//////////////////////////////////////////////////////////////////////////////

export function isPathChanging(relPath: string, changing: ReadonlySet<string>): boolean {
  for (const path of changing) {
    if (relPath === path || relPath.startsWith(`${path}/`)) return true;
  }
  return false;
}

export function shouldWriteSave(args: {
  targetPath: string;
  activePath: string | null | undefined;
  changing: ReadonlySet<string>;
}): boolean {
  return args.activePath === args.targetPath && !isPathChanging(args.targetPath, args.changing);
}
