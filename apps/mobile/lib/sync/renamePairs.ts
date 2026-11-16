// ✒️ 123ECRITURE — lib/sync/renamePairs.ts — un renommage n'est pas une suppression
//////////////////////////////////////////////////////////////////////////////
//
// Le moteur à trois états (threeWay.ts) voit un renommage comme « ancien
// chemin disparu » + « nouveau chemin apparu ». Ce module APPARIE les deux
// moitiés pour qu'un renommage ne compte JAMAIS comme une suppression dans
// le garde-fou anti-suppression massive (renommer 30 notes .md en .mdx ne
// doit pas déclencher l'alerte) et soit annoncé comme tel (journal, revue).
//
// Invariants du fichier :
//   • Appariement 1 pour 1, uniquement entre une disparition et une
//     APPARITION du même cycle — une absence seule (dossier incomplet,
//     fichier introuvable) n'est jamais appariée : le garde-fou la voit.
//   • Deux critères, dans l'ordre :
//       1. même contenu (hash identique, fichier vide exclu : tous les
//          fichiers vides partagent le même hash) — renommage/déplacement ;
//       2. même dossier et même nom, seule l'extension change entre .md et
//          .mdx — conversion de format (le contenu converti diffère).
//   • Ordre déterministe (chemins triés) : même entrée → mêmes paires.
//
// Module PUR, sans réseau ni disque (tests : renamePairs.test.ts).
//
//////////////////////////////////////////////////////////////////////////////

import { EMPTY_SHA256 } from './folderMarker';

export type RenameSide = { relPath: string; hash: string };
export type RenamePair = { from: string; to: string };

const NOTE_FORMATS = ['.mdx', '.md'];

function splitNoteFormat(relPath: string): { stem: string; ext: string } | null {
  const lower = relPath.toLowerCase();
  const ext = NOTE_FORMATS.find((e) => lower.endsWith(e) && lower.length > e.length && lower[lower.length - e.length - 1] !== '/');
  return ext ? { stem: relPath.slice(0, relPath.length - ext.length), ext } : null;
}

export function pairRenames(removed: RenameSide[], added: RenameSide[]): RenamePair[] {
  const byPath = (a: RenameSide, b: RenameSide) => (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0);
  const gone = [...removed].sort(byPath);
  const fresh = [...added].sort(byPath);
  const used = new Set<string>();
  const paired = new Set<string>();
  const pairs: RenamePair[] = [];

  // 1. Même contenu.
  for (const r of gone) {
    if (!r.hash || r.hash === EMPTY_SHA256) continue;
    const match = fresh.find((a) => !used.has(a.relPath) && a.hash === r.hash);
    if (!match) continue;
    used.add(match.relPath);
    paired.add(r.relPath);
    pairs.push({ from: r.relPath, to: match.relPath });
  }

  // 2. Conversion .md ⇄ .mdx (même dossier, même nom).
  for (const r of gone) {
    if (paired.has(r.relPath)) continue;
    const old = splitNoteFormat(r.relPath);
    if (!old) continue;
    const match = fresh.find((a) => {
      if (used.has(a.relPath)) return false;
      const next = splitNoteFormat(a.relPath);
      return next !== null && next.stem === old.stem && next.ext !== old.ext;
    });
    if (!match) continue;
    used.add(match.relPath);
    paired.add(r.relPath);
    pairs.push({ from: r.relPath, to: match.relPath });
  }

  return pairs.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
}
