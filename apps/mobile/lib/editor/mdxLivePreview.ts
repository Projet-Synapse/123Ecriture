import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from '@codemirror/view';
import { EditorState, StateField } from '@codemirror/state';

import { isImageEmbedTarget } from '../notes/embedResolution';
import { findBold, findItalic, findLiveMatches, findTableBlocks, type LiveMatch, type TokenType } from './liveDecorations';

// ✒️ 123ECRITURE — lib/editor/mdxLivePreview.ts — Live Preview inline CodeMirror (mode "Intermédiaire")
//////////////////////////////////////////////////////////////////////////////
//
// Le vrai Live Preview inline (mode "Intermédiaire", voir components/
// MdxEditor.tsx) : un `ViewPlugin` CodeMirror qui décore le document selon
// les correspondances pures de lib/liveDecorations.ts — gras/italique
// stylés (marqueurs masqués), titres agrandis (préfixe "#…" masqué),
// liens/tags/occurrences remplacés par une pastille cliquable, EMBEDS
// IMAGES affichés en vrai (`![[photo.png]]` → l'image elle-même, façon
// Obsidian) — SAUF quand le curseur touche la syntaxe concernée, où le
// texte brut reste visible pour pouvoir l'éditer normalement.
//
// Invariants du fichier :
//   • Toutes les plages sont COLLECTÉES puis triées via
//     `Decoration.set(ranges, true)` : les plages d'un même mark ne sont
//     plus contiguës avec celles du token qu'il entoure, et un ajout non
//     trié déclenche « Ranges must be added sorted by `from` position and
//     `startSide` » — crash qui désactive le ViewPlugin ENTIERS et en
//     silence. Le tri par CodeMirror lui-même élimine cette classe de bug
//     par construction, et permet le découpage imbriqué des titres
//     (segments gras/italique).
//   • La révélation est STRICTEMENT intérieure : le curseur collé à
//     l'extérieur de la syntaxe laisse la mise en forme en place.
//   • Au-delà de MAX_LIVE_PREVIEW_CHARS, texte brut : la détection est
//     linéaire sur tout le document à chaque frappe.
//   • Les tableaux rendus vivent dans un StateField : les replace BLOC
//     sont interdits depuis un ViewPlugin.
//
// SOMMAIRE :
//   1. Types, icônes et callbacks
//   2. Widgets (pastille de token, image d'embed, tableau GFM)
//   3. Révélation et garde-fou
//   4. Découpage récursif des marqueurs imbriqués (pushMarkedRanges)
//   5. buildDecorations — décorations inline
//   6. Tables BLOC via StateField
//   7. createLivePreviewExtension — assemblage
//
//////////////////////////////////////////////////////////////////////////////

//////// 1. Types, icônes et callbacks ////////////////////////////////////////

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

//////// 2. Widgets (pastille de token, image d'embed, tableau GFM) /////////////

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
// (readAttachmentDataUrl, qui cherche aussi par nom dans tout le coffre,
// voir lib/embedResolution.ts). La lecture est asynchrone : le <img> est
// créé vide puis alimenté quand la data URL arrive ; en cas d'échec, on
// retombe sur la pastille pièce jointe. Le widget est recréé à chaque
// frappe : c'est le cache du RESOLVER (fourni par NotesScreen) qui
// empêche la relecture disque.
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

// Tableau GFM rendu EN VRAI dans le flux. Comme chez Obsidian : le
// tableau rendu remplace le texte brut TANT QUE la sélection est hors du
// bloc — dès qu'on clique dedans, le texte brut revient pour éditer les
// cellules (voir buildDecorations). C'est un widget BLOC
// (Decoration.replace({ block: true })) : seule forme autorisée par
// CodeMirror pour remplacer plusieurs lignes d'un coup.
class TableWidget extends WidgetType {
  constructor(
    private readonly source: string,
    private readonly colors: LivePreviewColors,
  ) {
    super();
  }

  eq(other: TableWidget): boolean {
    return other.source === this.source;
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement('span');
    wrap.style.display = 'block';
    wrap.style.overflowX = 'auto';
    wrap.style.padding = '2px 0';

    const lines = this.source.split('\n');
    const splitRow = (line: string): string[] =>
      line
        .trim()
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map((cell) => cell.trim());

    const table = document.createElement('table');
    table.style.borderCollapse = 'collapse';
    table.style.margin = '4px 0';

    const cellStyle = (cell: HTMLTableCellElement, isHeader: boolean) => {
      cell.style.border = `1px solid ${this.colors.border}`;
      cell.style.padding = '3px 8px';
      if (isHeader) {
        cell.style.fontWeight = '700';
        cell.style.backgroundColor = `${this.colors.accent}14`;
      }
    };

    const buildRow = (line: string, tag: 'th' | 'td', isHeader: boolean): HTMLTableRowElement => {
      const tr = document.createElement('tr');
      for (const content of splitRow(line)) {
        const cell = document.createElement(tag);
        cell.textContent = content;
        cellStyle(cell, isHeader);
        tr.appendChild(cell);
      }
      return tr;
    };

    // Lignes 0/1 : en-tête + séparateur (garantis par findTableBlocks) ;
    // au-delà : les rangées. Le séparateur n'est jamais rendu.
    if (lines.length >= 2) {
      table.appendChild(buildRow(lines[0], 'th', true));
      for (let i = 2; i < lines.length; i += 1) {
        table.appendChild(buildRow(lines[i], 'td', false));
      }
    } else {
      // Garde défensive (findTableBlocks n'émet jamais ce cas) : texte brut.
      wrap.textContent = this.source;
      return wrap;
    }
    wrap.appendChild(table);
    return wrap;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

//////// 3. Révélation et garde-fou /////////////////////////////////////////////

// Révélation STRICTEMENT intérieure (comme Obsidian) : le texte brut ne
// réapparaît que si la sélection chevauche l'intérieur de la syntaxe — le
// curseur collé à l'EXTÉRIEUR (juste avant le premier marqueur ou juste
// après le dernier) laisse la mise en forme en place. Une condition
// inclusive aux bornes (`<=`/`>=`) réveillerait les marqueurs dès qu'on
// approche le curseur : en se déplaçant dans une note, la mise en forme
// s'affiche/se masque en cascade. Le curseur ENTRE les marqueurs (ex. sur
// le second `*` du `**` ouvrant) ou dans le contenu révèle toujours, pour
// pouvoir éditer la syntaxe elle-même.
function selectionTouches(view: EditorView, from: number, to: number): boolean {
  return view.state.selection.ranges.some((range) => range.from < to && range.to > from);
}

type DecorationRange = { from: number; to: number; decoration: Decoration };

// Garde-fou : les décorations du Live Preview coûtent une passe de
// détection sur TOUT le document à chaque frappe — linéaire et
// négligeable sur une note normale, mais lente au-delà. Au-delà de ce
// seuil, on retombe volontairement sur du texte brut (comportement
// Obsidian sur les notes énormes) : la frappe redevient instantanée, la
// mise en forme réapparaît dans les modes Source/Aperçu.
const MAX_LIVE_PREVIEW_CHARS = 500_000;

//////// 4. Découpage récursif des marqueurs imbriqués (pushMarkedRanges) ///////

// Découpe RÉCURSIVE de [from, to) — masque les marqueurs de gras/italique
// IMBRIQUÉS (`**_texte_**`, `__** Corbeaux **__`, titres contenant du
// gras…) en cumulant les styles, et stylise le texte libre avec `style`.
// Sans elle, l'italique dans le gras (`**_Procédure_**`) est abandonné par
// le dédoublonnage de findLiveMatches : les `_` restent visibles autour du
// mot, seul le gras extérieur est décoré.
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

//////// 5. buildDecorations — décorations inline ///////////////////////////////

function buildDecorations(view: EditorView, colors: LivePreviewColors, callbacks: LivePreviewCallbacks, colorize: boolean): DecorationSet {
  // doc.length est O(1) : le garde-fou court AVANT tout toString().
  if (view.state.doc.length > MAX_LIVE_PREVIEW_CHARS) {
    return Decoration.none;
  }
  const text = view.state.doc.toString();
  const matches: LiveMatch[] = findLiveMatches(text);
  const ranges: DecorationRange[] = [];

  // Tableaux GFM : les blocs SANS sélection dedans sont remplacés par une
  // table rendue — mais CodeMirror INTERDIT les décorations bloc depuis
  // un plugin (« Block decorations may not be specified via plugins ») :
  // elles passent donc par le StateField tableDecorationsField plus bas.
  // Ici on se contente d'ÉCARTER les correspondances de mise en forme qui
  // tombent dans un bloc rendu (elles décoreraient du texte masqué, et
  // des decorations qui se chevauchent avec un replace font planter
  // l'éditeur). Curseur dans le tableau : texte brut révélé, les
  // correspondances internes redeviennent actives comme partout.
  const renderedTables = findRenderedTables(view.state);
  const insideRenderedTable = (from: number, to: number): boolean =>
    renderedTables.some((block) => from < block.to && to > block.from);

  for (const match of matches) {
    if (insideRenderedTable(match.from, match.to)) continue;
    const active = selectionTouches(view, match.from, match.to);

    if (match.kind === 'mark') {
      if (active) continue; // texte brut révélé pendant l'édition
      const styleClass = match.type === 'bold' ? 'font-weight:700' : 'font-style:italic';
      ranges.push({ from: match.from, to: match.from + match.markerLength, decoration: Decoration.replace({}) });
      // Le contenu est découpé en spans hors tokens ; chaque span passe
      // par le découpage récursif pour masquer à son tour les marqueurs
      // de gras/italique IMBRIQUÉS (`**_Procédure_**` : les `_`
      // disparaissent aussi).
      for (const span of match.contentSpans) {
        pushMarkedRanges(ranges, text, span.from, span.to, styleClass);
      }
      ranges.push({ from: match.to - match.markerLength, to: match.to, decoration: Decoration.replace({}) });
    } else if (match.kind === 'heading') {
      // Taille PAR NIVEAU, nettement graduée — une échelle plate fait
      // h5/h6 à 1em, invisibles dans les notes qui structurent leurs
      // sections en #####.
      const sizeByLevel = [0, '2em', '1.75em', '1.5em', '1.3em', '1.15em', '1em'];
      if (!active) {
        ranges.push({ from: match.from, to: match.contentFrom, decoration: Decoration.replace({}) });
      }
      const headingStyle = `font-weight:700;font-size:${sizeByLevel[match.level]}${colorize ? `;color:${colors.accent}` : ''}`;
      // Un titre contenant un token ([[lien]] etc.) est DÉCOUPÉ (voir
      // liveDecorations.ts) : seuls les segments hors token portent le
      // style — la plage du token porte sa propre décoration. Chaque
      // segment passe par le découpage récursif : ses `**`/`__`/`_`/`*`
      // imbriqués sont masqués et stylés.
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

//////// 6. Tables BLOC via StateField /////////////////////////////////////////

// Les replace BLOC (qui couvrent plusieurs lignes — notre table rendue)
// sont interdits depuis un ViewPlugin (« Block decorations may not be
// specified via plugins ») : ils vivent dans un StateField, seule source
// autorisée. Recalculé quand le document OU la sélection change — c'est
// la sélection qui décide de la révélation (curseur dans le tableau =
// texte brut, comme Obsidian).
function computeTableDecorations(state: EditorState, colors: LivePreviewColors): DecorationSet {
  // Même garde-fou que buildDecorations : au-delà du seuil, texte brut.
  if (state.doc.length > MAX_LIVE_PREVIEW_CHARS) return Decoration.none;
  const rendered = findRenderedTables(state);
  if (rendered.length === 0) return Decoration.none;
  return Decoration.set(
    rendered.map((block) =>
      Decoration.replace({ widget: new TableWidget(block.source, colors), block: true }).range(block.from, block.to),
    ),
    true,
  );
}

// Version partagée avec buildDecorations : les blocs rendus par le champ
// (et seulement eux) voient leurs correspondances inline écartées.
function findRenderedTables(state: EditorState): { from: number; to: number; source: string }[] {
  if (state.doc.length > MAX_LIVE_PREVIEW_CHARS) return [];
  return findTableBlocks(state.doc.toString()).filter((block) =>
    state.selection.ranges.every((range) => !(range.from < block.to && range.to > block.from)),
  );
}

//////// 7. createLivePreviewExtension — assemblage /////////////////////////////

export function createLivePreviewExtension(
  colors: LivePreviewColors,
  callbacks: LivePreviewCallbacks,
  options?: {
    // Mobile uniquement : titres/contenu colorés avec l'accent.
    colorize?: boolean;
  },
) {
  const colorize = options?.colorize === true;
  // Les DEUX extensions (champ des tables + plugin des décorations inline)
  // doivent vivre dans l'éditeur : renvoi en tableau, CodeMirror aplati.
  // Le champ se crée PAR INSTANCE (couleurs du thème en closure) — un
  // StateField est un singleton par jeu d'extensions, pas global au process.
  const tableField = StateField.define<DecorationSet>({
    create: (state) => computeTableDecorations(state, colors),
    update: (value, tr) =>
      tr.docChanged || tr.selection ? computeTableDecorations(tr.state, colors) : value,
    provide: (field) => EditorView.decorations.from(field),
  });
  return [
    tableField,
    ViewPlugin.fromClass(
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
    ),
  ];
}
