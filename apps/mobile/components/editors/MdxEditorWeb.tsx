import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Keyboard, Platform, StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { editorCommandScript, type EditorCommand } from '../../lib/editor/editorCommands';
import { withImageMime } from '../../lib/files/imageFormats';
import { CaretRevealContext } from '../../lib/ui/caretReveal';
import { EDITOR_WEB_BUNDLE } from '../generated/editorWebBundle';
import type { Theme } from '../../theme';

// ✒️ 123ECRITURE — components/editors/MdxEditorWeb.tsx — l'éditeur CodeMirror natif (WebView)
//////////////////////////////////////////////////////////////////////////////
//
// Éditeur CodeMirror embarqué dans une WebView — les modes Source et
// Intermédiaire NATIFS, avec les mêmes fonctionnement et particularités
// que sur ordinateur : le bundle est le MÊME @uiw/react-codemirror que le
// desktop (webview/editor-entry.tsx, généré dans
// generated/editorWebBundle.ts — tout est embarqué, aucun réseau).
//
// Invariants du fichier :
//   • Pont bidirectionnel : web → RN postMessage {type: 'change'|
//     'wikilink'|'createOccurrence'|'ready'|'height'|'configApplied'}
//     (frappe throttlée côté web, 300 ms + flush au blur) ; RN → web via
//     injectJavaScript vers window.__editorApi (applyDoc, applyConfig,
//     runCommand — barre d'outils native, voir commandRef).
//   • applyDoc n'est envoyé que pour un changement EXTERNE (changement de
//     note, pull de synchro) — les échos de frappe sont filtrés par
//     lastWebContent. Côté web, applyDoc ignore en plus tout texte que la
//     page a déjà émis (écho en retard, renvois du `ready`) et applique le
//     reste en diff, curseur préservé (lib/editor/docSync.ts).
//   • Les callbacks stables (onMessage) lisent les derniers handlers via
//     des refs mises à jour en EFFET, jamais pendant le rendu.
//   • editorBackground n'est PAS transmis : la WebView suit le fond de
//     l'app (la préférence donnait une page blanche en thème sombre).
//
// SOMMAIRE :
//   1. Pont RN → web (config, document)
//   2. Pont web → RN (messages) et synchronisation externe
//
//////////////////////////////////////////////////////////////////////////////

//////// 1. Pont RN → web (config, document) ///////////////////////////////
type Props = {
  value: string;
  onChange: (text: string) => void;
  onOpenWikilink: (target: string) => void;
  onCreateOccurrence?: (word: string) => Promise<void>;
  occurrenceWords: string[];
  noteNames: string[];
  // Liens non résolus atténués : la WebView refait la résolution chez elle
  // (lib/notes/wikilinkResolution.ts, la même que le clic côté RN) à partir
  // des chemins des notes et de la note courante — une fonction ne passe
  // pas le pont postMessage. Renvoyés via applyConfig à chaque changement
  // de l'arbre ou de note.
  notePaths?: string[];
  currentRelPath?: string | null;
  theme: Theme;
  fontSize: number;
  fontFamily: string;
  closeBrackets: boolean;
  // false = mode Source : le même CodeMirror SANS l'aperçu vivant (le
  // TextInput natif ne permettait pas de barre de défilement manipulable —
  // tous les modes passent par la WebView).
  livePreview?: boolean;
  // Mobile : la WebView se dimensionne à son contenu (hauteur renvoyée par
  // le web) et vit dans le ScrollView natif de l'éditeur — le bloc
  // Propriétés défile alors avec le texte, comme sur desktop.
  autoHeight?: boolean;
  // Images des embeds `![[photo.jfif]]` dans l'aperçu vivant : la WebView
  // demande la data URL par le pont (`resolveEmbed`), même résolveur (et
  // même cache) que le desktop. Absent = pastille 📎 comme avant.
  resolveEmbedUrl?: (target: string) => Promise<string | null>;
  // Fichier collé / glissé dans la note (lib/editor/attachmentPaste.ts) :
  // copié dans le coffre, renvoie le nom final (null = échec). Absent =
  // collage CodeMirror ordinaire.
  importAttachment?: (file: { name: string; base64: string; mimeType?: string }) => Promise<string | null>;
  onAttachmentError?: (message: string) => void;
  // Barre d'outils native : reçoit la fonction qui envoie une commande
  // (mise en forme, annuler/rétablir, insertion) à l'éditeur de la page —
  // null au démontage. Voir lib/editor/editorCommands.ts.
  commandRef?: { current: ((cmd: EditorCommand) => void) | null };
};

export function MdxEditorWeb({
  value,
  onChange,
  onOpenWikilink,
  onCreateOccurrence,
  occurrenceWords,
  noteNames,
  notePaths,
  currentRelPath,
  theme,
  fontSize,
  fontFamily,
  closeBrackets,
  livePreview = true,
  autoHeight = false,
  resolveEmbedUrl,
  importAttachment,
  onAttachmentError,
  commandRef,
}: Props) {
  const [webHeight, setWebHeight] = useState(200);
  const webRef = useRef<WebView>(null);
  // Curseur visible au-dessus du clavier (lib/ui/caretReveal.ts) : la page
  // envoie `caret` (coordonnées dans la WebView), converties ici en
  // coordonnées fenêtre pour le ScrollView natif englobant.
  const containerRef = useRef<View>(null);
  const revealCaret = useContext(CaretRevealContext);
  const revealCaretRef = useRef(revealCaret);
  useEffect(() => {
    revealCaretRef.current = revealCaret;
  }, [revealCaret]);
  // Dernier contenu CONNU du web : filtre les échos (le change renvoyé par
  // le web pour notre propre applyDoc ne repart pas vers onChange).
  const lastWebContent = useRef(value);
  // Derniers callbacks, lus par onMessage (stable) sans le recréer : mis à
  // jour en EFFET et non pendant le rendu (refs figées pendant le rendu —
  // rendu concurrent React ; eslint react-hooks/refs).
  const onChangeRef = useRef(onChange);
  const onOpenWikilinkRef = useRef(onOpenWikilink);
  const onCreateOccurrenceRef = useRef(onCreateOccurrence);
  const resolveEmbedUrlRef = useRef(resolveEmbedUrl);
  const importAttachmentRef = useRef(importAttachment);
  const onAttachmentErrorRef = useRef(onAttachmentError);
  useEffect(() => {
    onChangeRef.current = onChange;
    onOpenWikilinkRef.current = onOpenWikilink;
    onCreateOccurrenceRef.current = onCreateOccurrence;
    resolveEmbedUrlRef.current = resolveEmbedUrl;
    importAttachmentRef.current = importAttachment;
    onAttachmentErrorRef.current = onAttachmentError;
  }, [onChange, onOpenWikilink, onCreateOccurrence, resolveEmbedUrl, importAttachment, onAttachmentError]);

  const inject = useCallback((script: string) => {
    webRef.current?.injectJavaScript(`${script}; true;`);
  }, []);

  // Commandes de la barre d'outils native → page web (editorCommands.ts).
  useEffect(() => {
    if (!commandRef) return;
    const run = (cmd: EditorCommand) => inject(editorCommandScript(cmd));
    commandRef.current = run;
    return () => {
      if (commandRef.current === run) commandRef.current = null;
    };
  }, [commandRef, inject]);

  const sendDoc = useCallback(
    (text: string) => {
      inject(`window.__editorApi && window.__editorApi.applyDoc(${JSON.stringify(text)});`);
    },
    [inject],
  );

  const sendConfig = useCallback(() => {
    const payload = JSON.stringify({
      fontSize,
      fontFamily,
      closeBrackets,
      livePreview,
      autoHeight,
      embeds: Boolean(resolveEmbedUrl),
      attachments: Boolean(importAttachment),
      occurrenceWords,
      noteNames,
      notePaths: notePaths ?? null,
      currentRelPath: currentRelPath ?? null,
      colors: {
        accent: theme.accent,
        border: theme.border,
        text: theme.text,
        textMuted: theme.textMuted,
        background: theme.background,
        surface: theme.surface,
        // ⚠️ editorBackground volontairement NON transmis sur mobile : la
        // préférence (blanc par défaut) donnait une page blanche en thème
        // sombre — l'éditeur suit le fond de l'app à la place (même
        // rendu que l'éditeur Source natif).
      },
    });
    inject(`window.__editorApi && window.__editorApi.applyConfig(${JSON.stringify(payload)});`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inject, fontSize, fontFamily, closeBrackets, livePreview, occurrenceWords, noteNames, notePaths, currentRelPath, theme, resolveEmbedUrl, importAttachment]);

//////// 2. Pont web → RN (messages) et synchronisation externe ////////////

  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      let message: {
        type?: string;
        content?: string;
        target?: string;
        word?: string;
        id?: number;
        height?: number;
        top?: number;
        bottom?: number;
        bg?: string;
        accent?: string;
        autoHeight?: boolean;
        name?: string;
        base64?: string;
        mimeType?: string;
        message?: string;
      };
      try {
        message = JSON.parse(event.nativeEvent.data) as typeof message;
      } catch {
        return;
      }
      if (message.type === 'ready') {
        sendConfig();
        // Le web démarre avec un doc vide : pousser le contenu courant.
        sendDoc(lastWebContent.current);
        // Filet anti-course : au cas où le 1er applyConfig part avant que
        // le page soit prêt à l'appliquer, on renvoie config + doc pendant
        // 10 s. Le web confirme via 'configApplied' (logcat).
        let retries = 0;
        const retry = setInterval(() => {
          retries += 1;
          sendConfig();
          sendDoc(lastWebContent.current);
          if (retries >= 5) clearInterval(retry);
        }, 2000);
        return;
      }
      if (message.type === 'change' && typeof message.content === 'string') {
        lastWebContent.current = message.content;
        if (message.content !== value) onChangeRef.current(message.content);
        return;
      }
      if (message.type === 'caret' && typeof message.top === 'number' && typeof message.bottom === 'number') {
        const reveal = revealCaretRef.current;
        const { top, bottom } = message;
        if (reveal) containerRef.current?.measureInWindow((_x, y) => reveal(y + top, y + bottom));
        return;
      }
      if (message.type === 'height' && typeof message.height === 'number') {
        // [diag] hauteur renvoyée par la page web (auto-hauteur)
        console.error('[webview-diag] hauteur web :', Math.ceil(message.height));
        setWebHeight(Math.max(200, Math.ceil(message.height)));
        return;
      }
      if (message.type === 'configApplied') {
        console.error(
          '[webview-diag] config appliquée côté web :',
          JSON.stringify({ bg: message.bg, accent: message.accent, autoHeight: message.autoHeight }),
        );
        return;
      }
      if (message.type === 'wikilink' && typeof message.target === 'string') {
        onOpenWikilinkRef.current(message.target);
        return;
      }
      if (message.type === 'resolveEmbed' && typeof message.id === 'number' && typeof message.target === 'string') {
        const id = message.id;
        const target = message.target;
        const resolver = resolveEmbedUrlRef.current;
        void (resolver ? resolver(target).catch(() => null) : Promise.resolve(null)).then((url) => {
          const safeUrl = url ? withImageMime(url, target) : null;
          inject(`window.__editorApi && window.__editorApi.embedResolved(${id}, ${JSON.stringify(safeUrl)});`);
        });
        return;
      }
      if (message.type === 'importAttachment' && typeof message.id === 'number' && typeof message.base64 === 'string') {
        const id = message.id;
        const importer = importAttachmentRef.current;
        const file = {
          name: typeof message.name === 'string' ? message.name : '',
          base64: message.base64,
          mimeType: typeof message.mimeType === 'string' ? message.mimeType : undefined,
        };
        void (importer ? importer(file).catch(() => null) : Promise.resolve(null)).then((name) => {
          inject(`window.__editorApi && window.__editorApi.attachmentImported(${id}, ${JSON.stringify(name)});`);
        });
        return;
      }
      if (message.type === 'attachmentError' && typeof message.message === 'string') {
        onAttachmentErrorRef.current?.(message.message);
        return;
      }
      if (message.type === 'createOccurrence' && typeof message.word === 'string') {
        void Promise.resolve(onCreateOccurrenceRef.current?.(message.word)).then(() => sendConfig());
      }
    },
    [sendConfig, sendDoc, value, inject],
  );

  // Changement EXTERNE du contenu (changement de note, pull de synchro,
  // annuler/rétablir du bureau) : pousser vers le web, sauf si ce contenu
  // vient justement du web (écho de frappe).
  useEffect(() => {
    if (value !== lastWebContent.current) {
      lastWebContent.current = value;
      sendDoc(value);
    }
  }, [value, sendDoc]);

  useEffect(() => {
    sendConfig();
  }, [sendConfig]);

  // Le clavier vient de s'ouvrir (souvent APRÈS le tap qui a posé le
  // curseur) : redemander la position du curseur pour le dégager.
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const subscription = Keyboard.addListener('keyboardDidShow', () => {
      inject('window.__editorApi && window.__editorApi.reportCaret && window.__editorApi.reportCaret();');
    });
    return () => subscription.remove();
  }, [inject]);

  return (
    <View ref={containerRef} style={styles.container} collapsable={false}>
      <WebView
        ref={webRef}
        source={{ html: EDITOR_WEB_BUNDLE }}
        onMessage={onMessage}
        originWhitelist={['*']}
        javaScriptEnabled
        domStorageEnabled={false}
        setSupportMultipleWindows={false}
        allowFileAccess={false}
        style={[
          autoHeight
            ? { height: webHeight, backgroundColor: theme.editorBackground ?? theme.background }
            : { flex: 1, backgroundColor: theme.editorBackground ?? theme.background },
        ]}
        hideKeyboardAccessoryView
        keyboardDisplayRequiresUserAction
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  web: {
    flex: 1,
    backgroundColor: 'transparent',
  },
});
