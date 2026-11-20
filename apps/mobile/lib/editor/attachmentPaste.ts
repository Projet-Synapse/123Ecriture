// ✒️ 123ECRITURE — lib/editor/attachmentPaste.ts — coller / glisser une pièce jointe dans l'éditeur
//////////////////////////////////////////////////////////////////////////////
//
// Extension CodeMirror partagée par l'éditeur desktop (MdxEditor) et la
// WebView Android (webview/editor-entry.tsx) : un FICHIER collé (capture
// d'écran, image copiée) ou glissé dans la note est lu en base64, confié
// à `importFile` (copie dans `<attachmentsFolder>/` du coffre, voir
// VaultBridge.importAttachmentData) puis remplacé par `![[nom]]` à
// l'endroit du curseur / du dépôt. Avant v0.4.99 : rien n'était géré —
// CodeMirror collait au mieux le CHEMIN ou le texte du fichier, jamais
// copié dans le coffre (lien « introuvable », rien de synchronisé).
//
// Invariants :
//   • Un collage qui porte du TEXTE (copie depuis une page, Word…) reste
//     un collage de texte ordinaire : seuls les presse-papiers « fichier
//     seul » deviennent pièces jointes.
//   • Échec d'import (coffre en lecture seule, quota…) : rien d'inséré,
//     `onError` prévenu — jamais un lien vers un fichier absent.
//
// SOMMAIRE :
//   1. Décisions pures (testées)
//   2. Lecture des fichiers et extension CodeMirror
//
//////////////////////////////////////////////////////////////////////////////

import { EditorView } from '@codemirror/view';

import { attachmentEmbed } from '../notes/embedResolution';

//////// 1. Décisions pures (testées) /////////////////////////////////////////

// Collage : pièce jointe seulement s'il y a des fichiers ET pas de texte.
export function isAttachmentPaste(fileCount: number, plainText: string): boolean {
  return fileCount > 0 && plainText.trim() === '';
}

// Texte inséré pour les fichiers importés (null = échec, ignoré) : un embed
// par ligne quand il y en a plusieurs.
export function embedsText(names: (string | null)[]): string {
  return names
    .filter((n): n is string => Boolean(n))
    .map(attachmentEmbed)
    .join('\n');
}

//////// 2. Lecture des fichiers et extension CodeMirror //////////////////////

export type AttachmentFile = { name: string; base64: string; mimeType: string };
// Renvoie le NOM final du fichier copié dans le coffre (suffixé si
// collision), ou null si l'import a échoué.
export type AttachmentImporter = (file: AttachmentFile) => Promise<string | null>;

export function readFileAsBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = typeof reader.result === 'string' ? reader.result : '';
      resolve(url.slice(url.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error('Lecture du fichier impossible.'));
    reader.readAsDataURL(file);
  });
}

async function importAll(files: File[], importFile: AttachmentImporter): Promise<(string | null)[]> {
  const names: (string | null)[] = [];
  for (const file of files) {
    try {
      const base64 = await readFileAsBase64(file);
      names.push(await importFile({ name: file.name, base64, mimeType: file.type }));
    } catch {
      names.push(null);
    }
  }
  return names;
}

export function attachmentPasteExtension(importFile: AttachmentImporter, onError?: (message: string) => void) {
  const handle = (view: EditorView, files: File[], pos: number) => {
    void importAll(files, importFile).then((names) => {
      const text = embedsText(names);
      if (names.some((n) => !n)) onError?.("Une pièce jointe n'a pas pu être copiée dans le coffre.");
      if (!text) return;
      const at = Math.min(pos, view.state.doc.length);
      view.dispatch({ changes: { from: at, insert: text }, selection: { anchor: at + text.length } });
      view.focus();
    });
  };
  return EditorView.domEventHandlers({
    paste(event, view) {
      const data = event.clipboardData;
      const files = data ? Array.from(data.files ?? []) : [];
      if (!isAttachmentPaste(files.length, data?.getData('text/plain') ?? '')) return false;
      event.preventDefault();
      const sel = view.state.selection.main;
      if (!sel.empty) view.dispatch({ changes: { from: sel.from, to: sel.to } });
      handle(view, files, view.state.selection.main.head);
      return true;
    },
    drop(event, view) {
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (files.length === 0) return false;
      event.preventDefault();
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.selection.main.head;
      handle(view, files, pos);
      return true;
    },
  });
}
