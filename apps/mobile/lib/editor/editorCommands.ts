// ✒️ 123ECRITURE — lib/editor/editorCommands.ts — commandes de la barre d'outils vers l'éditeur WebView
//////////////////////////////////////////////////////////////////////////////
//
// Sur Android/iOS, l'éditeur CodeMirror vit dans une WebView
// (MdxEditorWeb.tsx + webview/editor-entry.tsx) : NotesScreen n'a pas
// d'EditorView sous la main (viewRef reste null). Les boutons de la barre
// d'outils passent donc par le pont RN → web sous forme de COMMANDES
// sérialisables (une fonction ne traverse pas injectJavaScript) ; la page
// web les applique sur SON EditorView avec la MÊME logique que le desktop
// (NOTES_TOOLBAR_ACTIONS / mdxFormatting.ts).
//
// Invariants du fichier :
//   • Une commande est du JSON pur : `format` (id d'action de la barre),
//     `undo`/`redo`, `insert` (texte inséré à la place de la sélection —
//     pièce jointe, modèle).
//   • parseEditorCommand rejette tout ce qui n'est pas une commande connue
//     (la page web n'exécute jamais un message arbitraire).
//   • applyTextCommand est PURE (texte + sélection → texte + sélection) ;
//     null = rien à appliquer (id inconnu, undo/redo traités à part).
//
// SOMMAIRE :
//   1. Types et (dé)sérialisation
//   2. Application pure (format / insert)
//   3. Routage des boutons natifs
//
//////////////////////////////////////////////////////////////////////////////

import type { FormattingResult, Selection } from './mdxFormatting';
import { NOTES_TOOLBAR_ACTIONS } from './notesToolbarActions';

//////// 1. Types et (dé)sérialisation /////////////////////////////////////

export type EditorCommand =
  | { kind: 'format'; id: string }
  | { kind: 'undo' }
  | { kind: 'redo' }
  | { kind: 'insert'; text: string };

export function parseEditorCommand(raw: unknown): EditorCommand | null {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== 'object') return null;
  const cmd = value as Record<string, unknown>;
  if (cmd.kind === 'undo' || cmd.kind === 'redo') return { kind: cmd.kind };
  if (cmd.kind === 'format' && typeof cmd.id === 'string') return { kind: 'format', id: cmd.id };
  if (cmd.kind === 'insert' && typeof cmd.text === 'string') return { kind: 'insert', text: cmd.text };
  return null;
}

// Script injecté dans la WebView (MdxEditorWeb) : double JSON.stringify →
// la page reçoit une CHAÎNE, jamais du code interprété.
export function editorCommandScript(cmd: EditorCommand): string {
  return `window.__editorApi && window.__editorApi.runCommand && window.__editorApi.runCommand(${JSON.stringify(JSON.stringify(cmd))});`;
}

//////// 2. Application pure (format / insert) ///////////////////////////////

export function applyTextCommand(text: string, selection: Selection, cmd: EditorCommand): FormattingResult | null {
  if (cmd.kind === 'insert') {
    const start = Math.min(selection.start, selection.end);
    const end = Math.max(selection.start, selection.end);
    const cursor = start + cmd.text.length;
    return { text: text.slice(0, start) + cmd.text + text.slice(end), selection: { start: cursor, end: cursor } };
  }
  if (cmd.kind === 'format') {
    const action = NOTES_TOOLBAR_ACTIONS.find((candidate) => candidate.id === cmd.id);
    if (!action || NATIVE_SPECIAL_IDS.has(action.id)) return null;
    return action.run(text, selection);
  }
  return null;
}

//////// 3. Routage des boutons natifs /////////////////////////////////////////

// Boutons qui ne sont PAS une mise en forme du texte : traités par
// NotesScreen (sélecteur de fichier, menu des modèles, correcteur) ou par
// l'historique de CodeMirror (undo/redo).
const NATIVE_SPECIAL_IDS = new Set(['attach', 'template', 'lint', 'undo', 'redo']);

export type ToolbarRoute = 'format' | 'undo' | 'redo' | 'attach' | 'template' | 'lint';

export function toolbarRoute(id: string): ToolbarRoute {
  if (id === 'undo' || id === 'redo' || id === 'attach' || id === 'template' || id === 'lint') return id;
  return 'format';
}
