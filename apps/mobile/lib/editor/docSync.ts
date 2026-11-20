// ✒️ 123ECRITURE — lib/editor/docSync.ts — synchro parent → éditeur sans retour en arrière
//////////////////////////////////////////////////////////////////////////////
//
// Les éditeurs CodeMirror (bureau : MdxEditor ; Android : la WebView de
// webview/editor-entry.tsx) reçoivent le contenu de la note par une prop
// `value` qui fait l'aller-retour éditeur → parent → éditeur. Ce retour
// arrive EN RETARD par rapport à la frappe (rendu React différé, pont
// WebView throttlé à 300 ms, renvois du `ready`, normalisation du corps
// sans frontmatter). L'ancienne synchro (« value ≠ doc → remplacer tout
// le doc ») réécrivait alors l'éditeur avec une version PLUS ANCIENNE :
// les dernières lettres tapées disparaissaient (« saisie annulée »).
//
// Règles appliquées ici :
//   • un texte que l'éditeur a lui-même émis (ou déjà synchronisé) est un
//     ÉCHO : sa version est ≤ celle en cours d'édition → jamais réappliqué ;
//   • seul un vrai changement externe (changement de note, réécriture des
//     liens, conversion…) est appliqué, en DIFF minimal (préfixe/suffixe
//     communs) : CodeMirror reporte alors la sélection, le curseur reste
//     en place.
//
// Module pur (aucun import React/RN) : partagé par le bureau et le bundle
// WebView, testé dans docSync.test.ts.
//
//////////////////////////////////////////////////////////////////////////////

export type DocChange = { from: number; to: number; insert: string };

// Plus petit remplacement transformant `oldDoc` en `newDoc` (null si égaux).
// Ne coupe jamais une paire de substitution UTF-16 (emoji).
export function minimalChange(oldDoc: string, newDoc: string): DocChange | null {
  if (oldDoc === newDoc) return null;
  const max = Math.min(oldDoc.length, newDoc.length);
  let start = 0;
  while (start < max && oldDoc.charCodeAt(start) === newDoc.charCodeAt(start)) start++;
  if (start > 0 && isHighSurrogate(oldDoc.charCodeAt(start - 1))) start--;
  let oldEnd = oldDoc.length;
  let newEnd = newDoc.length;
  while (oldEnd > start && newEnd > start && oldDoc.charCodeAt(oldEnd - 1) === newDoc.charCodeAt(newEnd - 1)) {
    oldEnd--;
    newEnd--;
  }
  if (oldEnd < oldDoc.length && isLowSurrogate(oldDoc.charCodeAt(oldEnd))) {
    oldEnd++;
    newEnd++;
  }
  return { from: start, to: oldEnd, insert: newDoc.slice(start, newEnd) };
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}
function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

// Mémoire des versions connues de l'éditeur depuis le dernier point de
// synchro (textes émis + texte synchronisé). Bornée : un écho ne peut
// porter que sur les toutes dernières émissions.
export class DocSync {
  private known: string[] = [];

  constructor(private readonly limit = 32) {}

  // À appeler pour chaque texte que l'éditeur envoie au parent.
  noteEmitted(text: string): void {
    if (this.known[this.known.length - 1] === text) return;
    this.known.push(text);
    if (this.known.length > this.limit) this.known.splice(0, this.known.length - this.limit);
  }

  // `value` reçu du parent, `doc` = contenu actuel de l'éditeur. Renvoie le
  // changement à appliquer, ou null (identique, ou écho d'une version
  // antérieure ou égale à celle en cours d'édition).
  incoming(value: string, doc: string): DocChange | null {
    if (value === doc) {
      // Point de synchro : on GARDE l'historique (un écho plus ancien peut
      // encore arriver après, ex. renvoi du `ready` sur Android).
      this.noteEmitted(doc);
      return null;
    }
    if (this.known.includes(value)) return null;
    // Vrai changement externe (autre note…) : l'historique de l'ancien
    // contenu ne doit plus masquer un retour légitime à ce contenu.
    this.known = [value];
    return minimalChange(doc, value);
  }
}

// Applique un DocChange à une chaîne (tests, repli sans EditorView).
export function applyDocChange(doc: string, change: DocChange): string {
  return doc.slice(0, change.from) + change.insert + doc.slice(change.to);
}

// Report d'une position à travers un DocChange (même règle que CodeMirror
// pour un curseur : après un texte inséré à sa position s'il est dedans).
export function mapPosition(pos: number, change: DocChange): number {
  if (pos <= change.from) return pos;
  if (pos >= change.to) return pos + change.insert.length - (change.to - change.from);
  return change.from + change.insert.length;
}
