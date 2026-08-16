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
// Portée v1 volontairement réduite : gras `**...**` et italique `_..._`
// seulement (pas `*...*` pour l'italique — ambigu à désambiguïser
// proprement du gras en pur regex sans un vrai parseur, cut assumé).

export type MarkMatch = {
  kind: 'mark';
  type: 'bold' | 'italic';
  from: number;
  to: number;
  markerLength: number;
};

export type HeadingMatch = {
  kind: 'heading';
  from: number;
  to: number;
  level: number;
  contentFrom: number; // début du texte du titre, après "#… "
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

function findBold(text: string): MarkMatch[] {
  const matches: MarkMatch[] = [];
  const re = /\*\*([^*\n]+?)\*\*/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    matches.push({ kind: 'mark', type: 'bold', from: match.index, to: match.index + match[0].length, markerLength: 2 });
  }
  return matches;
}

function findItalic(text: string): MarkMatch[] {
  const matches: MarkMatch[] = [];
  const re = /_([^_\n]+?)_/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    matches.push({ kind: 'mark', type: 'italic', from: match.index, to: match.index + match[0].length, markerLength: 1 });
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
    });
  }
  return matches;
}

// `[[lien]]`/`[[lien|alias]]` et `![[embed]]` en une seule passe (l'embed
// est juste un lien précédé de `!`) — évite qu'un scan séparé des liens ne
// re-matche la partie `[[...]]` d'un embed comme un lien à part entière.
function findWikilinksAndEmbeds(text: string): TokenMatch[] {
  const matches: TokenMatch[] = [];
  const re = /(!)?\[\[([^\]]+?)\]\]/g;
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
  const re = /\{\{([^}]+?)\}\}/g;
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

// Toutes les correspondances du document, triées par position — pas de
// déduplication de chevauchement : les syntaxes reconnues ne se recoupent
// pas entre elles dans l'usage attendu (pas de gras imbriqué dans un lien,
// etc. — cut v1 assumé, voir le plan).
export function findLiveMatches(text: string): LiveMatch[] {
  const matches: LiveMatch[] = [
    ...findBold(text),
    ...findItalic(text),
    ...findHeadings(text),
    ...findWikilinksAndEmbeds(text),
    ...findTags(text),
    ...findOccurrences(text),
  ];
  matches.sort((a, b) => a.from - b.from);
  return matches;
}
