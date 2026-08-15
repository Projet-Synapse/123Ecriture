import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, useColorScheme, View } from 'react-native';

import { darkTheme, lightTheme } from '../theme';

// Écran Paramètres : gestion du vault local + traqueur de mise à jour. Les
// deux dépendent de ponts exposés uniquement par Electron desktop
// (window.vault / window.updater) — voir apps/desktop/electron/preload.js.
export function SettingsScreen() {
  const scheme = useColorScheme();
  const theme = scheme === 'dark' ? darkTheme : lightTheme;
  const vault = typeof window !== 'undefined' ? window.vault : undefined;
  const updater = typeof window !== 'undefined' ? window.updater : undefined;

  const [vaultPath, setVaultPath] = useState<string | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  const [status, setStatus] = useState<UpdaterStatus>({ state: 'up-to-date' });

  useEffect(() => {
    if (!vault) return;
    void vault.getCurrentPath().then(setVaultPath);
  }, [vault]);

  useEffect(() => {
    if (!updater) return;
    void updater.getVersion().then(setVersion);
    const unsubscribe = updater.onStatusChange(setStatus);
    return unsubscribe;
  }, [updater]);

  const handleChooseFolder = useCallback(async () => {
    if (!vault) return;
    const chosen = await vault.chooseFolder();
    setVaultPath(chosen);
  }, [vault]);

  const handleCheckForUpdates = useCallback(async () => {
    if (!updater) return;
    await updater.check();
  }, [updater]);

  const handleInstall = useCallback(async () => {
    if (!updater) return;
    await updater.quitAndInstall();
  }, [updater]);

  if (!vault && !updater) {
    return (
      <View style={styles.centered}>
        <Text style={[styles.title, { color: theme.text }]}>⚙️ Paramètres</Text>
        <Text style={[styles.muted, { color: theme.textMuted }]}>
          Disponible sur la version desktop pour l’instant.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {vault && (
        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Text style={[styles.cardTitle, { color: theme.text }]}>Vault</Text>
          <Text style={[styles.cardValue, { color: theme.textMuted }]}>
            {vaultPath ?? 'Aucun vault sélectionné'}
          </Text>
          <Pressable
            onPress={() => void handleChooseFolder()}
            style={[styles.button, { backgroundColor: theme.accent }]}
          >
            <Text style={styles.buttonText}>
              {vaultPath ? 'Changer de dossier' : 'Choisir un dossier'}
            </Text>
          </Pressable>
        </View>
      )}

      {updater && (
        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Text style={[styles.cardTitle, { color: theme.text }]}>Mises à jour</Text>
          <Text style={[styles.cardValue, { color: theme.textMuted }]}>
            Version installée : {version ?? '…'}
          </Text>

          {status.state === 'checking' && (
            <View style={styles.statusRow}>
              <ActivityIndicator size="small" color={theme.accent} />
              <Text style={{ color: theme.textMuted }}>Vérification…</Text>
            </View>
          )}

          {status.state === 'up-to-date' && (
            <>
              <Text style={{ color: theme.textMuted }}>✅ À jour.</Text>
              <Pressable
                onPress={() => void handleCheckForUpdates()}
                style={[styles.button, { backgroundColor: theme.accent }]}
              >
                <Text style={styles.buttonText}>Vérifier les mises à jour</Text>
              </Pressable>
            </>
          )}

          {status.state === 'downloading' && (
            <View style={styles.statusRow}>
              <ActivityIndicator size="small" color={theme.accent} />
              <Text style={{ color: theme.textMuted }}>
                Téléchargement de la v{status.version ?? '?'}… {status.percent}%
              </Text>
            </View>
          )}

          {status.state === 'ready' && (
            <>
              <Text style={{ color: theme.textMuted }}>
                🎉 Version {status.version} prête à installer.
              </Text>
              <Pressable
                onPress={() => void handleInstall()}
                style={[styles.button, { backgroundColor: theme.accent }]}
              >
                <Text style={styles.buttonText}>Redémarrer et installer</Text>
              </Pressable>
            </>
          )}

          {status.state === 'error' && (
            <>
              <Text style={styles.error}>⚠️ {status.message}</Text>
              <Pressable
                onPress={() => void handleCheckForUpdates()}
                style={[styles.button, { backgroundColor: theme.accent }]}
              >
                <Text style={styles.buttonText}>Réessayer</Text>
              </Pressable>
            </>
          )}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 24,
    gap: 16,
    maxWidth: 480,
    width: '100%',
    alignSelf: 'center',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 8,
  },
  title: {
    fontSize: 22,
    fontWeight: '600',
  },
  muted: {
    fontSize: 14,
    textAlign: 'center',
    maxWidth: 360,
  },
  card: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    gap: 10,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  cardValue: {
    fontSize: 13,
  },
  button: {
    alignSelf: 'flex-start',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  error: {
    color: '#dc2626',
  },
});
