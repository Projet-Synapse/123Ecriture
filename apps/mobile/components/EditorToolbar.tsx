import { useState } from 'react';
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
//
// Groupes (voir .claude/References/Sources.md §11, ex. bouton "H" qui
// déploie H1-H6) : un item avec `subItems` n'exécute rien directement au
// clic, il déploie une seconde rangée juste en dessous plutôt qu'un menu
// flottant ancré — aucun composant de popover positionné n'existe ailleurs
// dans l'app (RN Web n'a pas de portail natif), une rangée en flux normal
// reste simple et cohérente avec le reste du style, sans mesure de layout.
type SubItem = {
  id: string;
  label: string;
  onPress: () => void;
};

type Item = {
  id: string;
  label: string;
  onPress?: () => void;
  subItems?: SubItem[];
};

type Props = {
  items: Item[];
  theme: Theme;
};

export function EditorToolbar({ items, theme }: Props) {
  const [openGroupId, setOpenGroupId] = useState<string | null>(null);

  if (items.length === 0) return null;

  const openGroup = items.find((item) => item.id === openGroupId && item.subItems);

  return (
    <View style={[styles.container, { borderColor: theme.border }]}>
      <View style={styles.toolbar}>
        {items.map((item) => {
          const isGroup = Boolean(item.subItems);
          const isOpen = isGroup && item.id === openGroupId;
          return (
            <Pressable
              key={item.id}
              onPress={() => (isGroup ? setOpenGroupId(isOpen ? null : item.id) : item.onPress?.())}
              style={[
                styles.toolbarButton,
                { backgroundColor: theme.surface },
                isOpen && { backgroundColor: `${theme.accent}22` },
              ]}
            >
              <Text style={[styles.toolbarButtonText, { color: isOpen ? theme.accent : theme.text }]}>
                {item.label}
                {isGroup ? (isOpen ? ' ▴' : ' ▾') : ''}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {openGroup?.subItems && (
        <View style={[styles.subToolbar, { borderColor: theme.border }]}>
          {openGroup.subItems.map((subItem) => (
            <Pressable
              key={subItem.id}
              onPress={() => {
                subItem.onPress();
                setOpenGroupId(null);
              }}
              style={[styles.toolbarButton, { backgroundColor: theme.surface }]}
            >
              <Text style={[styles.toolbarButtonText, { color: theme.text }]}>{subItem.label}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderBottomWidth: 1,
    paddingBottom: 10,
  },
  toolbar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
  },
  subToolbar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    marginHorizontal: 12,
    marginTop: 8,
    paddingTop: 8,
    paddingLeft: 8,
    borderLeftWidth: 2,
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
