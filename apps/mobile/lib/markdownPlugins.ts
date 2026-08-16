import MarkdownIt from 'markdown-it';

// API minimale de `StateInline` effectivement utilisée par les règles
// ci-dessous (src/pos/push) — plutôt que d'importer le vrai type : le
// .d.ts de markdown-it le regroupe sous un namespace (`MarkdownIt.StateInline`),
// pas atteignable proprement en `import type` classique avec la version
// installée, et risqué à contourner avec `import = require(...)` (syntaxe
// TS spécifique, pas garantie de bien passer par le bundler Metro utilisé
// par Expo). Une interface structurelle minimale suffit : TypeScript
// accepte sans problème qu'on lui passe le VRAI `StateInline` (plus riche)
// là où cette forme plus étroite est attendue (typage structurel).
interface InlineRuleState {
  src: string;
  pos: number;
  push(type: string, tag: string, nesting: number): { content: string; meta: unknown };
}
type StateInline = InlineRuleState;

// Extensions maison au-dessus de markdown-it (voir NoteRenderer.tsx pour le
// rendu) — trois règles INLINE, chacune poussant un token à un seul niveau
// (`nesting: 0`, via `state.push(type, '', 0)`) plutôt qu'une paire
// ouverture/fermeture : c'est ce qui permet à react-native-markdown-display
// de les traiter comme des feuilles de l'arbre au même titre que ses types
// intégrés (`text`, `link`...), sans rien connaître de plus sur elles — voir
// son `tokensToAST.js` (chaque token devient un nœud `{ type: token.type,
// ... }`) et `getTokenTypeByToken.js` (aucun traitement spécial en dehors
// des titres). Confirmé en lisant ces deux fichiers avant d'écrire ceci
// plutôt que de deviner.
//
// `[[Cible]]` / `[[Cible|Alias]]` — lien interne, façon Obsidian.
// `![[Pièce jointe]]` — embed (image/audio/fichier), syntaxe Obsidian,
// DISTINCTE de `[[lien]]` (pas juste une image markdown `![alt](url)`,
// gardée intacte : la règle rend la main si elle ne voit pas `![[`).
// `#tag` — tag, doit être précédé d'un début de ligne/espace pour ne pas
// capturer un "#" au milieu d'un mot (ex. un identifiant CSS collé dans du
// texte).

function wikilinkRule(state: StateInline, silent: boolean): boolean {
  const { src, pos } = state;
  if (src.charCodeAt(pos) !== 0x5b /* [ */ || src.charCodeAt(pos + 1) !== 0x5b) return false;

  const end = src.indexOf(']]', pos + 2);
  if (end === -1) return false;
  const inner = src.slice(pos + 2, end).trim();
  if (!inner) return false;

  if (!silent) {
    const [target, alias] = inner.split('|');
    const token = state.push('wikilink', '', 0);
    token.content = (alias ?? target).trim();
    token.meta = { target: target.trim() };
  }
  state.pos = end + 2;
  return true;
}

function embedRule(state: StateInline, silent: boolean): boolean {
  const { src, pos } = state;
  if (src.charCodeAt(pos) !== 0x21 /* ! */) return false;
  if (src.charCodeAt(pos + 1) !== 0x5b || src.charCodeAt(pos + 2) !== 0x5b) return false;

  const end = src.indexOf(']]', pos + 3);
  if (end === -1) return false;
  const target = src.slice(pos + 3, end).trim();
  if (!target) return false;

  if (!silent) {
    const token = state.push('embed', '', 0);
    token.content = target;
    token.meta = { target };
  }
  state.pos = end + 2;
  return true;
}

// `{{mot}}` — occurrence (voir la barre latérale, OccurrencesPanel.tsx) :
// mélange lien interne/mot-clé, un mot choisi à l'avance dans un
// dictionnaire personnel (`.123ecriture/occurrences.json`, voir
// apps/desktop/electron/occurrences.js). N'émet un token QUE si le mot
// existe dans `knownWords` (passé à createConfiguredMarkdownIt) — sinon la
// règle rend la main et le texte reste brut, cohérent avec "ce sont des
// mots qu'on choisit", pas une création à la volée à la simple frappe
// (contrairement à `[[lien]]`, qui lui crée la note cible au clic).
function makeOccurrenceRule(knownWords: Set<string>) {
  return function occurrenceRule(state: StateInline, silent: boolean): boolean {
    const { src, pos } = state;
    if (src.charCodeAt(pos) !== 0x7b /* { */ || src.charCodeAt(pos + 1) !== 0x7b) return false;

    const end = src.indexOf('}}', pos + 2);
    if (end === -1) return false;
    const word = src.slice(pos + 2, end).trim();
    if (!word || !knownWords.has(word.toLowerCase())) return false;

    if (!silent) {
      const token = state.push('occurrence', '', 0);
      token.content = word;
      token.meta = { target: word };
    }
    state.pos = end + 2;
    return true;
  };
}

const TAG_PATTERN = /^#([\p{L}\p{N}_-]+)/u;

function tagRule(state: StateInline, silent: boolean): boolean {
  const { src, pos } = state;
  if (src.charCodeAt(pos) !== 0x23 /* # */) return false;

  const prevChar = pos > 0 ? src.charCodeAt(pos - 1) : 0x20; // début de ligne traité comme "précédé d'un espace"
  const isWordBoundary = prevChar === 0x20 || prevChar === 0x0a || prevChar === 0x09;
  if (!isWordBoundary) return false;

  const match = TAG_PATTERN.exec(src.slice(pos));
  if (!match) return false;

  if (!silent) {
    const token = state.push('tag', '', 0);
    token.content = match[1];
  }
  state.pos = pos + match[0].length;
  return true;
}

// Nouvelle instance à chaque appel (pas de singleton module-level) : évite
// tout partage d'état mutable entre deux notes ouvertes/rendues en
// parallèle (peu probable dans cette app, mais ne coûte rien à éviter).
// `html: false` délibéré — pas d'injection HTML brut depuis le contenu
// d'une note.
// `knownWords` : mots du dictionnaire personnel connus au moment du rendu
// (voir NoteRenderer.tsx) — insensible à la casse (comparé en minuscules
// dans occurrenceRule). Vide par défaut : aucune `{{...}}` ne sera stylée
// tant que l'appelant·e ne fournit pas le dictionnaire réel.
export function createConfiguredMarkdownIt(knownWords: Set<string> = new Set()): MarkdownIt {
  const md = new MarkdownIt({ html: false, linkify: true, breaks: false });
  // `embed` avant `image` : `![[...]]` doit être capté avant que la règle
  // image standard n'essaie de lire `![...](...)`; si ce n'est pas le motif
  // `![[`, la règle rend la main (retourne false) et l'image standard
  // prend le relais normalement.
  md.inline.ruler.before('image', 'embed', embedRule);
  md.inline.ruler.before('link', 'wikilink', wikilinkRule);
  md.inline.ruler.before('emphasis', 'tag', tagRule);
  md.inline.ruler.before('emphasis', 'occurrence', makeOccurrenceRule(knownWords));
  return md;
}
