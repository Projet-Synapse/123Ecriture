// ✒️ 123ECRITURE — lib/sync/changeStats.ts — statistiques de modification d'un fichier synchronisé
//////////////////////////////////////////////////////////////////////////////
//
// Le journal de synchronisation raconte le CHANGEMENT d'un fichier (nombre
// de suppressions, nombre d'ajouts, nombre de caractères au total) au lieu
// d'un « envoyé » aveugle. On compare la version distante précédente à la
// version poussée avec diff-match-patch — la même librairie que la fusion
// à trois voix : un seul moteur de comparaison dans l'app.
//
// Invariants du fichier :
//   • Pur et testé : le moteur (pushFile dans syncEngine.ts) se contente
//     d'appeler et de journaliser.
//   • Un échec de statistique n'est JAMAIS un échec de push : la
//     journalisation ne doit jamais pouvoir faire échouer une
//     synchronisation.
//
// SOMMAIRE :
//   1. Calcul des statistiques (textChangeStats)
//   2. Libellé humain (textChangeDetail)
//
//////////////////////////////////////////////////////////////////////////////

//////// 1. Calcul des statistiques (textChangeStats) ///////////

import DiffMatchPatch from 'diff-match-patch';

export type TextChangeStats = {
  addedChars: number;
  removedChars: number;
  totalChars: number;
};

// previous = null → fichier NOUVEAU (tout est un ajout). Identique → tous
// les compteurs à zéro (un cycle peut repousser un fichier à l'identique,
// par exemple après une restauration : le journal doit le dire honnêtement).
export function textChangeStats(previous: string | null, next: string): TextChangeStats {
  const totalChars = next.length;
  if (previous === null) {
    return { addedChars: totalChars, removedChars: 0, totalChars };
  }
  const dmp = new DiffMatchPatch();
  const diffs = dmp.diff_main(previous, next);
  let addedChars = 0;
  let removedChars = 0;
  for (const [op, text] of diffs) {
    if (op === DiffMatchPatch.DIFF_INSERT) addedChars += text.length;
    else if (op === DiffMatchPatch.DIFF_DELETE) removedChars += text.length;
  }
  return { addedChars, removedChars, totalChars };
}

//////// 2. Libellé humain (textChangeDetail) ///////////

export function textChangeDetail(stats: TextChangeStats): string {
  return `+${stats.addedChars} / −${stats.removedChars} caractères (${stats.totalChars} au total)`;
}
