// ✒️ 123ECRITURE — lib/editor/mdxFormatting.ts — transformations de texte de la barre de formatage
//////////////////////////////////////////////////////////////////////////////
//
// Fonctions pures de transformation de texte pour la barre de formatage
// de l'éditeur MDX (components/NotesScreen.tsx). Volontairement séparées
// du composant pour rester testables sans React Native.
//
// Invariants du fichier :
//   • Aucune fonction ne mute son entrée : chacune renvoie un nouveau
//     texte ET la nouvelle sélection, prêts à être appliqués d'un seul
//     coup côté éditeur.
//   • Les lignes vides ne sont jamais préfixées (listes, citations).
//   • Une bascule détecte d'abord si TOUTES les lignes non vides portent
//     déjà le préfixe : dans ce cas elle le retire, sinon elle l'ajoute.
//
// SOMMAIRE :
//   1. Types et bornes de ligne
//   2. Mise en forme en ligne (wrapSelection, applyHeading)
//   3. Blocs et listes en bascule (toggleLinePrefix, toggleNumberedList)
//   4. Insertions (insertLink, insertTable)
//
//////////////////////////////////////////////////////////////////////////////

//////// 1. Types et bornes de ligne //////////////////////////////////////////

export type Selection = { start: number; end: number };
export type FormattingResult = { text: string; selection: Selection };

function getLineRange(text: string, index: number): { lineStart: number; lineEnd: number } {
  const lineStart = text.lastIndexOf('\n', index - 1) + 1;
  const nextBreak = text.indexOf('\n', index);
  const lineEnd = nextBreak === -1 ? text.length : nextBreak;
  return { lineStart, lineEnd };
}

//////// 2. Mise en forme en ligne (wrapSelection, applyHeading) ///////////////

// Entoure la sélection d'un marqueur (ex. **gras**, _italique_, `code`).
// Sans sélection, insère juste une paire de marqueurs avec le curseur entre
// les deux, prêt à taper.
export function wrapSelection(text: string, selection: Selection, marker: string): FormattingResult {
  const { start, end } = selection;
  const selected = text.slice(start, end);
  const newText = text.slice(0, start) + marker + selected + marker + text.slice(end);

  if (selected.length > 0) {
    return { text: newText, selection: { start: start + marker.length, end: end + marker.length } };
  }
  const cursor = start + marker.length;
  return { text: newText, selection: { start: cursor, end: cursor } };
}

// Applique un titre Markdown (# / ## / ###) sur la ligne courante,
// remplaçant un éventuel titre déjà présent plutôt que de l'empiler.
export function applyHeading(text: string, selection: Selection, level: 1 | 2 | 3 | 4 | 5 | 6): FormattingResult {
  const { lineStart, lineEnd } = getLineRange(text, selection.start);
  const line = text.slice(lineStart, lineEnd);
  const stripped = line.replace(/^#{1,6}\s*/, '');
  const newLine = `${'#'.repeat(level)} ${stripped}`;
  const newText = text.slice(0, lineStart) + newLine + text.slice(lineEnd);
  const delta = newLine.length - line.length;
  return {
    text: newText,
    selection: { start: selection.start + delta, end: selection.end + delta },
  };
}

//////// 3. Blocs et listes en bascule (toggleLinePrefix, toggleNumberedList) //

// Ajoute (ou retire, en bascule) un préfixe (ex. "- ", "> ") sur chaque
// ligne couverte par la sélection — les lignes vides ne sont pas touchées.
export function toggleLinePrefix(text: string, selection: Selection, prefix: string): FormattingResult {
  const { lineStart } = getLineRange(text, selection.start);
  const { lineEnd } = getLineRange(text, Math.max(selection.end - 1, selection.start));
  const block = text.slice(lineStart, lineEnd);
  const lines = block.split('\n');
  const nonEmpty = lines.filter((line) => line.length > 0);
  const alreadyPrefixed = nonEmpty.length > 0 && nonEmpty.every((line) => line.startsWith(prefix));

  const newLines = lines.map((line) => {
    if (line.length === 0) return line;
    return alreadyPrefixed ? line.slice(prefix.length) : `${prefix}${line}`;
  });
  const newBlock = newLines.join('\n');
  const newText = text.slice(0, lineStart) + newBlock + text.slice(lineEnd);
  const delta = newBlock.length - block.length;

  return {
    text: newText,
    selection: {
      start: selection.start + (alreadyPrefixed ? -prefix.length : prefix.length),
      end: selection.end + delta,
    },
  };
}

// Liste numérotée : comme toggleLinePrefix, mais avec une vraie
// numérotation incrémentale (1. 2. 3. …) plutôt qu'un préfixe fixe.
export function toggleNumberedList(text: string, selection: Selection): FormattingResult {
  const { lineStart } = getLineRange(text, selection.start);
  const { lineEnd } = getLineRange(text, Math.max(selection.end - 1, selection.start));
  const block = text.slice(lineStart, lineEnd);
  const lines = block.split('\n');
  const numbered = /^\d+\.\s/;
  const nonEmpty = lines.filter((line) => line.length > 0);
  const alreadyNumbered = nonEmpty.length > 0 && nonEmpty.every((line) => numbered.test(line));

  let counter = 1;
  const newLines = lines.map((line) => {
    if (line.length === 0) return line;
    if (alreadyNumbered) return line.replace(numbered, '');
    const newLine = `${counter}. ${line}`;
    counter += 1;
    return newLine;
  });
  const newBlock = newLines.join('\n');
  const newText = text.slice(0, lineStart) + newBlock + text.slice(lineEnd);
  const delta = newBlock.length - block.length;

  return {
    text: newText,
    selection: { start: selection.start, end: selection.end + delta },
  };
}

//////// 4. Insertions (insertLink, insertTable) ///////////////////////////////

// Insère un lien Markdown. Avec une sélection, elle devient le texte du
// lien ; sinon un texte par défaut est inséré. Dans les deux cas, "url"
// finit sélectionné pour que l'utilisateur·rice puisse taper l'adresse
// directement.
export function insertLink(text: string, selection: Selection): FormattingResult {
  const { start, end } = selection;
  const selected = text.slice(start, end);
  const label = selected.length > 0 ? selected : 'texte du lien';
  const markdown = `[${label}](url)`;
  const newText = text.slice(0, start) + markdown + text.slice(end);
  const urlStart = start + label.length + 3; // "[" + label + "]("
  const urlEnd = urlStart + 3; // "url"
  return { text: newText, selection: { start: urlStart, end: urlEnd } };
}

// Insère un gabarit de tableau Markdown (GFM, rendu par NoteRenderer.tsx) —
// 2 colonnes, 1 ligne de données, prête à être adaptée/étendue à la main
// (ajouter des colonnes/lignes reste juste taper du texte, comme le reste
// du Markdown — pas d'éditeur de grille dédié pour ça).
export function insertTable(text: string, selection: Selection): FormattingResult {
  const { start, end } = selection;
  const table = '| Colonne 1 | Colonne 2 |\n| --- | --- |\n| Valeur | Valeur |\n';
  // Un tableau Markdown doit démarrer sur sa propre ligne — ajoute un saut
  // de ligne devant si on n'est pas déjà en début de ligne/fichier.
  const needsLeadingBreak = start > 0 && text[start - 1] !== '\n';
  const prefix = needsLeadingBreak ? '\n' : '';
  const newText = text.slice(0, start) + prefix + table + text.slice(end);
  const cursor = start + prefix.length + table.length;
  return { text: newText, selection: { start: cursor, end: cursor } };
}

//////// 5. Alignement des paragraphes (applyAlignment) ////////////////////////
//
// Markdown n'a pas d'alignement : on enveloppe le PARAGRAPHE entier dans
// du HTML compris par Obsidian et par l'appli (aperçu, live preview) :
//   <p align="center">Texte du paragraphe</p>
// Une seule forme pour les quatre alignements (`align` accepte left,
// center, right et justify dans les navigateurs/Obsidian). Règles :
//   • la sélection (même une partie de ligne) vise le(s) paragraphe(s)
//     entier(s) qui la contiennent (blocs séparés par une ligne vide) ;
//   • « gauche » RETIRE l'enveloppe (alignement par défaut) ;
//   • changer d'alignement REMPLACE l'enveloppe existante (aussi la forme
//     `<div style="text-align: …">…</div>`), jamais d'imbrication ;
//   • titres, listes, citations, tableaux, blocs de code et autre HTML ne
//     sont pas enveloppés (le HTML casserait leur syntaxe Markdown).

export type TextAlignment = 'left' | 'center' | 'right' | 'justify';

const ALIGN_VALUES = 'left|center|right|justify';
const ALIGNED_P = new RegExp(`^<p align="(${ALIGN_VALUES})">([\\s\\S]*)</p>$`);
const ALIGNED_DIV = new RegExp(`^<div style="text-align:\\s*(${ALIGN_VALUES});?\\s*">([\\s\\S]*)</div>$`);

// Enveloppe d'alignement d'un paragraphe : alignement + bornes du contenu.
export function parseAlignedBlock(
  block: string,
): { align: TextAlignment; innerFrom: number; innerTo: number } | null {
  for (const re of [ALIGNED_P, ALIGNED_DIV]) {
    const match = re.exec(block);
    if (match) {
      const innerFrom = block.indexOf('>') + 1;
      return { align: match[1] as TextAlignment, innerFrom, innerTo: innerFrom + match[2].length };
    }
  }
  return null;
}

function isAlignableParagraph(block: string): boolean {
  const first = block.split('\n')[0];
  return !/^\s{0,3}(#{1,6}\s|[-*+]\s|\d+[.)]\s|>|\||`{3,}|~{3,}|<|\$\$|---\s*$)/.test(first);
}

export function applyAlignment(text: string, selection: Selection, align: TextAlignment): FormattingResult {
  const lines = text.split('\n');
  const starts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    starts.push(offset);
    offset += line.length + 1;
  }
  const lineOf = (pos: number) => {
    let index = 0;
    while (index + 1 < starts.length && starts[index + 1] <= pos) index += 1;
    return index;
  };
  const blank = (index: number) => lines[index].trim() === '';
  const selStart = Math.min(selection.start, selection.end);
  const selEnd = Math.max(selection.start, selection.end);
  let first = lineOf(selStart);
  // Fin de sélection en tout début de ligne : cette ligne n'est pas visée.
  let last = lineOf(selEnd > selStart && starts[lineOf(selEnd)] === selEnd ? selEnd - 1 : selEnd);
  while (first > 0 && !blank(first - 1) && !blank(first)) first -= 1;
  while (last + 1 < lines.length && !blank(last + 1) && !blank(last)) last += 1;

  // Paragraphes [début, fin] (indices de lignes) dans la zone.
  const paragraphs: [number, number][] = [];
  for (let index = first; index <= last; index += 1) {
    if (blank(index)) continue;
    let end = index;
    while (end + 1 <= last && !blank(end + 1)) end += 1;
    paragraphs.push([index, end]);
    index = end;
  }

  // Remplacements (en décalages absolus), puis report de la sélection.
  const edits: { from: number; to: number; insert: string; oldInnerFrom: number; openLength: number; innerLength: number }[] = [];
  for (const [startLine, endLine] of paragraphs) {
    const from = starts[startLine];
    const to = starts[endLine] + lines[endLine].length;
    const block = text.slice(from, to);
    const wrapped = parseAlignedBlock(block);
    if (!wrapped && !isAlignableParagraph(block)) continue;
    const inner = wrapped ? block.slice(wrapped.innerFrom, wrapped.innerTo) : block;
    const open = align === 'left' ? '' : `<p align="${align}">`;
    const insert = align === 'left' ? inner : `${open}${inner}</p>`;
    if (insert === block) continue;
    edits.push({
      from,
      to,
      insert,
      oldInnerFrom: from + (wrapped ? wrapped.innerFrom : 0),
      openLength: open.length,
      innerLength: inner.length,
    });
  }
  if (edits.length === 0) return { text, selection };

  const mapPos = (pos: number) => {
    let delta = 0;
    for (const edit of edits) {
      if (pos > edit.to) delta += edit.insert.length - (edit.to - edit.from);
      else if (pos >= edit.from) {
        // Dans le paragraphe : même position dans le CONTENU (bornée).
        const relative = Math.min(edit.innerLength, Math.max(0, pos - edit.oldInnerFrom));
        return edit.from + delta + edit.openLength + relative;
      }
    }
    return pos + delta;
  };

  let out = '';
  let cursor = 0;
  for (const edit of edits) {
    out += text.slice(cursor, edit.from) + edit.insert;
    cursor = edit.to;
  }
  out += text.slice(cursor);
  return { text: out, selection: { start: mapPos(selection.start), end: mapPos(selection.end) } };
}
