import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import CodeMirror, { EditorView, type ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { search as searchExtension, searchKeymap } from '@codemirror/search';
import { keymap } from '@codemirror/view';

import { languageForFile } from '../lib/codeLanguages';
import { buildCodeLinter } from '../lib/codeLint';
import { EDITOR_FONT_STACKS, enableOsEmojiInsertion } from './MdxEditor';
import type { Theme } from '../theme';

// Éditeur de fichiers CODE (.py/.ts/.js/.json/…) — v0.4.46, demande de
// l'utilisatrice : « lire n'importe quels fichiers code comme Visual Studio
// Code, avec les soulignements rouges et jaunes des erreurs et
// avertissements ». SÉPARÉ de MdxEditor : pas de Live Preview markdown, pas
// d'autocomplétion [[liens]]/{{occurrences}}, pas de bloc Propriétés — un
// CodeMirror brut avec :
// - le LANGAGE du fichier (coloration syntaxique, voir lib/codeLanguages.ts ;
//   langages dédiés = parseur Lezer complet, legacy = coloration seule) ;
// - le LINT (soulignements rouges erreurs / jaunes avertissements, voir
//   lib/codeLint.ts — pas de serveur de langage : c'est le choix assumé de
//   cette app, trop lourd pour sa machine cible) ;
// - numéros de ligne + repli + ligne active (VS Code-like), recherche
//   Ctrl/Cmd+F, insertion emoji système débloquée (enableOsEmojiInsertion,
//   le bug Chromium ne connaît pas le type de fichier).
//
// Même intégration react-native-web que MdxEditor (DOM pur dans l'arbre RN).
type Props = {
  value: string;
  onChange: (text: string) => void;
  // Nom du fichier OUVERT : son extension choisit le langage — un
  // renommage change donc la coloration au fil de l'eau.
  fileName: string;
  theme: Theme;
  fontSize?: number;
  fontFamily?: EditorFontFamily;
  onReady?: (ref: ReactCodeMirrorRef) => void;
};

export function CodeEditor({ value, onChange, fileName, theme, fontSize = 14, fontFamily = 'mono', onReady }: Props) {
  const editorTheme = useMemo(
    () =>
      EditorView.theme({
        '&': {
          backgroundColor: theme.editorBackground ?? theme.background,
          color: theme.text,
          height: '100%',
          fontSize: `${fontSize}px`,
        },
        '.cm-content': { padding: '12px 0 40vh 0', caretColor: theme.accent, fontFamily: 'inherit' },
        '.cm-scroller': { fontFamily: EDITOR_FONT_STACKS[fontFamily], lineHeight: '1.55' },
        '&.cm-focused': { outline: 'none' },
        '&.cm-focused .cm-cursor': { borderLeftColor: theme.accent },
        '&.cm-focused .cm-selectionBackground, ::selection': { backgroundColor: `${theme.accent}33` },
        // Gouttière (numéros de ligne, replis) — lisible sur les deux thèmes.
        '.cm-gutters': {
          backgroundColor: theme.surface,
          color: theme.textMuted,
          border: 'none',
          borderRight: `1px solid ${theme.border}`,
        },
        '.cm-activeLine': { backgroundColor: `${theme.accent}0d` },
        '.cm-activeLineGutter': { backgroundColor: `${theme.accent}0d`, color: theme.text },
        // Tooltips de lint (survol d'un soulignement) — couleurs de l'app.
        '.cm-tooltip': {
          backgroundColor: theme.surface,
          border: `1px solid ${theme.border}`,
          borderRadius: '6px',
          overflow: 'hidden',
        },
        '.cm-diagnostic': { padding: '4px 8px' },
        '.cm-diagnostic-error': { borderLeft: `3px solid ${theme.danger}` },
        '.cm-diagnostic-warning': { borderLeft: `3px solid ${theme.accent}` },
        // Panneau latéral des diagnostics (barres à côté du scroll).
        '.cm-lintRange-error': { backgroundImage: 'none', borderBottom: `2px wavy ${theme.danger}` },
        '.cm-lintRange-warning': { backgroundImage: 'none', borderBottom: `2px wavy ${theme.accent}` },
      }),
    [theme, fontSize, fontFamily],
  );

  // Langage + linter : recalculés seulement si le fichier change de
  // nom/extension (renommage) ou de thème — JAMAIS à la frappe.
  const codeExtensions = useMemo(() => {
    const support = languageForFile(fileName);
    return [support ? support.language : [], buildCodeLinter()];
  }, [fileName]);

  const searchExtensions = useMemo(() => [searchExtension(), keymap.of(searchKeymap)], []);

  const extensions = useMemo(
    () => [...codeExtensions, enableOsEmojiInsertion, ...searchExtensions],
    [codeExtensions, searchExtensions],
  );

  return (
    <View style={styles.container}>
      <CodeMirror
        value={value}
        height="100%"
        style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}
        theme="none"
        extensions={[editorTheme, ...extensions]}
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
