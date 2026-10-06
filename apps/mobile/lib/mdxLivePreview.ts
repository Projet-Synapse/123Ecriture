import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from '@codemirror/view';

import { isImageEmbedTarget } from './embedResolution';
import { findBold, findItalic, findLiveMatches, type LiveMatch, type TokenType } from './liveDecorations';

// Le vrai Live Preview inline (mode "Intermédiaire", voir components/
// MdxEditor.tsx) : un `ViewPlugin` CodeMirror qui décore le document selon
// les correspondances pures de lib/liveDecorations.ts — gras/italique
// stylés (marqueurs masqués), titres agrandis (préfixe "#…" masqué),
// liens/tags/occurrences remplacés par une pastille cliquable, EMBEDS
// IMAGES affichés en vrai (`![[photo.png]]` → l'image elle-même, façon
// Obsidian) — SAUF quand le curseur touche la syntaxe concernée, où le
// texte brut reste visible pour pouvoir l'éditer normalement.
//
// Toutes les plages sont d'abord COLLECTÉES puis triées via
// `Decoration.set(ranges, true)` : depuis que les marks sont DÉCOUPÉS autour
// des tokens (v2, voir liveDecorations.ts), les plages d'un même mark ne
// sont plus contiguës avec celles du token qu'il entoure — l'ajout direct
// au RangeSetBuilder dans l'ordre des correspondances (l'ancienne
// approche) replongeait en arrière et relevait le crash documenté "Ranges
// must be added sorted by `from` position and `startSide`", qui désactive
// le ViewPlugin en entier et en silence. Le tri par CodeMirror lui-même
// élimine cette classe de bug par construction — et permet gratuitement le
// découpage imbriqué des titres ci-dessous (segments gras/italique).

const ICON_BY_TOKEN_TYPE: Record<TokenType, string> = {
  wikilink: '🔗',
  tag: '#',
  occurrence: '🔤',
  embed: '📎',
};

export type LivePreviewColors = {
  accent: string;
  surface: string;
  border: string;
  textMuted: string;
};

export type LivePreviewCallbacks = {
  onOpenWikilink?: (target: string) => void;
  onOpenOccurrence?: (word: string) => void;
  // Résolution d'une cible d'embed en URI `data:` affichable — le widget
  // image du Live Preview l'appelle au montage. Le cache (éviter de relire
  // le fichier à CHAQUE frappe : le widget est recréé à chaque
  // buildDecorations) vit chez le fournisseur (NotesScreen.tsx), qui sait
  // quand le coffre actif change et peut l'invalider.
  resolveEmbedUrl?: (target: string) => Promise<string | null>;
};

class TokenPillWidget extends WidgetType {
  constructor(
    private readonly type: TokenType,
    private readonly label: string,
    private readonly target: string,
    private readonly colors: LivePreviewColors,
    private readonly callbacks: LivePreviewCallbacks,
  ) {
    super();
  }

  eq(other: TokenPillWidget): boolean {
    return other.type === this.type && other.label === this.label && other.target === this.target;
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.textContent = `${ICON_BY_TOKEN_TYPE[this.type]} ${this.label}`;
    span.style.color = this.colors.accent;
    span.style.backgroundColor = `${this.colors.accent}1a`;
    span.style.border = `1px solid ${this.colors.accent}55`;
    span.style.borderRadius = '4px';
    span.style.padding = '0 4px';
    span.style.fontSize = '0.9em';
    span.style.cursor = this.type === 'wikilink' || this.type === 'occurrence' ? 'pointer' : 'default';
    if (this.type === 'wikilink' && this.callbacks.onOpenWikilink) {
      const handler = this.callbacks.onOpenWikilink;
      span.addEventListener('mousedown', (event) => {
        event.preventDefault();
        handler(this.target);
      });
    }
    if (this.type === 'occurrence' && this.callbacks.onOpenOccurrence) {
      const handler = this.callbacks.onOpenOccurrence;
      span.addEventListener('mousedown', (event) => {
        event.preventDefault();
        handler(this.target);
      });
    }
    return span;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

// Image affichée en vrai dans le flux du texte (`![[photo.png]]`), façon
// Obsidian — le chemin passe par le même resolver que l'aperçu
// (readAttachmentDataUrl, qui cherche aussi par nom dans tout le coffre
// depuis v0.4.42, voir lib/embedResolution.ts). La lecture est asynchrone :
// le <img> est créé vide puis alimenté quand la data URL arrive ; en cas
// d'échec, on retombe sur la pastille pièce jointe historique. Le widget
// est recréé à chaque frappe : c'est le cache du RESOLVER (fourni par
// NotesScreen) qui empêche la relecture disque.
class EmbedImageWidget extends WidgetType {
  constructor(
    private readonly target: string,
    private readonly colors: LivePreviewColors,
    private readonly callbacks: LivePreviewCallbacks,
  ) {
    super();
  }

  eq(other: EmbedImageWidget): boolean {
    return other.target === this.target;
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement('span');
    wrap.style.display = 'inline-block';
    wrap.style.maxWidth = '100%';
    wrap.style.verticalAlign = 'top';

    const img = document.createElement('img');
    img.alt = this.target;
    img.style.display = 'block';
    img.style.maxWidth = '100%';
    // Plafond raisonnable : une photo pleine définition ne doit pas prendre
    // tout l'écran (comme Obsidian, qui limite aussi à la largeur du panneau).
    img.style.maxHeight = '360px';
    img.style.borderRadius = '6px';
    img.style.border = `1px solid ${this.colors.border}`;
    wrap.appendChild(img);

    const resolver = this.callbacks.resolveEmbedUrl;
    if (!resolver) {
      wrap.textContent = `${ICON_BY_TOKEN_TYPE.embed} ${this.target}`;
      return wrap;
    }
    resolver(this.target)
      .then((url) => {
        if (url) {
          img.src = url;
        } else {
          wrap.textContent = `⚠️ ${this.target}`;
          wrap.style.color = this.colors.textMuted;
        }
      })
      .catch(() => {
        wrap.textContent = `${ICON_BY_TOKEN_TYPE.embed} ${this.target}`;
        wrap.style.color = this.colors.accent;
      });
    return wrap;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

// Révélation STRICTEMENT intérieure (comme Obsidian) : le texte brut ne
// réapparaît que si la sélection chevauche l'intérieur de la syntaxe — le
// curseur collé à l'EXTÉRIEUR (juste avant le premier marqueur ou juste
// après le dernier) laisse la mise en forme en place. L'ancienne condition
// inclusive aux bornes (`<=`/`>=`) réveillait les marqueurs dès qu'on
// approchait le curseur : en se déplaçant dans une note, la mise en forme
// s'affichait/se masquait en cascade (rapporté : « l'apparition de la mise
// en forme est très chaotique en déplaçant le curseur »). Le curseur ENTRE
// les marqueurs (ex. sur le second `*` du `**` ouvrant) ou dans le contenu
// révèle toujours, pour pouvoir éditer la syntaxe elle-même.
function selectionTouches(view: EditorView, from: number, to: number): boolean {
  return view.state.selection.ranges.some((range) => range.from < to && range.to > from);
}

type DecorationRange = { from: number; to: number; decoration: Decoration };

// Garde-fou (lenteur de frappe rapportée) : les décorations du Live Preview
// coûtent une passe de détection sur TOUT le document à chaque frappe —
// linéaire et négligeable sur une note normale, mais 2,3 s mesuré par
// CARACTÈRE sur une note de 32 Mo (coffres réels : 3 fiches de cette
// taille). Au-delà de ce seuil, on retombe volontairement sur du texte
// brut (comportement Obsidian sur les notes énormes) : la frappe redevient
// instantanée, la mise en forme réapparaît dans les modes Source/Aperçu.
const MAX_LIVE_PREVIEW_CHARS = 500_000;

// Découpe RÉCURSIVE de [from, to) — masque les marqueurs de gras/italique
// IMBRIQUÉS (`**_texte_**`, `__** Corbeaux **__`, titres contenant du
// gras…) en cumulant les styles, et stylise le texte libre avec `style`.
// Corrige deux bugs vus en réel (2026-10-03) :
// 1. l'italique dans le gras (`**_Procédure_**`) était ABANDONNÉ par le
//    dédoublonnage de findLiveMatches — les `_` restaient visibles autour
//    du mot, seul le gras extérieur était décoré ;
// 2. l'ancienne segmentation des titres comparait une position RELATIVE
//    (segment.from, 0-based dans le contenu) à une position ABSOLUE
//    (cursor = contentFrom ≥ 2) : le PREMIER segment de chaque titre
//    (`##### **2•** …`) était systématiquement sauté, marqueurs visibles.
// `style` cumule ceux des ancêtres (titre → gras → italique). Chaque
// niveau de récursion consomme au moins les deux marqueurs, donc
// l'imbrication terminée est garantie ; les plages sortent de gauche à
// droite (le tri final de Decoration.set couvre le reste).
function pushMarkedRanges(ranges: DecorationRange[], text: string, from: number, to: number, style: string): void {
  const inner = [...findBold(text.slice(from, to)), ...findItalic(text.slice(from, to))].sort(
    (a, b) => a.from - b.from,
  );
  let cursor = from;
  const emitPlain = (f: number, t: number) => {
    if (f < t) ranges.push({ from: f, to: t, decoration: Decoration.mark({ attributes: { style } }) });
  };
  for (const segment of inner) {
    const absFrom = from + segment.from;
    const absTo = from + segment.to;
    if (absFrom < cursor) continue; // chevauche le segment retenu (dédoublonnage local)
    emitPlain(cursor, absFrom);
    ranges.push({ from: absFrom, to: absFrom + segment.markerLength, decoration: Decoration.replace({}) });
    pushMarkedRanges(
      ranges,
      text,
      absFrom + segment.markerLength,
      absTo - segment.markerLength,
      `${style};${segment.type === 'bold' ? 'font-weight:700' : 'font-style:italic'}`,
    );
    ranges.push({ from: absTo - segment.markerLength, to: absTo, decoration: Decoration.replace({}) });
    cursor = absTo;
  }
  emitPlain(cursor, to);
}

function buildDecorations(view: EditorView, colors: LivePreviewColors, callbacks: LivePreviewCallbacks, colorize: boolean): DecorationSet {
  // doc.length est O(1) : le garde-fou court AVANT tout toString().
  if (view.state.doc.length > MAX_LIVE_PREVIEW_CHARS) {
    return Decoration.none;
  }
  const text = view.state.doc.toString();
  const matches: LiveMatch[] = findLiveMatches(text);
  const ranges: DecorationRange[] = [];

  for (const match of matches) {
    const active = selectionTouches(view, match.from, match.to);

    if (match.kind === 'mark') {
      if (active) continue; // texte brut révélé pendant l'édition
      const styleClass = match.type === 'bold' ? 'font-weight:700' : 'font-style:italic';
      ranges.push({ from: match.from, to: match.from + match.markerLength, decoration: Decoration.replace({}) });
      // Le contenu est découpé en spans hors tokens (v2) ; chaque span passe
      // par le découpage récursif pour masquer à son tour les marqueurs de
      // gras/italique IMBRIQUÉS (`**_Procédure_**` : les `_` disparaissent
      // aussi — vécu 2026-10-03).
      for (const span of match.contentSpans) {
        pushMarkedRanges(ranges, text, span.from, span.to, styleClass);
      }
      ranges.push({ from: match.to - match.markerLength, to: match.to, decoration: Decoration.replace({}) });
    } else if (match.kind === 'heading') {
      // Taille PAR NIVEAU, nettement graduée (demande 2026-10-05 :
      // « les en-têtes ont leur taille ajustée en fonction de leur niveau »)
      // — l'ancienne échelle faisait h5/h6 à 1em, invisibles dans les notes
      // qui structurent leurs sections en #####.
      const sizeByLevel = [0, '2em', '1.75em', '1.5em', '1.3em', '1.15em', '1em'];
      if (!active) {
        ranges.push({ from: match.from, to: match.contentFrom, decoration: Decoration.replace({}) });
      }
      const headingStyle = `font-weight:700;font-size:${sizeByLevel[match.level]}${colorize ? `;color:${colors.accent}` : ''}`;
      // Un titre contenant un token ([[lien]] etc.) est DÉCOUPÉ (voir
      // liveDecorations.ts) : seuls les segments hors token portent le
      // style — la plage du token porte sa propre décoration. Chaque
      // segment passe par le découpage récursif : ses `**`/`__`/`_`/`*`
      // imbriqués sont masqués et stylés (vécu 2026-10-03 : le PREMIER
      // segment de titre gardait ses marqueurs visibles — comparaison
      // d'une position relative à une absolue dans l'ancien code).
      for (const span of match.contentSpans) {
        pushMarkedRanges(ranges, text, span.from, span.to, headingStyle);
      }
    } else {
      // token : wikilink/tag/occurrence/embed
      if (active) continue; // texte brut révélé pendant l'édition
      const widget = isImageEmbedTarget(match.target)
        ? new EmbedImageWidget(match.target, colors, callbacks)
        : new TokenPillWidget(match.type, match.label, match.target, colors, callbacks);
      ranges.push({ from: match.from, to: match.to, decoration: Decoration.replace({ widget, side: 0 }) });
    }
  }

  return Decoration.set(
    ranges.map((range) => range.decoration.range(range.from, range.to)),
    true,
  );
}

export function createLivePreviewExtension(
  colors: LivePreviewColors,
  callbacks: LivePreviewCallbacks,
  options?: {
    // Mobile uniquement : titres/contenu colorés avec l'accent (le rendu
    // vivant desktop reste monochrome, comme toujours).
    colorize?: boolean;
  },
) {
  const colorize = options?.colorize === true;
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = buildDecorations(view, colors, callbacks, colorize);
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.selectionSet || update.viewportChanged) {
          this.decorations = buildDecorations(update.view, colors, callbacks, colorize);
        }
      }
    },
    { decorations: (instance) => instance.decorations },
  );
}
