import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { usePreferences } from '../preferences/PreferencesContext';

// Éditeur Excalidraw — SQUELETTE seulement cette session (voir
// .claude/References/Sources.md §3 « Les excalidraws » et le plan de cette
// revue) : reconnaît le `kind` 'excalidraw' de bout en bout (extension
// `.excalidraw`, icône, création depuis le menu contextuel, ouverture) et
// LIT le fichier (avec repli sur une scène vide en cas d'erreur, même
// pattern que ChartEditor.tsx/CanvasEditor.tsx), mais n'affiche pas encore
// de vrai outil de dessin — `@excalidraw/excalidraw` n'est pas ajouté cette
// session (aucune trace dans le repo, décision de scope explicite). Pas
// d'autosauvegarde ici : rien à écrire tant qu'aucune interaction de dessin
// n'existe — à ajouter (même délai `600ms` que les autres éditeurs de
// fichiers) quand le vrai outil arrivera dans une session future.
type Props = {
  relPath: string;
};

const EMPTY_DATA: ExcalidrawData = { type: 'excalidraw', version: 2, elements: [], appState: {} };

export function ExcalidrawEditor({ relPath }: Props) {
  const { theme } = usePreferences();
  const vault = typeof window !== 'undefined' ? window.vault : undefined;

  const [data, setData] = useState<ExcalidrawData>(EMPTY_DATA);

  const refreshData = useCallback(async () => {
    if (!vault) return;
    try {
      const content = await vault.readNote(relPath);
      setData(content.trim() ? JSON.parse(content) : EMPTY_DATA);
    } catch (error) {
      console.error('[excalidraw] échec du chargement :', error);
      setData(EMPTY_DATA);
    }
  }, [vault, relPath]);

  useEffect(() => {
    void (async () => {
      await refreshData();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relPath]);

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <Text style={styles.icon}>🖍️</Text>
      <Text style={[styles.title, { color: theme.text }]}>Excalidraw — l’outil de dessin arrive bientôt</Text>
      <Text style={[styles.subtitle, { color: theme.textMuted }]}>
        Ce fichier est déjà reconnu comme une scène Excalidraw valide ({data.elements.length} élément
        {data.elements.length > 1 ? 's' : ''} enregistré{data.elements.length > 1 ? 's' : ''}) — seul
        l’éditeur de dessin lui-même reste à construire.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 8,
  },
  icon: {
    fontSize: 40,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 13,
    textAlign: 'center',
    maxWidth: 360,
  },
});
