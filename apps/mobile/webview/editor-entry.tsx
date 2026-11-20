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
import CodeMirror, { EditorView, ExternalChange } from '@uiw/react-codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { autocompletion } from '@codemirror/autocomplete';
import { search as searchExtension, searchKeymap } from '@codemirror/search';
import { keymap } from '@codemirror/view';
import { redo, undo } from '@codemirror/commands';

import { attachmentPasteExtension, type AttachmentFile } from '../lib/editor/attachmentPaste';
import { DocSync, minimalChange } from '../lib/editor/docSync';
import { formatMarkdown, normalizeFormattingSettings } from '../lib/editor/formatter';
import { applyTextCommand, parseEditorCommand } from '../lib/editor/editorCommands';
import { createLivePreviewExtension } from '../lib/editor/mdxLivePreview';
import { occurrenceCompletionSource } from '../lib/editor/occurrenceAutocomplete';
import { wikilinkCompletionSource } from '../lib/editor/wikilinkAutocomplete';
import { createWikilinkResolver } from '../lib/notes/wikilinkResolution';
import { editorHighlightExtensions } from '../lib/editor/codemirrorHighlight';
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
  // Chemins des notes du coffre + note courante : résolution des [[liens]]
  // pour atténuer ceux qui visent une fiche inexistante (même logique que
  // le clic côté RN). null = pas d'information → aucun lien atténué.
  notePaths: string[] | null;
  currentRelPath: string | null;
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
  // RN sait résoudre les embeds `![[image]]` (MdxEditorWeb reçoit
  // resolveEmbedUrl) : le widget image demande la data URL par le pont.
  embeds?: boolean;
  // RN sait copier une pièce jointe dans le coffre (MdxEditorWeb reçoit
  // importAttachment) : collage / glisser-déposer d'un fichier → pont.
  attachments?: boolean;
};

let config: EntryConfig = {
  content: '',
  fontSize: 15,
  fontFamily: 'system',
  closeBrackets: true,
  occurrenceWords: [],
  noteNames: [],
  notePaths: null,
  currentRelPath: null,
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
    emitChange(content);
  }
}
setInterval(() => {
  if (pendingContent === null) return;
  lastSentAt = Date.now();
  const content = pendingContent;
  pendingContent = null;
  emitChange(content);
}, 300);

// Synchro RN → web gardée (lib/editor/docSync.ts) : chaque texte envoyé à
// RN est mémorisé ; un applyDoc qui renvoie l'un d'eux (écho en retard du
// pont throttlé, renvois du `ready`, corps normalisé) est IGNORÉ au lieu
// d'écraser la frappe plus récente. Un vrai changement externe est
// appliqué en diff minimal — CodeMirror garde le curseur en place.
const docSync = new DocSync();
function emitChange(content: string): void {
  docSync.noteEmitted(content);
  send('change', { content });
}
function syncDocFromNative(view: EditorView, text: string): void {
  const change = docSync.incoming(text, view.state.doc.toString());
  // ExternalChange : pas de onChange → pas de renvoi vers RN (anti-écho).
  if (change) view.dispatch({ changes: change, annotations: [ExternalChange.of(true)] });
  config.content = view.state.doc.toString();
}

// Images des embeds (aperçu vivant) : la data URL vient de RN par le pont
// (`resolveEmbed` → api.embedResolved). Cache PAR NOTE : le widget est
// recréé à chaque frappe, une image de plusieurs Mo ne doit pas retraverser
// le pont à chaque caractère. Vidé quand la note courante change.
const embedCache = new Map<string, Promise<string | null>>();
const embedWaiters = new Map<number, (url: string | null) => void>();
let nextEmbedRequest = 1;
let embedCacheNote: string | null = null;
function resolveEmbedViaNative(target: string): Promise<string | null> {
  if (embedCacheNote !== config.currentRelPath) {
    embedCacheNote = config.currentRelPath;
    embedCache.clear();
  }
  let pending = embedCache.get(target);
  if (!pending) {
    const id = nextEmbedRequest++;
    pending = new Promise<string | null>((resolve) => {
      embedWaiters.set(id, resolve);
      // Filet : pas de réponse en 20 s → pastille pièce jointe.
      setTimeout(() => {
        if (embedWaiters.delete(id)) resolve(null);
      }, 20000);
    });
    embedCache.set(target, pending);
    send('resolveEmbed', { id, target });
  }
  return pending;
}

// Pièce jointe COLLÉE / GLISSÉE (lib/editor/attachmentPaste.ts) : les
// octets partent vers RN (`importAttachment`), qui les copie dans le
// dossier des pièces jointes du coffre et répond le nom final
// (api.attachmentImported) — `![[nom]]` est alors inséré ici.
const attachmentWaiters = new Map<number, (name: string | null) => void>();
let nextAttachmentRequest = 1;
function importAttachmentViaNative(file: AttachmentFile): Promise<string | null> {
  const id = nextAttachmentRequest++;
  return new Promise<string | null>((resolve) => {
    attachmentWaiters.set(id, resolve);
    // Filet : pas de réponse en 60 s → rien d'inséré.
    setTimeout(() => {
      if (attachmentWaiters.delete(id)) resolve(null);
    }, 60000);
    send('importAttachment', { id, name: file.name, base64: file.base64, mimeType: file.mimeType });
  });
}
const attachmentPaste = attachmentPasteExtension(importAttachmentViaNative, (message) =>
  send('attachmentError', { message }),
);

// EditorView courante — cible des commandes de la barre d'outils native
// (api.runCommand ci-dessous, lib/editor/editorCommands.ts).
let currentView: EditorView | null = null;

// Position du curseur → RN (`caret`, coordonnées dans la WebView) : en
// hauteur auto, c'est le ScrollView NATIF qui défile ; il s'en sert pour
// garder le curseur au-dessus du clavier (lib/ui/caretReveal.ts). Une
// fois par frame au plus, seulement si l'éditeur a le focus.
let caretFrame = 0;
function reportCaret(): void {
  const view = currentView;
  if (!view || !view.hasFocus) return;
  cancelAnimationFrame(caretFrame);
  caretFrame = requestAnimationFrame(() => {
    const coords = view.coordsAtPos(view.state.selection.main.head);
    if (coords) send('caret', { top: coords.top, bottom: coords.bottom });
  });
}
const caretReporter = EditorView.updateListener.of((update) => {
  if (update.selectionSet || update.docChanged || update.focusChanged) reportCaret();
});

function EditorApp() {
  const [version, setVersion] = useState(0);
  // Référence au setter remontée au niveau module (voir applyDoc/applyConfig)
  // — applyConfig DOIT incrémenter version pour que les useMemo/effets
  // dépendant de [version] (thème, hauteur) se recalculent vraiment :
  // rerenderRoot seul re-rend avec le MÊME state et React ne re-récupère
  // PAS les mémos (bug « page blanche / hauteur figée », vécu fix24-28).
  bumpVersion = () => setVersion((v) => v + 1);
  const latestContent = useRef(config.content);
  // `value` de CodeMirror = contenu INITIAL seulement : le `value` contrôlé
  // de @uiw/react-codemirror remplaçait tout le doc par la valeur du
  // dernier rendu — périmée si une frappe arrivait entre le rendu et son
  // effet (mise à jour différée pendant la frappe puis appliquée : lettres
  // perdues). Les changements RN passent par syncDocFromNative.
  const [seedContent] = useState(config.content);

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
      caretReporter,
      ...(config.attachments ? [attachmentPaste] : []),
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
              resolveEmbedUrl: config.embeds ? resolveEmbedViaNative : undefined,
              isWikilinkResolved: config.notePaths
                ? createWikilinkResolver(
                    config.notePaths.map((relPath) => ({
                      relPath,
                      name: relPath.slice(relPath.lastIndexOf('/') + 1).replace(/\.[^.]+$/, ''),
                    })),
                    config.currentRelPath,
                  ).isResolved
                : undefined,
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
        // La WebView va grandir (nouvelle ligne en fin de note) : renvoyer
        // le curseur pour qu'il soit dégagé APRÈS l'agrandissement.
        reportCaret();
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
      value={seedContent}
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
        sendChangeThrottled(value);
      }}
      onBlur={() => emitChange(latestContent.current)}
      onCreateEditor={(view) => {
        currentView = view;
        syncDocFromNative(view, config.content);
      }}
    />
  );
}

// Pont React Native → WebView : appelé par MdxEditorWeb.tsx via
// injectJavaScript. applyDoc écrit le doc SANS re-pousser vers RN (anti-
// écho) ; applyConfig recrée les extensions (thème/polices/autocomplétion).
const api = {
  applyDoc(text: string): void {
    if (currentView) {
      syncDocFromNative(currentView, text);
      return;
    }
    // Éditeur pas encore créé : appliqué à sa création (onCreateEditor).
    config.content = text;
    bumpVersion();
  },
  // Clavier ouvert côté RN : renvoyer la position du curseur.
  reportCaret(): void {
    reportCaret();
  },
  // Réponse de RN à `resolveEmbed` (null = introuvable/illisible).
  embedResolved(id: number, url: string | null): void {
    const resolve = embedWaiters.get(id);
    if (!resolve) return;
    embedWaiters.delete(id);
    resolve(url);
  },
  // Réponse de RN à `importAttachment` (null = échec de copie).
  attachmentImported(id: number, name: string | null): void {
    const resolve = attachmentWaiters.get(id);
    if (!resolve) return;
    attachmentWaiters.delete(id);
    resolve(name);
  },
  // Barre d'outils NATIVE (NotesScreen → MdxEditorWeb) : mise en forme,
  // annuler/rétablir, insertion — même logique que le desktop, appliquée
  // sur l'EditorView de la page. La modification repart vers RN par le
  // onChange habituel (frappe).
  runCommand(json: string): void {
    const cmd = parseEditorCommand(json);
    const view = currentView;
    if (!cmd || !view) return;
    if (cmd.kind === 'undo' || cmd.kind === 'redo') {
      (cmd.kind === 'undo' ? undo : redo)(view);
      view.focus();
      return;
    }
    if (cmd.kind === 'formatDoc') {
      // Changement MINIMAL (préfixe/suffixe communs) : curseur conservé,
      // annulable d'un seul Ctrl+Z / ↶.
      const doc = view.state.doc.toString();
      const change = minimalChange(doc, formatMarkdown(doc, normalizeFormattingSettings(cmd.settings)).text);
      if (change) view.dispatch({ changes: change });
      view.focus();
      return;
    }
    const sel = view.state.selection.main;
    const result = applyTextCommand(view.state.doc.toString(), { start: sel.from, end: sel.to }, cmd);
    if (!result) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: result.text },
      selection: { anchor: result.selection.start, head: result.selection.end },
    });
    view.focus();
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
