// ✒️ 123ECRITURE — lib/editor/liveDecorations.ts — repérage pur des syntaxes MDX à décorer
//////////////////////////////////////////////////////////////////////////////
//
// Repérage pur (regex, sans DOM ni CodeMirror) des syntaxes MDX décorées
// en mode "Intermédiaire" (Live Preview inline, voir components/
// MdxEditor.tsx / lib/mdxLivePreview.ts) — séparé du module CodeMirror
// pour rester testable sans dépendance lourde, comme les autres fichiers
// de lib/.
//
// Invariants du fichier :
//   • Ces règles sont volontairement DUPLIQUÉES (pas réutilisées) par
//     rapport à lib/markdownPlugins.ts : markdown-it produit un flux de
//     tokens pour tout le document orienté rendu final HTML, alors qu'ici
//     on repère des PLAGES dans le texte source pour les décorer pendant
//     la frappe (masquer/révéler selon la position du curseur) — deux
//     besoins différents, mêmes syntaxes reconnues.
//   • Toute plage qui traverse un retour à la ligne est écartée :
//     CodeMirror interdit les Decoration.replace multilignes (crash de
//     tout l'éditeur).
//   • Un token (wikilink/tag/occurrence/embed) gagne TOUJOURS sur la mise
//     en forme qui l'entoure — le mark est DÉCOUPÉ autour de lui, pas
//     l'inverse.
//   • Portée : gras `**...**` et `__...__`, italique `_..._` et `*...*`,
//     gras+italique `***...***` et `___...___` (v0.4.100), barré
//     `~~...~~`, souligné `<u>...</u>`.
//   • Un marqueur SANS partenaire (`**Présentation du mode_*`, `**1•`)
//     n'est jamais masqué : il reste visible en texte brut, pour pouvoir
//     repérer et corriger les astérisques parasites.
//   • `_` collé à une lettre/chiffre (snake_case, `mode_`) n'ouvre ni ne
//     ferme rien — même règle que le rendu Markdown (et Obsidian).
//
// SOMMAIRE :
//   1. Types des correspondances (mark, titre, token)
//   2. Détection des marks (gras, italique, titres)
//   3. Détection des tokens (wikilinks/embeds, tags, occurrences)
//   4. Dédoublonnage et découpage (subtractSpans, findLiveMatches)
//   5. Tableaux GFM (findTableBlocks)
//   6. Paragraphes alignés (findAlignedBlocks)
//
//////////////////////////////////////////////////////////////////////////////

//////// 1. Types des correspondances (mark, titre, token) ////////////////////

export type MarkMatch = {
  kind: 'mark';
  type: 'bold' | 'italic' | 'boldItalic' | 'strike' | 'underline';
  from: number;
  to: number;
  // Longueur du marqueur OUVRANT ; `closeLength` celle du fermant quand
  // elle diffère (`<u>` / `</u>`), sinon identique.
  markerLength: number;
  closeLength?: number;
  // Segments du CONTENU (entre les marqueurs) qui ne recouvrent aucun
  // token retenu — un token gagne toujours sur la mise en forme qui
  // l'entoure : le mark est DÉCOUPÉ autour de lui (les marqueurs **/_
  // restent masqués, le texte hors token reste stylé, la plage du token
  // appartient à sa propre décoration). Ex. `**texte [[lien]] suite**` →
  // marqueurs remplacés, spans = [texte] et [suite], le wikilink vit de
  // son côté.
  contentSpans: { from: number; to: number }[];
};

export type HeadingMatch = {
  kind: 'heading';
  from: number;
  to: number;
  level: number;
  contentFrom: number; // début du texte du titre, après "#… "
  // Même découpage que MarkMatch.contentSpans, appliqué au contenu du
  // titre : `# Titre avec [[lien]]` garde son préfixe masqué et son style,
  // le wikilink reste une pastille cliquable DANS le titre.
  contentSpans: { from: number; to: number }[];
};

export type TokenType = 'wikilink' | 'tag' | 'occurrence' | 'embed';

export type TokenMatch = {
  kind: 'token';
  type: TokenType;
  from: number;
  to: number;
  label: string;
  target: string;
};

export type LiveMatch = MarkMatch | HeadingMatch | TokenMatch;

//////// 2. Détection des marks (gras, italique, titres) ///////////////////////

// Exportés pour le découpage des titres en segments stylés
// (lib/mdxLivePreview.ts, mode Intermédiaire natif).
export function findBold(text: string): MarkMatch[] {
  const matches: MarkMatch[] = [];
  // Deux syntaxes de gras : `**…**` ET `__…__` (gras-underscore, style
  // Obsidian). L'italique `_…_` ne doit PAS matcher l'intérieur des
  // `__…__` : le dédoublonnage de findLiveMatches (premier match trié
  // gagne) s'en charge, le gras étant toujours positionné avant.
  for (const re of [/\*\*([^*\n]+?)\*\*/g, /__([^_\n]+?)__/g]) {
    let match: RegExpExecArray | null;
    while ((match = re.exec(text))) {
      if (re.source.startsWith('__') && !underscoreBoundaryOk(text, match.index, match.index + match[0].length)) {
        re.lastIndex = match.index + 1;
        continue;
      }
      matches.push({
        kind: 'mark',
        type: 'bold',
        from: match.index,
        to: match.index + match[0].length,
        markerLength: 2,
        contentSpans: [],
      });
    }
  }
  return matches;
}

const WORD_CHAR = /[\p{L}\p{N}]/u;

// `_` intra-mot (snake_case, `mode_`) : ni ouvrant ni fermant.
function underscoreBoundaryOk(text: string, from: number, to: number): boolean {
  const before = text[from - 1];
  const after = text[to];
  return !(before && WORD_CHAR.test(before)) && !(after && WORD_CHAR.test(after));
}

// Gras+italique `***…***` / `___…___` (v0.4.100) : sans cette règle, le
// triple était découpé en morceaux incohérents (`*` visibles, italique
// sur un seul astérisque).
export function findBoldItalic(text: string): MarkMatch[] {
  const matches: MarkMatch[] = [];
  for (const re of [/\*\*\*(?!\s)([^*\n]*?[^*\s])\*\*\*/g, /___(?!\s)([^_\n]*?[^_\s])___/g]) {
    let match: RegExpExecArray | null;
    while ((match = re.exec(text))) {
      const end = match.index + match[0].length;
      const delimiter = match[0][0];
      // Délimiteur supplémentaire collé (`****x***`) : ambigu, texte brut.
      if (text[match.index - 1] === delimiter || text[end] === delimiter) continue;
      if (delimiter === '_' && !underscoreBoundaryOk(text, match.index, end)) continue;
      matches.push({ kind: 'mark', type: 'boldItalic', from: match.index, to: end, markerLength: 3, contentSpans: [] });
    }
  }
  return matches;
}

// Toutes les marques de mise en forme d'un texte (une ligne ou un
// segment), triées par position — les recouvrements sont arbitrés par
// l'appelant (premier trié gagne ; à position égale, la plus LONGUE).
export function findAllMarks(text: string): MarkMatch[] {
  return [...findBoldItalic(text), ...findBold(text), ...findItalic(text), ...findStrikeAndUnderline(text)].sort(
    (a, b) => a.from - b.from || b.to - a.to,
  );
}

// Exporté pour le découpage des titres en segments stylés (voir findBold).
export function findItalic(text: string): MarkMatch[] {
  const matches: MarkMatch[] = [];
  // Deux syntaxes d'italique : `_…_` et `*…*`. Le contenu exige un
  // caractère NON espace en fin (`[^*\n]*\S`) et pas d'espace juste après
  // l'étoile ouvrante — `2 * 3 * 4` (multiplication) ne doit pas se
  // déguiser en italique, même règle de bordure que le rendu markdown
  // réel. Lookahead seulement (pas de lookbehind) : ce fichier est parsé
  // par Hermes en natif, qui ne le supporte pas.
  //
  // Garde anti-clignotement : un italique ACCOLÉ au même délimiteur à
  // l'extérieur (`**gras*` produit un faux `*gras*` intérieur, `__mot_` un
  // faux `_mot_`) est un GRAS EN COURS DE FRAPPE — le laisser stylé fait
  // basculer l'affichage italique → gras au dernier caractère tapé, il est
  // donc ignoré : texte brut pendant la frappe, puis le gras complet se
  // stylise d'un seul mouvement. (`**gras**` COMPLET reste couvert par le
  // gras, qui gagne au dédoublonnage de findLiveMatches.)
  const patterns: { re: RegExp; delimiter: string }[] = [
    { re: /_(?!\s)([^_\n]*?[^_\s])_/g, delimiter: '_' },
    // Contenu terminé par un caractère qui n'est ni espace NI `*` : sinon
    // `***` seul (début d'un gras+italique) passait pour un italique.
    { re: /\*(?!\s)([^*\n]*[^*\s])\*/g, delimiter: '*' },
  ];
  for (const { re, delimiter } of patterns) {
    let match: RegExpExecArray | null;
    while ((match = re.exec(text))) {
      const charBefore = text[match.index - 1];
      const charAfter = text[match.index + match[0].length];
      if (charBefore === delimiter || charAfter === delimiter) continue;
      if (delimiter === '_' && !underscoreBoundaryOk(text, match.index, match.index + match[0].length)) {
        re.lastIndex = match.index + 1;
        continue;
      }
      matches.push({
        kind: 'mark',
        type: 'italic',
        from: match.index,
        to: match.index + match[0].length,
        markerLength: 1,
        contentSpans: [],
      });
    }
  }
  return matches;
}

// Barré `~~…~~` (GFM) et souligné `<u>…</u>` (HTML) — sur une ligne.
export function findStrikeAndUnderline(text: string): MarkMatch[] {
  const matches: MarkMatch[] = [];
  const patterns: { re: RegExp; type: 'strike' | 'underline'; open: number; close: number }[] = [
    { re: /~~(?!\s)([^~\n]*[^~\s])~~/g, type: 'strike', open: 2, close: 2 },
    { re: /<u>([^<\n]+?)<\/u>/g, type: 'underline', open: 3, close: 4 },
  ];
  for (const { re, type, open, close } of patterns) {
    let match: RegExpExecArray | null;
    while ((match = re.exec(text))) {
      matches.push({
        kind: 'mark',
        type,
        from: match.index,
        to: match.index + match[0].length,
        markerLength: open,
        closeLength: close,
        contentSpans: [],
      });
    }
  }
  return matches;
}

// Longueur du marqueur fermant d'un mark.
export function closeLengthOf(match: MarkMatch): number {
  return match.closeLength ?? match.markerLength;
}

function findHeadings(text: string): HeadingMatch[] {
  const matches: HeadingMatch[] = [];
  const re = /^(#{1,6})[ \t]+(.*)$/gm;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    matches.push({
      kind: 'heading',
      from: match.index,
      to: match.index + match[0].length,
      level: match[1].length,
      contentFrom: match.index + match[0].length - match[2].length,
      contentSpans: [],
    });
  }
  return matches;
}

//////// 3. Détection des tokens (wikilinks/embeds, tags, occurrences) /////////

// `[[lien]]`/`[[lien|alias]]` et `![[embed]]` en une seule passe (l'embed
// est juste un lien précédé de `!`) — évite qu'un scan séparé des liens ne
// re-matche la partie `[[...]]` d'un embed comme un lien à part entière.
function findWikilinksAndEmbeds(text: string): TokenMatch[] {
  const matches: TokenMatch[] = [];
  // Un retour à la ligne exclu de la classe : un `[[` non refermé avalerait
  // des lignes entières et produirait une décoration multiligne — interdite
  // par CodeMirror (« Decorations.replace line breaks… », crash de tout
  // l'éditeur — voir findOccurrences).
  const re = /(!)?\[\[([^\]\n]+?)\]\]/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const isEmbed = Boolean(match[1]);
    const inner = match[2].trim();
    if (!inner) continue;
    const [target, alias] = inner.split('|');
    const trimmedTarget = target.trim();
    matches.push({
      kind: 'token',
      type: isEmbed ? 'embed' : 'wikilink',
      from: match.index,
      to: match.index + match[0].length,
      label: isEmbed ? trimmedTarget : (alias ?? target).trim(),
      target: trimmedTarget,
    });
  }
  return matches;
}

// Même logique de bordure que tagRule (lib/markdownPlugins.ts) : précédé
// d'un début de ligne/espace pour ne pas capturer un "#" au milieu d'un mot.
function findTags(text: string): TokenMatch[] {
  const matches: TokenMatch[] = [];
  const re = /(^|[\s\n\t])#([\p{L}\p{N}_-]+)/gu;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const hashOffset = match.index + match[1].length;
    matches.push({
      kind: 'token',
      type: 'tag',
      from: hashOffset,
      to: hashOffset + 1 + match[2].length,
      label: match[2],
      target: match[2],
    });
  }
  return matches;
}

function findOccurrences(text: string): TokenMatch[] {
  const matches: TokenMatch[] = [];
  // Un retour à la ligne exclu — même raison que findWikilinksAndEmbeds :
  // un `{{` de déco/sommaire fermé bien plus loin avalerait tout le bloc.
  const re = /\{\{([^}\n]+?)\}\}/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const word = match[1].trim();
    if (!word) continue;
    matches.push({
      kind: 'token',
      type: 'occurrence',
      from: match.index,
      to: match.index + match[0].length,
      label: word,
      target: word,
    });
  }
  return matches;
}

//////// 4. Dédoublonnage et découpage (subtractSpans, findLiveMatches) ////////

// Retire de [from, to) les plages de tokens retenues qui la chevauchent —
// renvoie les segments restants (troncature, jamais de suppression du
// marqueur lui-même). Les plages sont visitées dans l'ordre de la liste
// (triée par from en amont), les segments sortent donc triés.
function subtractSpans(from: number, to: number, blockers: TokenMatch[]): { from: number; to: number }[] {
  let segments: { from: number; to: number }[] = [{ from, to }];
  for (const token of blockers) {
    if (token.to <= from || token.from >= to) continue;
    const next: { from: number; to: number }[] = [];
    for (const segment of segments) {
      if (token.to <= segment.from || token.from >= segment.to) {
        next.push(segment);
        continue;
      }
      if (token.from > segment.from) next.push({ from: segment.from, to: token.from });
      if (token.to < segment.to) next.push({ from: token.to, to: segment.to });
    }
    segments = next;
  }
  return segments;
}

// Toutes les correspondances du document, triées par position, SANS
// chevauchement : le RangeSetBuilder de mdxLivePreview.ts exige des plages
// ajoutées dans l'ordre strictement croissant — deux correspondances
// imbriquées (ex. `**[[lien]]**` : gras contenant un wikilink) feraient
// revenir en arrière et déclencheraient « Ranges must be added sorted by
// `from` position and `startSide` », qui désactive le ViewPlugin ENTIERS
// et en silence pour tout le document : le mode "Intermédiaire" retombe
// alors visuellement en mode "Source" sans explication.
//
// Priorité des TOKENS (wikilink/embed/tag/occurrence) sur la mise en
// forme : les liens internes sont TOUJOURS détectés, même entourés de mise
// en forme. Deux passes : 1) on retient les tokens sans chevauchement
// ENTRE eux, 2) les marks/titres survivants sont DÉCOUPÉS autour des
// tokens (marqueurs masqués, contenu restant stylé via contentSpans)
// plutôt que d'éliminer le token. Marks entre eux : premier trié gagne
// (`_**gras**_` garde l'italique seul).
export function findLiveMatches(text: string): LiveMatch[] {
  const tokens = [...findWikilinksAndEmbeds(text), ...findTags(text), ...findOccurrences(text)];
  tokens.sort((a, b) => a.from - b.from);

  // Passe 1 — tokens entre eux : premier trié gagne (garde-fou anti-crash :
  // aucun chevauchement ne doit survivre entre tokens).
  const keptTokens: TokenMatch[] = [];
  let lastTokenTo = -1;
  for (const token of tokens) {
    if (token.from < lastTokenTo) continue;
    // Filet défensif (hérité du dédoublonnage v1) : CodeMirror interdit les
    // Decoration.replace qui traversent un retour à la ligne — une
    // correspondance multiligne ferait planter TOUT l'éditeur ; elle reste
    // simplement en texte brut.
    if (text.slice(token.from, token.to).includes('\n')) continue;
    keptTokens.push(token);
    lastTokenTo = token.to;
  }

  // Passe 2 — marks/titres : survivent s'ils ne chevauchent ni un token
  // retenu ni un autre mark déjà retenu ; leur contenu est découpé autour
  // des tokens.
  const others = [...findAllMarks(text), ...findHeadings(text)];
  others.sort((a, b) => a.from - b.from || b.to - a.to);

  const marksAndHeadings: (MarkMatch | HeadingMatch)[] = [];
  let lastOtherTo = -1;
  for (const match of others) {
    if (match.from < lastOtherTo) continue; // chevauche un mark déjà retenu
    // Filet défensif multiligne (voir passe 1) : une plage qui traverse un
    // retour à la ligne resterait en texte brut.
    if (text.slice(match.from, match.to).includes('\n')) continue;
    if (keptTokens.some((token) => token.from < match.to && token.to > match.from)) {
      // Chevauche un token retenu : on ne le garde PAS comme plage stylée
      // entière (elle recouvrirait le token), il est découpé ci-dessous —
      // mais ses MARQUEURS restent masqués : il vit donc quand même, en
      // morceaux. On pousse une copie avec contentSpans calculées, hors
      // du classement anti-chevauchement des plages entières.
      const contentFrom = match.kind === 'mark' ? match.from + match.markerLength : match.contentFrom;
      const contentTo = match.kind === 'mark' ? match.to - closeLengthOf(match) : match.to;
      match.contentSpans = subtractSpans(contentFrom, contentTo, keptTokens);
      marksAndHeadings.push(match);
      lastOtherTo = Math.max(lastOtherTo, match.to);
      continue;
    }
    const contentFrom = match.kind === 'mark' ? match.from + match.markerLength : match.contentFrom;
    const contentTo = match.kind === 'mark' ? match.to - closeLengthOf(match) : match.to;
    match.contentSpans = [{ from: contentFrom, to: contentTo }];
    marksAndHeadings.push(match);
    lastOtherTo = match.to;
  }

  const matches: LiveMatch[] = [...keptTokens, ...marksAndHeadings];
  matches.sort((a, b) => a.from - b.from);
  return matches;
}

//////// 5. Tableaux GFM (findTableBlocks) /////////////////////////////////////

export type TableBlock = {
  /** Décalage absolu du DÉBUT de la première ligne du tableau. */
  from: number;
  /** Décalage absolu de la FIN de la dernière ligne (juste avant le \n). */
  to: number;
  /** Texte brut du tableau, lignes jointes par \n — le widget de rendu le
   * consomme tel quel (et sert de clé d'égalité au mémo CodeMirror). */
  source: string;
};

// Ligne de séparation GFM : `| --- | :---: | ...` — tirets/deux-points et
// barres uniquement (au moins un tiret), espaces tolérés.
function isTableDelimiterLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes('-')) return false;
  const withoutEdges = trimmed.replace(/^\|/, '').replace(/\|$/, '');
  if (withoutEdges.trim() === '') return false;
  return withoutEdges.split('|').every((cell) => /^\s*:?-{3,}:?\s*$/.test(cell));
}

function lineContainsPipe(line: string): boolean {
  return line.includes('|');
}

// Détecte les tableaux GFM complets (en-tête + ligne de séparation + rangées)
// dans le texte : un tableau = suite de lignes consécutives contenant une
// barre, dont la DEUXIÈME est une ligne de séparation. Les blocs sans
// séparateur (une liste de barres quelconque) ne sont PAS des tableaux —
// ils restent en texte brut. Renvoie des plages en décalages absolus,
// triées, sans chevauchement (un bloc commence après la fin du précédent).
export function findTableBlocks(text: string): TableBlock[] {
  const lines = text.split('\n');
  const blocks: TableBlock[] = [];
  let offset = 0;
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (
      lineContainsPipe(line) &&
      index + 1 < lines.length &&
      lineContainsPipe(lines[index + 1]) &&
      isTableDelimiterLine(lines[index + 1])
    ) {
      // Début de tableau : consomme les lignes tant qu'elles contiennent une
      // barre (l'en-tête, le séparateur, puis les rangées).
      let endIndex = index;
      while (endIndex + 1 < lines.length && lineContainsPipe(lines[endIndex + 1])) {
        endIndex += 1;
      }
      const from = offset;
      const to = offset + lines.slice(index, endIndex + 1).join('\n').length;
      blocks.push({ from, to, source: lines.slice(index, endIndex + 1).join('\n') });
      index = endIndex + 1;
      offset = to + 1; // +1 pour le \n qui clôt la dernière ligne du bloc
      continue;
    }
    index += 1;
    offset += line.length + 1; // +1 pour le \n
  }
  return blocks;
}

//////// 6. Paragraphes alignés (findAlignedBlocks) ////////////////////////////

export type AlignedBlock = {
  align: 'left' | 'center' | 'right' | 'justify';
  // Bloc entier (de la balise ouvrante à la fermante incluse).
  from: number;
  to: number;
  // Balises à masquer hors édition (chacune sur UNE ligne).
  openTo: number;
  closeFrom: number;
  // Débuts de ligne du bloc (décoration de ligne text-align).
  lineStarts: number[];
};

const ALIGNED_OPEN_LIVE = /^<(p) align="(left|center|right|justify)">|^<(div) style="text-align:\s*(left|center|right|justify);?\s*">/;

// Même forme que la règle de rendu (markdownPlugins.ts, alignedBlockRule) :
// balise ouvrante en début de ligne, fermante en fin de ligne, sans ligne
// vide entre les deux.
export function findAlignedBlocks(text: string): AlignedBlock[] {
  const lines = text.split('\n');
  const blocks: AlignedBlock[] = [];
  let offset = 0;
  const starts = lines.map((line) => {
    const start = offset;
    offset += line.length + 1;
    return start;
  });
  for (let index = 0; index < lines.length; index += 1) {
    const open = ALIGNED_OPEN_LIVE.exec(lines[index]);
    if (!open) continue;
    const close = `</${open[1] ?? open[3]}>`;
    let last = index;
    while (last < lines.length && !lines[last].trimEnd().endsWith(close)) {
      if (last > index && lines[last].trim() === '') break;
      last += 1;
    }
    if (last >= lines.length || !lines[last].trimEnd().endsWith(close)) continue;
    const closeLineEnd = starts[last] + lines[last].trimEnd().length;
    const closeFrom = closeLineEnd - close.length;
    const openTo = starts[index] + open[0].length;
    if (closeFrom < openTo) continue;
    blocks.push({
      align: (open[2] ?? open[4]) as AlignedBlock['align'],
      from: starts[index],
      to: closeLineEnd,
      openTo,
      closeFrom,
      lineStarts: starts.slice(index, last + 1),
    });
    index = last;
  }
  return blocks;
}

//////// 7. Plan des décorations de mise en forme (planMark, planInline) ///////

// Morceau de décoration inline, calculé SANS CodeMirror (testable) :
//   • 'hide'   — marqueur masqué (Decoration.replace) ;
//   • 'marker' — marqueur RÉVÉLÉ : visible, éditable, estompé ;
//   • 'text'   — texte stylé (gras, italique, titre…).
export type InlinePiece = { from: number; to: number; kind: 'hide' | 'marker' | 'text'; style: string };

// Le curseur/la sélection « touche » une plage : DEDANS ou collé à ses
// bords (comportement Obsidian). Fournie par l'appelant.
export type TouchTest = (from: number, to: number) => boolean;

const REVEALED_MARKER_STYLE = 'opacity:0.55';

// Style CSS d'un mark (barré + souligné se cumulent : text-decoration-line
// porte les deux quand ils sont imbriqués).
export function markStyle(type: MarkMatch['type'], inherited: string): string {
  if (type === 'bold') return 'font-weight:700';
  if (type === 'italic') return 'font-style:italic';
  if (type === 'boldItalic') return 'font-weight:700;font-style:italic';
  const lines = /text-decoration-line:([^;]*)/.exec(inherited)?.[1]?.trim().split(/\s+/) ?? [];
  const next = type === 'strike' ? 'line-through' : 'underline';
  return `text-decoration-line:${[...new Set([...lines, next])].join(' ')}`;
}

function joinStyle(a: string, b: string): string {
  return a && b ? `${a};${b}` : a || b;
}

// Une marque : ses marqueurs sont MASQUÉS, sauf si la sélection la touche
// (ou touche une marque qui la contient) — ils sont alors visibles et
// éditables ; le contenu garde son style dans les deux cas (pas de saut
// de mise en page au clic).
export function planMark(
  text: string,
  mark: MarkMatch,
  spans: { from: number; to: number }[],
  inherited: string,
  touches: TouchTest,
  parentRevealed = false,
): InlinePiece[] {
  const revealed = parentRevealed || touches(mark.from, mark.to);
  const style = joinStyle(inherited, markStyle(mark.type, inherited));
  const closeLength = closeLengthOf(mark);
  const marker = (from: number, to: number): InlinePiece =>
    revealed ? { from, to, kind: 'marker', style: joinStyle(style, REVEALED_MARKER_STYLE) } : { from, to, kind: 'hide', style: '' };
  const pieces: InlinePiece[] = [marker(mark.from, mark.from + mark.markerLength)];
  for (const span of spans) pieces.push(...planInline(text, span.from, span.to, style, touches, revealed));
  pieces.push(marker(mark.to - closeLength, mark.to));
  return pieces;
}

// Découpe RÉCURSIVE de [from, to) : marques imbriquées (`**_x_**`, gras
// dans un titre…) avec styles cumulés ; le reste reçoit `style`. Un
// marqueur sans partenaire n'est pas une marque : il reste en texte.
export function planInline(
  text: string,
  from: number,
  to: number,
  style: string,
  touches: TouchTest,
  parentRevealed = false,
): InlinePiece[] {
  const pieces: InlinePiece[] = [];
  const emitText = (f: number, t: number) => {
    if (f < t && style) pieces.push({ from: f, to: t, kind: 'text', style });
  };
  let cursor = from;
  for (const segment of findAllMarks(text.slice(from, to))) {
    const absFrom = from + segment.from;
    const absTo = from + segment.to;
    if (absFrom < cursor) continue; // chevauche le segment retenu
    emitText(cursor, absFrom);
    const absolute: MarkMatch = { ...segment, from: absFrom, to: absTo };
    const inner = { from: absFrom + segment.markerLength, to: absTo - closeLengthOf(segment) };
    pieces.push(...planMark(text, absolute, [inner], style, touches, parentRevealed));
    cursor = absTo;
  }
  emitText(cursor, to);
  return pieces;
}
