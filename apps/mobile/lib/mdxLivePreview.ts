import { RangeSetBuilder } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from '@codemirror/view';

import { findBold, findItalic, findLiveMatches, type LiveMatch, type TokenType } from './liveDecorations';

// Le vrai Live Preview inline (mode "Intermédiaire", voir components/
// MdxEditor.tsx) : un `ViewPlugin` CodeMirror qui décore le document selon
// les correspondances pures de lib/liveDecorations.ts — gras/italique
// stylés (marqueurs masqués), titres agrandis (préfixe "#…" masqué),
// liens/tags/occurrences/embeds remplacés par une pastille cliquable — SAUF
// quand le curseur touche la syntaxe concernée, où le texte brut reste
// visible pour pouvoir l'éditer normalement (comportement "façon Obsidian").
//
// Recalcule sur tout le document à chaque mise à jour pertinente (pas de
// scan limité aux lignes visibles) — plus simple, suffisant pour la taille
// de note attendue ; à revoir si ça devient un vrai goulot sur de très
// grosses notes.

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
    span.textContent = `${ICON_BY_TOKEN_TYPE[this.type]} ${this.type === 'tag' ? this.label : this.label}`;
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

// Un peu de marge autour d'une correspondance pour décider si le curseur la
// "touche" — inclut la position juste après la syntaxe (curseur qui vient
// de la fermer) en plus de l'intérieur strict.
function selectionTouches(view: EditorView, from: number, to: number): boolean {
  return view.state.selection.ranges.some((range) => range.from <= to && range.to >= from);
}

// Découpe [from, to) en stylant le texte libre avec `style` et en masquant
// les marqueurs de gras/italique IMBRIQUÉS (`**_texte_**`, `# __Titre__`…),
// style cumulé au sien, récursivement. Corrige deux bugs vus sur le
// téléphone (2026-10-03) :
// 1. l'italique dans le gras (`**_Procédure_**`) était ABANDONNÉ par le
//    dédoublonnage de findLiveMatches — les `_` restaient visibles autour
//    du mot, seul le gras extérieur était décoré ;
// 2. l'ancienne segmentation des titres comparait une position RELATIVE
//    (segment.from, 0-based dans le contenu) à une position ABSOLUE
//    (cursor = contentFrom ≥ 2) : le PREMIER segment de chaque titre
//    (`##### **2•** …`) était systématiquement sauté, marqueurs visibles.
// `style` cumule ceux des ancêtres (titre → gras → italique) ; les plages
// sont émises de gauche à droite (contrainte d'ordre du RangeSetBuilder).
// Chaque niveau de récursion consomme au moins les deux marqueurs, donc
// l'imbrication terminée est garantie.
function addMarkedRange(
  builder: RangeSetBuilder<Decoration>,
  text: string,
  from: number,
  to: number,
  style: string,
): void {
  const inner = [...findBold(text.slice(from, to)), ...findItalic(text.slice(from, to))].sort(
    (a, b) => a.from - b.from,
  );
  let cursor = from;
  const emitPlain = (f: number, t: number) => {
    if (f < t) builder.add(f, t, Decoration.mark({ attributes: { style } }));
  };
  for (const segment of inner) {
    const absFrom = from + segment.from;
    const absTo = from + segment.to;
    if (absFrom < cursor) continue; // chevauche le segment retenu (dédoublonnage local)
    emitPlain(cursor, absFrom);
    builder.add(absFrom, absFrom + segment.markerLength, Decoration.replace({}));
    addMarkedRange(
      builder,
      text,
      absFrom + segment.markerLength,
      absTo - segment.markerLength,
      `${style};${segment.type === 'bold' ? 'font-weight:700' : 'font-style:italic'}`,
    );
    builder.add(absTo - segment.markerLength, absTo, Decoration.replace({}));
    cursor = absTo;
  }
  emitPlain(cursor, to);
}

function buildDecorations(
  view: EditorView,
  colors: LivePreviewColors,
  callbacks: LivePreviewCallbacks,
  colorize: boolean,
): DecorationSet {
  const text = view.state.doc.toString();
  const matches: LiveMatch[] = findLiveMatches(text);
  const builder = new RangeSetBuilder<Decoration>();

  for (const match of matches) {
    const active = selectionTouches(view, match.from, match.to);

    if (match.kind === 'mark') {
      if (active) continue; // texte brut révélé pendant l'édition
      const styleClass = match.type === 'bold' ? 'font-weight:700' : 'font-style:italic';
      // RangeSetBuilder exige des plages ajoutées dans l'ordre STRICTEMENT
      // croissant de `from` — le marqueur ouvrant (from) doit donc être
      // ajouté AVANT le contenu stylé (from+markerLength), lui-même avant
      // le marqueur fermant. Les ajouter dans le mauvais ordre (contenu
      // d'abord, marqueurs ensuite, comme précédemment) fait planter tout
      // le builder pour CE document — CodeMirror désactive alors le
      // ViewPlugin en entier, silencieusement, dès la première occurrence
      // de gras/italique : c'est ce qui faisait ressembler le mode
      // "Intermédiaire" au mode "Source" (aucune décoration nulle part),
      // confirmé en lançant l'app réelle (console : "Ranges must be added
      // sorted by `from` position and `startSide`").
      builder.add(match.from, match.from + match.markerLength, Decoration.replace({}));
      addMarkedRange(builder, text, match.from + match.markerLength, match.to - match.markerLength, styleClass);
      builder.add(match.to - match.markerLength, match.to, Decoration.replace({}));
    } else if (match.kind === 'heading') {
      const sizeByLevel = [0, '1.5em', '1.3em', '1.15em', '1.05em', '1em', '1em'];
      const headingMark = `${colorize ? `color:${colors.accent};` : ''}font-weight:700;font-size:${sizeByLevel[match.level] ?? '1em'}`;
      // Même contrainte d'ordre croissant que pour 'mark' ci-dessus : le
      // préfixe masqué (from → contentFrom) doit être ajouté AVANT le
      // contenu stylé (contentFrom → to), pas après.
      if (active) {
        builder.add(
          match.contentFrom,
          match.to,
          Decoration.mark({ attributes: { style: headingMark } }),
        );
      } else {
        builder.add(match.from, match.contentFrom, Decoration.replace({}));
        // Le contenu du titre passe par le même découpage récursif : ses
        // `**`/`__`/`_`/`*` imbriqués sont masqués et stylés (le dedup de
        // findLiveMatches saute sinon tout ce qui chevauche un titre).
        addMarkedRange(builder, text, match.contentFrom, match.to, headingMark);
      }
    } else {
      // token : wikilink/tag/occurrence/embed
      if (active) continue; // texte brut révélé pendant l'édition
      const widget = new TokenPillWidget(match.type, match.label, match.target, colors, callbacks);
      builder.add(match.from, match.to, Decoration.replace({ widget, side: 0 }));
    }
  }

  return builder.finish();
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
