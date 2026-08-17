import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Theme } from '../theme';

// Barre d'outils partagée par les 3 éditeurs de fichier (Notes, Canvas,
// Graphiques) — reproduit le style neutre de l'ancienne barre de formatage
// Notes (fond `theme.surface`, texte `theme.text`, coins peu arrondis)
// plutôt que des gros boutons d'action colorés (`theme.accent`) : une
// barre d'outils doit se lire comme un bandeau d'actions discret, pas
// comme des call-to-action. Chaque appelant précalcule sa propre liste
// `{id, label, onPress}` (déjà filtrée/ordonnée selon les préférences —
// voir NotesScreen.tsx/CanvasEditor.tsx/ChartEditor.tsx), ce composant ne
// fait que l'afficher de façon identique partout.
type Item = {
  id: string;
  label: string;
  onPress: () => void;
};

type Props = {
  items: Item[];
  theme: Theme;
};

export function EditorToolbar({ items, theme }: Props) {
  if (items.length === 0) return null;

  return (
    <View style={[styles.toolbar, { borderColor: theme.border }]}>
      {items.map((item) => (
        <Pressable
          key={item.id}
          onPress={item.onPress}
          style={[styles.toolbarButton, { backgroundColor: theme.surface }]}
        >
          <Text style={[styles.toolbarButtonText, { color: theme.text }]}>{item.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  toolbar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingBottom: 10,
    borderBottomWidth: 1,
  },
  toolbarButton: {
    minWidth: 32,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 6,
    alignItems: 'center',
  },
  toolbarButtonText: {
    fontSize: 13,
    fontWeight: '600',
  },
});
