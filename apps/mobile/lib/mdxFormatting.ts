// Fonctions pures de transformation de texte pour la barre de formatage de
// l'éditeur MDX (components/NotesScreen.tsx). Volontairement séparées du
// composant pour rester testables sans RN — voir le script de vérification
// utilisé lors du développement dans le message de commit associé.

export type Selection = { start: number; end: number };
export type FormattingResult = { text: string; selection: Selection };

function getLineRange(text: string, index: number): { lineStart: number; lineEnd: number } {
  const lineStart = text.lastIndexOf('\n', index - 1) + 1;
  const nextBreak = text.indexOf('\n', index);
  const lineEnd = nextBreak === -1 ? text.length : nextBreak;
  return { lineStart, lineEnd };
}

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
