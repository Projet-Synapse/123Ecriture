import { RangeSetBuilder } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from '@codemirror/view';

import { findLiveMatches, type LiveMatch, type TokenType } from './liveDecorations';

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

function buildDecorations(view: EditorView, colors: LivePreviewColors, callbacks: LivePreviewCallbacks): DecorationSet {
  const text = view.state.doc.toString();
  const matches: LiveMatch[] = findLiveMatches(text);
  const builder = new RangeSetBuilder<Decoration>();

  for (const match of matches) {
    const active = selectionTouches(view, match.from, match.to);

    if (match.kind === 'mark') {
      if (active) continue; // texte brut révélé pendant l'édition
      const styleClass = match.type === 'bold' ? 'font-weight:700' : 'font-style:italic';
      builder.add(
        match.from + match.markerLength,
        match.to - match.markerLength,
        Decoration.mark({ attributes: { style: styleClass } }),
      );
      builder.add(match.from, match.from + match.markerLength, Decoration.replace({}));
      builder.add(match.to - match.markerLength, match.to, Decoration.replace({}));
    } else if (match.kind === 'heading') {
      const sizeByLevel = [0, '1.5em', '1.3em', '1.15em', '1.05em', '1em', '1em'];
      builder.add(
        match.contentFrom,
        match.to,
        Decoration.mark({ attributes: { style: `font-weight:700;font-size:${sizeByLevel[match.level]}` } }),
      );
      if (!active) {
        builder.add(match.from, match.contentFrom, Decoration.replace({}));
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

export function createLivePreviewExtension(colors: LivePreviewColors, callbacks: LivePreviewCallbacks) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = buildDecorations(view, colors, callbacks);
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.selectionSet || update.viewportChanged) {
          this.decorations = buildDecorations(update.view, colors, callbacks);
        }
      }
    },
    { decorations: (instance) => instance.decorations },
  );
}
