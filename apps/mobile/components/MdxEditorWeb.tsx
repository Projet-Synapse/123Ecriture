import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { EDITOR_WEB_BUNDLE } from './generated/editorWebBundle';
import type { Theme } from '../theme';

// Éditeur CodeMirror embarqué dans une WebView — le mode Intermédiaire
// natif (demande 2026-10-02, « mêmes fonctionnement et particularités que
// sur ordinateur ») : le bundle est le MÊME @uiw/react-codemirror que le
// desktop (voir webview/editor-entry.tsx, généré dans
// generated/editorWebBundle.ts — tout est embarqué, aucun réseau).
//
// Pont bidirectionnel :
// - web → RN : postMessage {type: 'change'|'wikilink'|'createOccurrence'|
//   'ready'} — la frappe est throttlée côté web (300 ms + flush au blur).
// - RN → web : injectJavaScript vers window.__editorApi (applyDoc,
//   applyConfig). applyDoc n'est envoyé que pour un changement EXTERNE
//   (changement de note, pull de synchro) — les échos de frappe sont
//   filtrés par lastFromWeb.
type Props = {
  value: string;
  onChange: (text: string) => void;
  onOpenWikilink: (target: string) => void;
  onCreateOccurrence?: (word: string) => Promise<void>;
  occurrenceWords: string[];
  noteNames: string[];
  theme: Theme;
  fontSize: number;
  fontFamily: string;
  closeBrackets: boolean;
  // false = mode Source : le même CodeMirror SANS l'aperçu vivant (le
  // TextInput natif ne permettait pas de barre de défilement manipulable —
  // tous les modes passent désormais par la WebView, 2026-10-04).
  livePreview?: boolean;
  // Mobile : la WebView se dimensionne à son contenu (hauteur renvoyée par
  // le web) et vit dans le ScrollView natif de l'éditeur — le bloc
  // Propriétés défile alors avec le texte, comme sur desktop.
  autoHeight?: boolean;
};

export function MdxEditorWeb({
  value,
  onChange,
  onOpenWikilink,
  onCreateOccurrence,
  occurrenceWords,
  noteNames,
  theme,
  fontSize,
  fontFamily,
  closeBrackets,
  livePreview = true,
  autoHeight = false,
}: Props) {
  const [webHeight, setWebHeight] = useState(200);
  const webRef = useRef<WebView>(null);
  // Dernier contenu CONNU du web : filtre les échos (le change renvoyé par
  // le web pour notre propre applyDoc ne repart pas vers onChange).
  const lastWebContent = useRef(value);
  // Derniers callbacks, lus par onMessage (stable) sans le recréer : mis à
  // jour en EFFET et non pendant le rendu (refs figées pendant le rendu —
  // rendu concurrent React ; eslint react-hooks/refs).
  const onChangeRef = useRef(onChange);
  const onOpenWikilinkRef = useRef(onOpenWikilink);
  const onCreateOccurrenceRef = useRef(onCreateOccurrence);
  useEffect(() => {
    onChangeRef.current = onChange;
    onOpenWikilinkRef.current = onOpenWikilink;
    onCreateOccurrenceRef.current = onCreateOccurrence;
  }, [onChange, onOpenWikilink, onCreateOccurrence]);

  const inject = useCallback((script: string) => {
    webRef.current?.injectJavaScript(`${script}; true;`);
  }, []);

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
      occurrenceWords,
      noteNames,
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
  }, [inject, fontSize, fontFamily, closeBrackets, livePreview, occurrenceWords, noteNames, theme]);

  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      let message: {
        type?: string;
        content?: string;
        target?: string;
        word?: string;
        height?: number;
        bg?: string;
        accent?: string;
        autoHeight?: boolean;
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
      if (message.type === 'createOccurrence' && typeof message.word === 'string') {
        void Promise.resolve(onCreateOccurrenceRef.current?.(message.word)).then(() => sendConfig());
      }
    },
    [sendConfig, sendDoc, value],
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

  return (
    <View style={styles.container}>
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
