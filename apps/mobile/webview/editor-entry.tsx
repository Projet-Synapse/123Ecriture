// Entrée du bundle WEB de l'éditeur embarqué — mode Intermédiaire sur
// Android (demande explicite 2026-10-02). Construit par
// scripts/build-editor-web.mjs en un fichier HTML unique
// (components/generated/editorWebBundle.ts) chargé par MdxEditorWeb.tsx
// dans une react-native-webview.
//
// Réplique LA COMPOSITION D'EXTENSIONS de MdxEditor.tsx — le même
// @uiw/react-codemirror que le desktop, donc le même fonctionnement et les
// mêmes particularités (aperçu vivant inline, masquage des marqueurs près
// du curseur, autocomplétions {{occurrences}} et [[liens]], recherche
// Ctrl+F, closeBrackets réglable, polices/couleurs du thème).
//
// Ce fichier n'est PAS compilé par tsc/Metro : esbuild seul (voir
// scripts/build-editor-web.mjs et l'exclusion `webview` du tsconfig).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import CodeMirror, { EditorView } from '@uiw/react-codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { autocompletion } from '@codemirror/autocomplete';
import { search as searchExtension, searchKeymap } from '@codemirror/search';
import { keymap } from '@codemirror/view';

import { createLivePreviewExtension } from '../lib/mdxLivePreview';
import { occurrenceCompletionSource } from '../lib/occurrenceAutocomplete';
import { wikilinkCompletionSource } from '../lib/wikilinkAutocomplete';
import { editorHighlightExtensions } from '../lib/codemirrorHighlight';
import type { Theme } from '../theme';

// Dupliqué volontairement de MdxEditor.tsx (qui vit dans un fichier
// react-native — l'importer tirerait tout react-native-web dans le bundle).
// ⚠️ 'system' ≠ 'inherit' dans la WebView : CodeMirror/le navigateur
// retombe sur sa police par défaut au lieu de la police SYSTÈME du
// téléphone (constaté : police différente du reste de l'interface,
// 2026-10-03) — d'où une pile explicite commençant par Roboto (police
// système Android).
const EDITOR_FONT_STACKS: Record<string, string> = {
  system: 'Roboto, system-ui, "Segoe UI", Helvetica, Arial, sans-serif',
  sans: '"Segoe UI", Helvetica, Arial, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: '"Fira Code", "JetBrains Mono", Consolas, monospace',
  dyslexic: '"OpenDyslexic", "Comic Sans MS", sans-serif',
};

type EditorColors = Pick<Theme, 'accent' | 'border' | 'text' | 'textMuted' | 'background' | 'surface'> & {
  editorBackground?: string;
};

type EntryConfig = {
  content: string;
  fontSize: number;
  fontFamily: string;
  closeBrackets: boolean;
  occurrenceWords: string[];
  noteNames: string[];
  colors: EditorColors;
  // Mode Source (sans aperçu vivant) : le même CodeMirror, l'extension de
  // Live Preview en moins — utilisé par NotesScreen quand
  // effectiveViewMode === 'source' pour que TOUS les modes partagent la
  // barre de défilement maintenable (le TextInput natif ne peut pas être
  // fait défiler par programme, vécu 2026-10-04).
  livePreview: boolean;
  // Mobile : hauteur auto + mesure du body — la WebView vit DANS un
  // ScrollView natif avec le bloc Propriétés, qui défile comme le reste
  // (demande 2026-10-02 : « il doit se défiler comme le reste »). Desktop
  // n'en a pas besoin (hauteur 100 %, scroll interne CodeMirror).
  autoHeight: boolean;
};

let config: EntryConfig = {
  content: '',
  fontSize: 15,
  fontFamily: 'system',
  closeBrackets: true,
  occurrenceWords: [],
  noteNames: [],
  colors: {
    accent: '#7c6cf2',
    border: '#00000033',
    text: '#111111',
    textMuted: '#888888',
    background: '#ffffff',
    surface: '#ffffff',
  },
  livePreview: true,
  autoHeight: false,
};

// Pont WebView → React Native. RN écoute via onMessage (MdxEditorWeb.tsx).
function send(type: string, payload: Record<string, unknown> = {}): void {
  const win = window as unknown as { ReactNativeWebView?: { postMessage: (data: string) => void } };
  win.ReactNativeWebView?.postMessage(JSON.stringify({ type, ...payload }));
}

// La frappe passe par CodeMirror à ~60 Hz : un postMessage par frappe
// sature le pont — on envoie au plus une fois par 300 ms, plus une
// vidange immédiate au blur (l'attente de sauvegarde RN est de 800 ms).
let lastSentAt = 0;
let pendingContent: string | null = null;
function sendChangeThrottled(content: string): void {
  pendingContent = content;
  const now = Date.now();
  if (now - lastSentAt >= 300) {
    lastSentAt = now;
    pendingContent = null;
    send('change', { content });
  }
}
setInterval(() => {
  if (pendingContent === null) return;
  lastSentAt = Date.now();
  const content = pendingContent;
  pendingContent = null;
  send('change', { content });
}, 300);

// Garde anti-écho : applyDoc (RN → web) déclenche un onChange CodeMirror
// comme une vraie frappe — sans ce drapeau, le doc renvoyé repartait vers
// RN et bouclait. Fenêtre large : le onChange programmatique est synchrone.
let applyingRemote = false;

function EditorApp() {
  const [version, setVersion] = useState(0);
  // Référence au setter remontée au niveau module (voir applyDoc/applyConfig)
  // — applyConfig DOIT incrémenter version pour que les useMemo/effets
  // dépendant de [version] (thème, hauteur) se recalculent vraiment :
  // rerenderRoot seul re-rend avec le MÊME state et React ne re-récupère
  // PAS les mémos (bug « page blanche / hauteur figée », vécu fix24-28).
  bumpVersion = () => setVersion((v) => v + 1);
  const latestContent = useRef(config.content);

  const rerender = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    latestContent.current = config.content;
  }, [version]);

  const editorTheme = useMemo(
    () =>
      EditorView.theme({
        '&': {
          backgroundColor: config.colors.editorBackground ?? config.colors.background,
          color: config.colors.text,
          height: config.autoHeight ? 'auto' : '100%',
          fontSize: `${config.fontSize}px`,
        },
        '.cm-content': { padding: '16px', caretColor: config.colors.accent },
        '.cm-scroller': { fontFamily: EDITOR_FONT_STACKS[config.fontFamily] ?? 'inherit', lineHeight: '1.6' },
        '&.cm-focused .cm-cursor': { borderLeftColor: config.colors.accent },
        '&.cm-focused .cm-selectionBackground, ::selection': { backgroundColor: `${config.colors.accent}33` },
        '.cm-gutters': { display: 'none' },
        '.cm-activeLine': { backgroundColor: 'transparent' },
        '.cm-panels': {
          backgroundColor: config.colors.surface,
          color: config.colors.text,
          borderColor: config.colors.border,
          fontFamily: 'inherit',
        },
        '.cm-panels input, .cm-panels button': {
          backgroundColor: config.colors.background,
          color: config.colors.text,
          borderColor: config.colors.border,
        },
        '.cm-panels label': { color: config.colors.textMuted },
        '.cm-searchMatch': { backgroundColor: `${config.colors.accent}44` },
        '.cm-searchMatch-selected': { backgroundColor: `${config.colors.accent}88` },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [version],
  );

  const extensions = useMemo(() => {
    const base = [
      markdown(),
      EditorView.lineWrapping,
      autocompletion({
        override: [
          occurrenceCompletionSource({
            getKnownWords: () => config.occurrenceWords,
            onCreateWord: async (word) => send('createOccurrence', { word }),
          }),
          wikilinkCompletionSource(() => config.noteNames),
        ],
      }),
      searchExtension({ top: true }),
      keymap.of(searchKeymap),
    ];
    // Mode Intermédiaire uniquement : l'aperçu vivant (marqueurs masqués,
    // titres stylés, pastilles). Le mode Source passe `livePreview: false`
    // et reçoit le même CodeMirror sans décoration.
    const withLive = config.livePreview
      ? [
          ...base,
          createLivePreviewExtension(
            {
              accent: config.colors.accent,
              surface: config.colors.surface,
              border: config.colors.border,
              textMuted: config.colors.textMuted,
            },
            {
              onOpenWikilink: (target) => send('wikilink', { target }),
            },
            // Mobile uniquement : l'aperçu vivant suit les couleurs du thème
            // de l'interface (desktop reste monochrome, inchangé).
            { colorize: true },
          ),
        ]
      : base;
    return [...withLive, editorTheme,
      // Titres SANS soulignement (voir lib/codemirrorHighlight.ts) — en
      // dernier pour que ses règles de coloration soient montées après
      // celles du basicSetup.
      ...editorHighlightExtensions,
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, editorTheme]);

  useEffect(() => {
    send('ready', {});
  }, []);

  // Le fond du document suit la config (sinon le body reste blanc par
  // défaut — page blanche en thème sombre, vécu sur le mobile). Ré-appliqué
  // à chaque re-render (donc après chaque applyConfig).
  useEffect(() => {
    document.body.style.backgroundColor = config.colors.editorBackground ?? config.colors.background;
  }, [version]);

  // Mode autoHeight : la WebView (côté natif) doit connaître la hauteur du
  // contenu pour se dimensionner dans le ScrollView natif. ⚠️ Envoyer la
  // hauteur DÈS l'attachement : CodeMirror a déjà fini de se dimensionner
  // à ce stade — un ResizeObserver seul ne recevrait plus aucun évènement
  // (le body ne change plus) et la WebView resterait à sa hauteur initiale
  // (vécu : contenu tronqué à ~300 px, v0.4.41-fix24).
  useEffect(() => {
    if (!config.autoHeight) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const sendHeight = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        send('height', { height: document.body.offsetHeight });
      }, 120);
    };
    sendHeight();
    const observer = new ResizeObserver(sendHeight);
    observer.observe(document.body);
    return () => {
      observer.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, [version]);

  return (
    <CodeMirror
      value={config.content}
      height="100%"
      // Viewport énorme : CodeMirror virtualise son rendu (~1000 px autour
      // du scroll) — dans une WebView en hauteur auto (le scroll est le
      // ScrollView NATIF, invisible côté web), il ne rendrait que le début
      // et la hauteur du document resterait fausse. Rendre TOUT le document
      // est ce qui permet à l'auto-hauteur de fonctionner (notes de taille
      // raisonnable ; à revoir au-delà de quelques Mo).
      viewportMargin={1000000}
      style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}
      theme="none"
      extensions={extensions}
      basicSetup={{
        lineNumbers: false,
        foldGutter: false,
        highlightActiveLine: false,
        autocompletion: false,
        closeBrackets: config.closeBrackets,
      }}
      onChange={(value) => {
        latestContent.current = value;
        config.content = value;
        if (applyingRemote) return;
        sendChangeThrottled(value);
      }}
      onBlur={() => send('change', { content: latestContent.current })}
    />
  );
}

// Pont React Native → WebView : appelé par MdxEditorWeb.tsx via
// injectJavaScript. applyDoc écrit le doc SANT re-pousser vers RN (anti-
// écho) ; applyConfig recrée les extensions (thème/polices/autocomplétion).
const api = {
  applyDoc(text: string): void {
    applyingRemote = true;
    config.content = text;
    setTimeout(() => {
      applyingRemote = false;
    }, 80);
    bumpVersion();
  },
  applyConfig(json: string): void {
    const patch = JSON.parse(json) as Partial<EntryConfig>;
    config = { ...config, ...patch };
    bumpVersion();
    // Auto-diagnostic du bug « page blanche » : confirme ce que la page a
    // réellement appliqué (visible via `adb logcat -s ReactNativeJS`).
    send('configApplied', {
      bg: document.body.style.backgroundColor || '(none)',
      accent: config.colors.accent,
      autoHeight: config.autoHeight,
    });
  },
};

let rerenderRoot: () => void = () => undefined;
let bumpVersion: () => void = () => undefined;

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  rerenderRoot = () => root.render(<EditorApp />);
  rerenderRoot();
}

const globalWindow = window as unknown as Record<string, unknown>;
globalWindow.__editorApi = api;
