import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import type { Theme } from '../theme';

export type ActionMenuItem = { id: string; label: string };

// Menu d'actions natif (maintien de doigt dans l'explorateur, bouton « ⋯ »
// de l'éditeur, tri) — l'équivalent tactile du menu contextuel du clic
// droit desktop (`contextMenuBridge.show`, menu natif Electron) : une carte
// ancrée en bas, refermée au toucher hors de la carte, par « Annuler » ou
// par le bouton retour Android (onRequestClose).
export function ActionMenu({ visible, title, items, onPick, onClose, theme }: {
  visible: boolean;
  title?: string;
  items: ActionMenuItem[];
  onPick: (id: string) => void;
  onClose: () => void;
  theme: Theme;
}) {
  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          {title ? (
            <Text numberOfLines={1} style={[styles.title, { color: theme.textMuted, borderBottomColor: theme.border }]}>
              {title}
            </Text>
          ) : null}
          {items.map((item) => (
            <Pressable
              key={item.id}
              onPress={() => onPick(item.id)}
              style={({ pressed }) => [styles.item, pressed && { backgroundColor: `${theme.accent}22` }]}
            >
              <Text style={{ color: theme.text }}>{item.label}</Text>
            </Pressable>
          ))}
          <Pressable
            onPress={onClose}
            style={({ pressed }) => [styles.item, pressed && { backgroundColor: `${theme.accent}22` }]}
          >
            <Text style={{ color: theme.textMuted }}>Annuler</Text>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: '#00000066',
    justifyContent: 'flex-end',
  },
  card: {
    borderTopWidth: 1,
    paddingHorizontal: 8,
    paddingTop: 8,
    paddingBottom: 24,
    gap: 2,
  },
  title: {
    fontSize: 12,
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
  },
  item: {
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
});
