import { Modal, Pressable, ScrollView, StyleSheet, Text } from 'react-native';

import { collectFolderOptions } from '../lib/vaultTree';
import type { Theme } from '../theme';

// Boîte de dialogue "Déplacer vers…" — une liste de dossiers plutôt que du
// glisser-déposer : plus simple et plus fiable à vérifier sans navigateur
// réel sous la main. Le glisser-déposer reste possible plus tard si
// vraiment souhaité.
type Props = {
  node: VaultTreeNode | null;
  tree: VaultTreeNode[];
  theme: Theme;
  onSelect: (destinationRelPath?: string) => void;
  onCancel: () => void;
};

export function MoveDialog({ node, tree, theme, onSelect, onCancel }: Props) {
  if (!node) return null;
  const options = collectFolderOptions(tree, node.type === 'folder' ? node.relPath : undefined);
  const currentParent = node.relPath.includes('/')
    ? node.relPath.slice(0, node.relPath.lastIndexOf('/'))
    : undefined;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel}>
        <Pressable style={[styles.dialog, { backgroundColor: theme.surface }]} onPress={(e) => e.stopPropagation()}>
          <Text style={[styles.title, { color: theme.text }]}>
            Déplacer « {node.name} » vers…
          </Text>
          <ScrollView style={styles.optionsList}>
            <Pressable
              onPress={() => onSelect(undefined)}
              disabled={currentParent === undefined}
              style={[styles.option, currentParent === undefined && styles.optionDisabled]}
            >
              <Text style={{ color: theme.text }}>🗄️ Racine du vault</Text>
            </Pressable>
            {options.map((option) => (
              <Pressable
                key={option.relPath}
                onPress={() => onSelect(option.relPath)}
                disabled={option.relPath === currentParent}
                style={[
                  styles.option,
                  { paddingLeft: 16 + option.depth * 16 },
                  option.relPath === currentParent && styles.optionDisabled,
                ]}
              >
                <Text style={{ color: theme.text }}>📁 {option.label}</Text>
              </Pressable>
            ))}
            {options.length === 0 && (
              <Text style={[styles.muted, { color: theme.textMuted }]}>
                Aucun autre dossier dans le vault.
              </Text>
            )}
          </ScrollView>
          <Pressable onPress={onCancel} style={styles.cancelButton}>
            <Text style={{ color: theme.textMuted }}>Annuler</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dialog: {
    width: 320,
    maxHeight: 400,
    borderRadius: 12,
    padding: 16,
    gap: 12,
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
  },
  optionsList: {
    maxHeight: 260,
  },
  option: {
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 6,
  },
  optionDisabled: {
    opacity: 0.35,
  },
  muted: {
    fontSize: 13,
    padding: 8,
  },
  cancelButton: {
    alignSelf: 'flex-end',
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
});
