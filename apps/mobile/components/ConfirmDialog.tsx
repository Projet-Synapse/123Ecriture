import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import type { Theme } from '../theme';

// Boîte de confirmation générique pour les actions destructrices — même
// coquille modale que MoveDialog.tsx/EditPathDialog.tsx (backdrop cliquable
// pour annuler, Échap géré par react-native-web, boîte centrale). Le bouton
// de confirmation peut être "en cours" (busy) : le composant masque alors
// les deux actions jusqu'à la résolution, pour interdire le double-clic —
// l'appelant résout `onSettled` quand SA mutation est finie (échec inclus :
// la modale se referme aussi, l'erreur restant affichée à l'écran appelant).
type Props = {
  theme: Theme;
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => Promise<void> | void;
  onCancel: () => void;
  onSettled?: () => void;
};

export function ConfirmDialog({
  theme,
  title,
  message,
  confirmLabel = 'Supprimer',
  onConfirm,
  onCancel,
  onSettled,
}: Props) {
  const [busy, setBusy] = useState(false);

  const handleConfirm = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      onSettled?.();
    }
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={busy ? undefined : onCancel}>
        <Pressable style={[styles.dialog, { backgroundColor: theme.surface }]} onPress={(e) => e.stopPropagation()}>
          <Text style={[styles.title, { color: theme.text }]}>{title}</Text>
          <Text style={[styles.message, { color: theme.textMuted }]}>{message}</Text>
          <View style={styles.actionsRow}>
            {busy ? (
              <ActivityIndicator size="small" color={theme.accent} />
            ) : (
              <>
                <Pressable onPress={onCancel} style={styles.cancelButton}>
                  <Text style={{ color: theme.textMuted }}>Annuler</Text>
                </Pressable>
                <Pressable
                  onPress={() => void handleConfirm()}
                  style={[styles.confirmButton, { backgroundColor: DANGER_COLOR }]}
                  accessibilityLabel={confirmLabel}
                >
                  <Text style={styles.confirmButtonText}>{confirmLabel}</Text>
                </Pressable>
              </>
            )}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// Même rouge que settingsStyles.error / la barre d'actions groupées
// "Supprimer" de NotesScreen — pas de token "danger" dans theme.ts pour
// l'instant (voir theme.ts), réutilisation littérale plutôt qu'invention.
const DANGER_COLOR = '#dc2626';

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dialog: {
    width: 340,
    borderRadius: 12,
    padding: 16,
    gap: 12,
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
  },
  message: {
    fontSize: 13,
    lineHeight: 19,
  },
  actionsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 12,
    minHeight: 36,
  },
  cancelButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  confirmButton: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
  },
  confirmButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
});
