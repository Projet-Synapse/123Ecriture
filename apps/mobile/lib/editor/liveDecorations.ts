// Repérage pur (regex, sans DOM ni CodeMirror) des syntaxes MDX qu'on veut
// décorer en mode "Intermédiaire" (Live Preview inline, voir
// components/MdxEditor.tsx / lib/mdxLivePreview.ts) — séparé du module
// CodeMirror pour rester testable sans dépendance lourde, comme les autres
// fichiers de lib/. Ces règles sont volontairement DUPLIQUÉES (pas
// réutilisées) par rapport à lib/markdownPlugins.ts : markdown-it produit
// un flux de tokens pour tout le document orienté rendu final HTML, alors
// qu'ici on doit repérer des PLAGES dans le texte source pour les décorer
// pendant la frappe (masquer/révéler selon la position du curseur) — deux
// besoins différents, même si les syntaxes reconnues sont les mêmes.
//
// Portée : gras `**...**` et `__...__`, italique `_..._` et `*...*` (pas
// `***…***` triple — ambigu en pur regex sans un vrai parseur, cut assumé :
// le dédoublonnage ci-dessous lui fait quand même rendre quelque chose de
// lisible).

export type MarkMatch = {
  kind: 'mark';
  type: 'bold' | 'italic';
  from: number;
  to: number;
  markerLength: number;
  // Segments du CONTENU (entre les marqueurs) qui ne recouvrent aucun token
  // retenu — v2 « les liens internes doivent TOUJOURS être détectés » : un
  // token gagne toujours sur la mise en forme qui l'entoure, le mark est
  // donc DÉCOUPÉ autour de lui (les marqueurs **/_ restent masqués, le texte
  // hors token reste stylé, la plage du token appartient à sa propre
  // décoration). Ex. `**texte [[lien]] suite**` → marqueurs remplacés,
  // spans = [texte] et [suite], le wikilink vit de son côté.
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

// Exportés pour le découpage des titres en segments stylés
// (lib/mdxLivePreview.ts, mode Intermédiaire natif).
export function findBold(text: string): MarkMatch[] {
  const matches: MarkMatch[] = [];
  // Deux syntaxes de gras : `**…**` ET `__…__` (gras-underscore, style
  // Obsidian — vécu : les `__` restaient visibles autour du gras dans les
  // notes importées, ex. `__** Corbeaux **__`). L'italique `_…_` ne doit
  // PAS matcher l'intérieur des `__…__` : le dédoublonnage de
  // findLiveMatches (premier match trié gagne) s'en charge, le gras étant
  // toujours positionné avant.
  for (const re of [/\*\*([^*\n]+?)\*\*/g, /__([^_\n]+?)__/g]) {
    let match: RegExpExecArray | null;
    while ((match = re.exec(text))) {
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

// Exporté pour le découpage des titres en segments stylés (voir findBold).
export function findItalic(text: string): MarkMatch[] {
  const matches: MarkMatch[] = [];
  // Deux syntaxes d'italique : `_…_` et `*…*` (la seconde ajoutée
  // 2026-10-03 : les notes importées usent surtout de l'italique-étoile et
  // les `*` restaient visibles). Le contenu exige un caractère NON espace
  // en fin (`[^*\n]*\S`) et pas d'espace juste après l'étoile ouvrante —
  // `2 * 3 * 4` (multiplication) ne doit pas se déguiser en italique, même
  // règle de bordure que le rendu markdown réel. Lookahead seulement (pas
  // de lookbehind) : ce fichier est parsé par Hermes en natif, qui ne le
  // supporte pas.
  //
  // Garde anti-clignotement (rapporté : « l'apparition de la mise en forme
  // est très chaotique ») : un italique ACCOLÉ au même délimiteur à
  // l'extérieur (`**gras*` produit un faux `*gras*` intérieur, `__mot_` un
  // faux `_mot_`) est un GRAS EN COURS DE FRAPPE. Le laisser stylé faisait
  // basculer l'affichage italique → gras au dernier caractère tapé ; on
  // l'ignore — texte brut pendant la frappe, puis le gras complet se
  // stylise d'un seul mouvement. (`**gras**` COMPLET reste couvert par le
  // gras, qui gagne au dédoublonnage de findLiveMatches.)
  const patterns: { re: RegExp; delimiter: string }[] = [
    { re: /_([^_\n]+?)_/g, delimiter: '_' },
    { re: /\*(?!\s)([^*\n]*\S)\*/g, delimiter: '*' },
  ];
  for (const { re, delimiter } of patterns) {
    let match: RegExpExecArray | null;
    while ((match = re.exec(text))) {
      const charBefore = text[match.index - 1];
      const charAfter = text[match.index + match[0].length];
      if (charBefore === delimiter || charAfter === delimiter) continue;
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

// `[[lien]]`/`[[lien|alias]]` et `![[embed]]` en une seule passe (l'embed
// est juste un lien précédé de `!`) — évite qu'un scan séparé des liens ne
// re-matche la partie `[[...]]` d'un embed comme un lien à part entière.
function findWikilinksAndEmbeds(text: string): TokenMatch[] {
  const matches: TokenMatch[] = [];
  // Un retour à la ligne exclu de la classe : un `[[` non refermé avalerait
  // des lignes entières et produirait une décoration multiligne — interdite
  // par CodeMirror (« Decorations.replace line breaks… », crash de tout
  // l'éditeur, vécu sur un sommaire `{{…}}` multiligne de 3 Mo — voir
  // findOccurrences).
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
  // un `{{` de déco/sommaire fermé bien plus loin avalait tout le bloc
  // (3,1 Mo, crash CodeMirror vécu sur le desktop).
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
// chevauchement : mdxLivePreview.ts alimente un RangeSetBuilder CodeMirror
// qui exige des plages ajoutées dans l'ordre strictement croissant — deux
// correspondances imbriquées (ex. `**[[lien]]**` : gras contenant un
// wikilink) faisaient ajouter les morceaux du gras PUIS revenir en arrière
// pour le wikilink → "Ranges must be added sorted by `from` position and
// `startSide`" → CodeMirror désactive le ViewPlugin ENTIERS et en silence
// pour tout le document : le mode "Intermédiaire" retombait visuellement
// en mode "Source" sans explication (bug observé au lancement réel, même
// famille que celui documenté dans mdxLivePreview.ts pour l'ordre
// intra-correspondance).
//
// RÉSOLUTION v2 (demande utilisateur : « même s'il y a de la mise en forme
// autour, les liens internes doivent TOUJOURS être détectés ») — les TOKENS
// (wikilink/embed/tag/occurrence) gagnent sur la mise en forme : deux
// passes, 1) on retient les tokens sans chevauchement ENTRE eux, 2) les
// marks/titres survivants sont DÉCOUPÉS autour des tokens (marqueurs masqués,
// contenu restant stylé via contentSpans) plutôt que d'éliminer le token.
// Marks entre eux : premier trié gagne (inchangé — `_**gras**_` garde
// l'italique seul, comme avant).
export function findLiveMatches(text: string): LiveMatch[] {
  const tokens = [...findWikilinksAndEmbeds(text), ...findTags(text), ...findOccurrences(text)];
  tokens.sort((a, b) => a.from - b.from);

  // Passe 1 — tokens entre eux : premier trié gagne (aucun cas réel connu
  // de tokens imbriqués ; la garde reste le garde-fou anti-crash).
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
  const others = [...findBold(text), ...findItalic(text), ...findHeadings(text)];
  others.sort((a, b) => a.from - b.from);

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
      // mais ses MARQUEURS restent masqués, il vit donc quand même, en
      // morceaux : on pousse une copie avec contentSpans calculées, hors
      // du classement anti-chevauchement des plages entières.
      const contentFrom = match.kind === 'mark' ? match.from + match.markerLength : match.contentFrom;
      const contentTo = match.kind === 'mark' ? match.to - match.markerLength : match.to;
      match.contentSpans = subtractSpans(contentFrom, contentTo, keptTokens);
      marksAndHeadings.push(match);
      lastOtherTo = Math.max(lastOtherTo, match.to);
      continue;
    }
    const contentFrom = match.kind === 'mark' ? match.from + match.markerLength : match.contentFrom;
    const contentTo = match.kind === 'mark' ? match.to - match.markerLength : match.to;
    match.contentSpans = [{ from: contentFrom, to: contentTo }];
    marksAndHeadings.push(match);
    lastOtherTo = match.to;
  }

  const matches: LiveMatch[] = [...keptTokens, ...marksAndHeadings];
  matches.sort((a, b) => a.from - b.from);
  return matches;
}

// //8. 📊 TABLES (v0.4.50)
// ////////////////////////////////////////////////////////////////////////

export type TableBlock = {
  /** Décalage absolu du DÉBUT de la première ligne du tableau. */
  from: number;
  /** Décalage absolu de la FIN de la dernière ligne (juste avant le \n). */
  to: number;
  /** Texte brut du tableau, lignes jointes par \n — le widget de rendu le
   * consomme tel quel (et sert de clé d'égalité au mémo CodeMirror). */
  source: string;
};

// Ligne de séparation GFM : `| --- | :---: | ...` — tirets/ deux-points et
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
// ils restent en texte brut. Renvoie des plages en décalabs absolus, triées,
// sans chevauchement (un bloc commence après la fin du précédent).
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
