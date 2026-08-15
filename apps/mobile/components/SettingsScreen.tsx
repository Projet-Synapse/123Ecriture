import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { PersonalizationCard } from './PersonalizationCard';
import { usePreferences } from '../preferences/PreferencesContext';

// Écran Paramètres : personnalisation de l'interface (toujours disponible),
// vault local et traqueur de mise à jour (dépendent de ponts exposés
// uniquement par Electron desktop — window.vault / window.updater, voir
// apps/desktop/electron/preload.js).
export function SettingsScreen() {
  const { theme } = usePreferences();
  const vault = typeof window !== 'undefined' ? window.vault : undefined;
  const updater = typeof window !== 'undefined' ? window.updater : undefined;

  const [vaultPath, setVaultPath] = useState<string | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  const [status, setStatus] = useState<UpdaterStatus>({ state: 'idle' });

  useEffect(() => {
    if (!vault) return;
    void vault.getCurrentPath().then(setVaultPath);
  }, [vault]);

  useEffect(() => {
    if (!updater) return;
    void updater.getVersion().then(setVersion);
    // Récupère l'état déjà connu du process principal avant de s'abonner :
    // la vérification de mise à jour démarre au lancement de l'app, donc
    // les tout premiers événements (checking/downloading...) peuvent être
    // passés avant même que cet écran ne soit monté. Sans ce snapshot,
    // Paramètres afficherait un état par défaut périmé tant qu'aucun
    // nouvel événement n'arrive.
    void updater.getStatus().then(setStatus);
    const unsubscribe = updater.onStatusChange(setStatus);
    return unsubscribe;
  }, [updater]);

  const handleChooseFolder = useCallback(async () => {
    if (!vault) return;
    try {
      const chosen = await vault.chooseFolder();
      setVaultPath(chosen);
    } catch (error) {
      console.error('[vault] échec du choix de dossier :', error);
    }
  }, [vault]);

  const handleCheckForUpdates = useCallback(async () => {
    if (!updater) return;
    await updater.check();
  }, [updater]);

  const handleInstall = useCallback(async () => {
    if (!updater) return;
    try {
      await updater.quitAndInstall();
    } catch (error) {
      console.error('[updater] échec de l’installation :', error);
      setStatus({ state: 'error', message: String(error) });
    }
  }, [updater]);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <PersonalizationCard />

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

          {status.state === 'idle' && (
            <View style={styles.statusRow}>
              <ActivityIndicator size="small" color={theme.accent} />
              <Text style={{ color: theme.textMuted }}>Initialisation…</Text>
            </View>
          )}

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

      {!vault && !updater && (
        <Text style={[styles.muted, { color: theme.textMuted }]}>
          Vault et mises à jour sont disponibles sur la version desktop pour l’instant.
        </Text>
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
