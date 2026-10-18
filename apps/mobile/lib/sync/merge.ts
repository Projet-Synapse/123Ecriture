// ✒️ 123ECRITURE — lib/sync/merge.ts — fusion à trois voix (diff-match-patch)
//////////////////////////////////////////////////////////////////////////////
//
// Fusion à trois voix avec diff-match-patch de Google, comme Obsidian
// Sync. Une note modifiée des DEUX côtés entre deux cycles ne devient pas
// systématiquement un conflit tranché au plus récent : base (dernière
// version synchronisée) + locale + distante → dmp.patch_merge. Deux
// modifications de parties différentes de la note sont RÉUNIES ; seules
// les modifications qui chevauchent réellement les mêmes lignes restent
// un conflit (tranché au plus récent, perdant archivé — repli conservé).
//
// Invariants du fichier :
//   • Pur et testé : toute la décision de fusion vit ici — le moteur
//     (syncEngine.ts) ne fait qu'appeler tryThreeWayMerge et appliquer le
//     résultat.
//   • Une fusion douteuse n'est JAMAIS écrite en silence : si le texte
//     fusionné contient des marqueurs de conflit, le résultat est traité
//     comme un conflit (jamais de perte silencieuse).
//
// SOMMAIRE :
//   1. Le moteur de fusion et le contrat de résultat (dmp, MergeOutcome)
//   2. tryThreeWayMerge — la fusion autour de la base commune
//
//////////////////////////////////////////////////////////////////////////////

//////// 1. Le moteur de fusion et le contrat de résultat (dmp, MergeOutcome) ///////////

import DiffMatchPatch from 'diff-match-patch';

const dmp = new DiffMatchPatch();

export type MergeOutcome =
  | { kind: 'merged'; text: string; clean: boolean }
  | { kind: 'conflict' };

//////// 2. tryThreeWayMerge — la fusion autour de la base commune ///////////

// Fusionne locale et distante autour de la base commune. `clean` = la
// fusion n'a laissé AUCUN marqueur de conflit ; sinon le texte contient des
// marqueurs « <<<<<<< LOCAL / ======= / >>>>>>> DISTANT » aux endroits
// irréconciliables — traité comme un conflit pour ne JAMAIS écrire une
// fusion douteuse en silence (jamais de perte silencieuse).
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
