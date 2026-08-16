import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import CodeMirror, { EditorView, type ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { markdown } from '@codemirror/lang-markdown';

import { createLivePreviewExtension } from '../lib/mdxLivePreview';
import { createOccurrenceAutocomplete } from '../lib/occurrenceAutocomplete';
import type { Theme } from '../theme';

// Éditeur MDX — remplace l'ancien `TextInput` brut pour les modes "Source"
// et "Intermédiaire" (voir NotesScreen.tsx). Un seul composant pour les
// deux modes : `livePreview=false` = CodeMirror nu (texte brut, comme un
// éditeur de code classique) ; `livePreview=true` = même éditeur + le
// `ViewPlugin` de lib/mdxLivePreview.ts (décorations façon Obsidian —
// gras/italique/titres stylés, liens/tags/occurrences/embeds en pastilles,
// tout révélé en texte brut quand le curseur est dedans). "Aperçu" (lecture
// seule, rendu complet) reste `NoteRenderer.tsx`, inchangé.
//
// S'intègre directement dans l'arbre React Native — l'app tourne comme une
// vraie appli react-dom (web export Expo compilé par react-native-web),
// donc un composant React « DOM pur » comme ce wrapper CodeMirror n'a besoin
// d'aucune échappatoire ref+useEffect (contrairement à SvgOverlay.tsx/
// AudioEmbed.tsx, qui injectent du DOM brut pour des primitives que RN
// n'expose pas du tout).
type Props = {
  value: string;
  onChange: (text: string) => void;
  livePreview: boolean;
  theme: Theme;
  onOpenWikilink: (target: string) => void;
  onOpenOccurrence?: (word: string) => void;
  // Mots du dictionnaire personnel (casse d'origine, voir
  // OccurrencesPanel.tsx) et création à la volée depuis l'autocomplétion
  // `{{` — voir lib/occurrenceAutocomplete.ts. Optionnels : sans eux,
  // taper `{{` ne propose simplement aucune suggestion.
  occurrenceWords?: string[];
  onCreateOccurrence?: (word: string) => Promise<void>;
  onReady?: (ref: ReactCodeMirrorRef) => void;
};

export function MdxEditor({
  value,
  onChange,
  livePreview,
  theme,
  onOpenWikilink,
  onOpenOccurrence,
  occurrenceWords,
  onCreateOccurrence,
  onReady,
}: Props) {
  const editorTheme = useMemo(
    () =>
      EditorView.theme({
        '&': {
          backgroundColor: theme.background,
          color: theme.text,
          height: '100%',
          fontSize: '15px',
        },
        '.cm-content': { padding: '16px', caretColor: theme.accent },
        '.cm-scroller': { fontFamily: 'inherit', lineHeight: '1.6' },
        '&.cm-focused .cm-cursor': { borderLeftColor: theme.accent },
        '&.cm-focused .cm-selectionBackground, ::selection': { backgroundColor: `${theme.accent}33` },
        '.cm-gutters': { display: 'none' },
        '.cm-activeLine': { backgroundColor: 'transparent' },
      }),
    [theme],
  );

  const liveExtension = useMemo(
    () =>
      createLivePreviewExtension(
        { accent: theme.accent, surface: theme.surface, border: theme.border, textMuted: theme.textMuted },
        { onOpenWikilink, onOpenOccurrence },
      ),
    [theme, onOpenWikilink, onOpenOccurrence],
  );

  // Recréée seulement quand le dictionnaire ou le callback de création
  // changent VRAIMENT (une mutation du dictionnaire — création/renommage/
  // suppression — pas à chaque frappe : `occurrenceWords` ne bouge pas
  // pendant la frappe normale) : pas besoin de l'échappatoire "ref lue dans
  // une closure figée" pour rester à jour. Remplace la complétion par
  // défaut de `basicSetup` (désactivée explicitement plus bas) : les deux
  // ne doivent pas coexister, `autocompletion()` est une extension
  // singleton côté CodeMirror.
  const occurrenceAutocomplete = useMemo(
    () =>
      createOccurrenceAutocomplete({
        getKnownWords: () => occurrenceWords ?? [],
        onCreateWord: async (word) => {
          await onCreateOccurrence?.(word);
        },
      }),
    [occurrenceWords, onCreateOccurrence],
  );

  const extensions = useMemo(() => {
    const base = [markdown(), EditorView.lineWrapping, occurrenceAutocomplete];
    return livePreview ? [...base, liveExtension] : base;
  }, [livePreview, liveExtension, occurrenceAutocomplete]);

  return (
    <View style={styles.container}>
      <CodeMirror
        value={value}
        height="100%"
        theme="none"
        extensions={[editorTheme, ...extensions]}
        basicSetup={{ lineNumbers: false, foldGutter: false, highlightActiveLine: false, autocompletion: false }}
        onChange={onChange}
        ref={(ref) => {
          if (ref) onReady?.(ref);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
