import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import type { Theme } from '../../theme';

// ✒️ 123ECRITURE — components/dialogs/MergeLinkDialog.tsx — fusion à la liaison
//////////////////////////////////////////////////////////////////////////////
//
// Affiché quand on relie un dossier local EXISTANT à un coffre distant.
// Aperçu (nombre de fichiers des deux côtés) puis quatre choix :
//   • Fusionner : union des deux ; fichiers différents → copie de conflit ;
//   • Garder le local : en cas de différence, la version locale gagne ;
//   • Garder le distant : en cas de différence, la version cloud gagne ;
//   • Annuler : rien n'est relié.
// Dans tous les cas, RIEN n'est supprimé : la version perdante d'un fichier
// différent est sauvegardée (comme tout conflit).
//
//////////////////////////////////////////////////////////////////////////////

function Btn({ theme, label, onPress, primary }: { theme: Theme; label: string; onPress: () => void; primary?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.button, { borderColor: theme.border }, primary && { backgroundColor: theme.accent, borderColor: theme.accent }]}
    >
      <Text style={[styles.buttonText, { color: primary ? '#fff' : theme.text }]}>{label}</Text>
    </Pressable>
  );
}

export type MergeChoice = 'merge' | 'local' | 'remote';

type Props = {
  theme: Theme;
  vaultName: string;
  remoteName: string;
  loadPreview: () => Promise<{ local: number | null; remote: number | null }>;
  onChoose: (choice: MergeChoice) => void;
  onCancel: () => void;
};

export function MergeLinkDialog({ theme, vaultName, remoteName, loadPreview, onChoose, onCancel }: Props) {
  const [preview, setPreview] = useState<{ local: number | null; remote: number | null } | null>(null);
  useEffect(() => {
    let alive = true;
    loadPreview()
      .then((p) => alive && setPreview(p))
      .catch(() => alive && setPreview({ local: null, remote: null }));
    return () => {
      alive = false;
    };
  }, [loadPreview]);

  const count = (n: number | null) => (n === null ? '?' : String(n));
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel}>
        <Pressable style={[styles.dialog, { backgroundColor: theme.surface }]} onPress={(e) => e.stopPropagation()}>
          <Text style={[styles.title, { color: theme.text }]}>Relier « {vaultName} » à « {remoteName} » ?</Text>
          {preview ? (
            <Text style={[styles.message, { color: theme.textMuted }]}>
              Ce dossier contient {count(preview.local)} fichier(s), le coffre distant {count(preview.remote)}. Comment les réunir ? Rien ne
              sera supprimé : en cas de différence, la version écartée est sauvegardée.
            </Text>
          ) : (
            <ActivityIndicator />
          )}
          <View style={styles.buttons}>
            <Btn theme={theme} label="Fusionner (recommandé)" primary onPress={() => onChoose('merge')} />
            <Btn theme={theme} label="Garder le local en priorité" onPress={() => onChoose('local')} />
            <Btn theme={theme} label="Garder le distant en priorité" onPress={() => onChoose('remote')} />
            <Btn theme={theme} label="Annuler" onPress={onCancel} />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  dialog: { width: '100%', maxWidth: 440, borderRadius: 12, padding: 20, gap: 12 },
  title: { fontSize: 16, fontWeight: '700' },
  message: { fontSize: 14, lineHeight: 20 },
  buttons: { gap: 8 },
  button: { borderWidth: 1, borderRadius: 8, paddingVertical: 10, paddingHorizontal: 12, alignItems: 'center' },
  buttonText: { fontSize: 14, fontWeight: '600' },
});
