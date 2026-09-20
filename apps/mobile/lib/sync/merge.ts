// Fusion à trois voix (v0.4.29) — diff-match-patch de Google, comme Obsidian
// Sync. Pur et testé : toute la décision de fusion vit ici, le moteur
// (syncEngine.ts) ne fait qu'appeler tryThreeWayMerge et appliquer le
// résultat.
//
// Avant : un fichier modifié des deux côtés entre deux cycles = conflit
// tranché au plus récent, le perdant archivé (copies « (conflit …) » vécues
// pendant des jours). Maintenant : base (dernière version synchronisée) +
// locale + distante → dmp.patch_merge. Deux modifications de parties
// différentes de la note sont RÉUNIES ; seules les modifications qui
// chevauchent réellement les mêmes lignes restent un conflit (comportement
// précédent conservé comme repli).

import DiffMatchPatch from 'diff-match-patch';

const dmp = new DiffMatchPatch();

export type MergeOutcome =
  | { kind: 'merged'; text: string; clean: boolean }
  | { kind: 'conflict' };

// Fusionne locale et distante autour de la base commune. `clean` = la
// fusion n'a laissé AUCUN marqueur de conflit ; sinon le texte contient des
// marqueurs « <<<<<<< LOCAL / ======= / >>>>>>> DISTANT » aux endroits
// irréconciliables — traité comme un conflit pour ne JAMAIS écrire une
// fusion douteuse en silence (règle CLAUDE.md : jamais de perte
// silencieuse).
export function tryThreeWayMerge(
  base: string,
  local: string,
  remote: string,
): MergeOutcome {
  if (local === remote) return { kind: 'merged', text: local, clean: true };
  if (local === base) return { kind: 'merged', text: remote, clean: true };
  if (remote === base) return { kind: 'merged', text: local, clean: true };

  const patches = dmp.patch_make(base, remote);
  if (patches.length === 0) return { kind: 'merged', text: local, clean: true };

  // patch_merge applique les modifications distantes SUR la version locale
  // (base → distant transportée sur local) : c'est exactement la fusion à
  // trois voix de diff-match-patch.
  const [mergedText, results] = dmp.patch_apply(patches, local) as [string, boolean[]];
  const clean = results.length > 0 && results.every(Boolean);
  if (!clean) {
    // Des patchs distants n'ont pas pu s'appliquer sur la version locale
    // (chevauchement réel) : conflit assumé, l'appelant tranche comme avant.
    return { kind: 'conflict' };
  }
  return { kind: 'merged', text: mergedText, clean: true };
}
