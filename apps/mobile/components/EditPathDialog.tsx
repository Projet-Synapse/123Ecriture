import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { Theme } from '../theme';

// Édition manuelle du chemin complet d'une note/dossier — un complément au
// glisser-déposer (voir NotesScreen.tsx) pour les destinations pas
// pratiques à atteindre en glissant (dossier replié loin dans
// l'arborescence, renommage + déplacement en une fois...). Contrairement à
// "Renommer" (jamais de séparateur) et "Déplacer vers…" (choix parmi les
// dossiers déjà existants), on tape ici le chemin complet à la main ; les
// dossiers intermédiaires manquants sont créés automatiquement côté main
// process (voir vault:set-path dans apps/desktop/electron/vault.js).
type Props = {
  node: VaultTreeNode | null;
  theme: Theme;
  error: string | null;
  onSubmit: (newRelPath: string) => void;
  onCancel: () => void;
};

export function EditPathDialog({ node, theme, error, onSubmit, onCancel }: Props) {
  // Initialisé une fois avec `node.relPath` — le parent (NotesScreen)
  // remonte ce composant à chaque ouverture via `key={node?.relPath}`, donc
  // ce state se réinitialise naturellement à chaque nouveau `node` sans
  // effet ni synchronisation manuelle (et sans effacer ce que
  // l'utilisatrice tape en cas d'erreur de validation, puisqu'il n'y a pas
  // de remount tant que `node` ne change pas).
  const [value, setValue] = useState(() => node?.relPath ?? '');

  if (!node) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel}>
        <Pressable style={[styles.dialog, { backgroundColor: theme.surface }]} onPress={(e) => e.stopPropagation()}>
          <Text style={[styles.title, { color: theme.text }]}>
            Modifier le chemin de « {node.name} »
          </Text>
          <TextInput
            autoFocus
            value={value}
            onChangeText={setValue}
            onSubmitEditing={() => onSubmit(value)}
            placeholder="ex. Dossier/Sous-dossier/Nom"
            placeholderTextColor={theme.textMuted}
            style={[styles.input, { color: theme.text, borderColor: theme.accent }]}
          />
          <Text style={[styles.hint, { color: theme.textMuted }]}>
            Les dossiers manquants dans ce chemin seront créés automatiquement.
          </Text>
          {error && <Text style={styles.error}>⚠️ {error}</Text>}
          <View style={styles.buttonsRow}>
            <Pressable onPress={onCancel} style={styles.cancelButton}>
              <Text style={{ color: theme.textMuted }}>Annuler</Text>
            </Pressable>
            <Pressable
              onPress={() => onSubmit(value)}
              style={[styles.submitButton, { backgroundColor: theme.accent }]}
            >
              <Text style={styles.submitButtonText}>Valider</Text>
            </Pressable>
          </View>
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
    width: 360,
    borderRadius: 12,
    padding: 16,
    gap: 10,
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    fontSize: 14,
  },
  hint: {
    fontSize: 12,
  },
  error: {
    color: '#dc2626',
    fontSize: 13,
  },
  buttonsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
  },
  cancelButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  submitButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  submitButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
});
