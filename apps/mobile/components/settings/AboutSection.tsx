import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { usePreferences } from '../../preferences/PreferencesContext';
import { SettingsToggle } from './SettingsToggle';
import { settingsStyles as s } from './settingsStyles';

// Section "À propos" — version installée + statut du updater, déplacée
// telle quelle depuis l'ancien SettingsScreen plat (qui l'appelait "Mises à
// jour" sans section dédiée). Dépend de window.updater, exposé uniquement
// par Electron desktop (voir apps/desktop/electron/preload.ts).
export function AboutSection() {
  const { theme } = usePreferences();
  const updater = typeof window !== 'undefined' ? window.updater : undefined;

  const [version, setVersion] = useState<string | null>(null);
  const [status, setStatus] = useState<UpdaterStatus>({ state: 'idle' });
  const [autoUpdate, setAutoUpdate] = useState(true);

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
    void updater.getAutoUpdate().then(setAutoUpdate).catch(() => {});
    const unsubscribe = updater.onStatusChange(setStatus);
    return unsubscribe;
  }, [updater]);

  const handleToggleAutoUpdate = useCallback(
    async (next: boolean) => {
      if (!updater) return;
      setAutoUpdate(next);
      try {
        const applied = await updater.setAutoUpdate(next);
        setAutoUpdate(applied);
      } catch {
        setAutoUpdate(!next);
      }
    },
    [updater],
  );

  const handleDownload = useCallback(async () => {
    if (!updater) return;
    await updater.download();
  }, [updater]);

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

  // Raccourcis clavier (Ctrl sur Windows/Linux, Cmd sur macOS) — voir
  // NotesScreen.tsx pour l'implémentation. Section purement informative
  // (pas de bridge), affichée AVANT le early-return `!updater` ci-dessous
  // puisque ces raccourcis fonctionnent aussi en web, pas seulement desktop.
  const shortcuts = (
    <View style={[s.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <Text style={[s.cardTitle, { color: theme.text }]}>Raccourcis clavier</Text>
      <Text style={[s.cardValue, { color: theme.textMuted }]}>Ctrl/Cmd + S — Enregistrer la note</Text>
      <Text style={[s.cardValue, { color: theme.textMuted }]}>Ctrl/Cmd + K — Recherche globale</Text>
      <Text style={[s.cardValue, { color: theme.textMuted }]}>Ctrl/Cmd + N — Nouvelle note</Text>
    </View>
  );

  if (!updater) {
    return (
      <>
        {shortcuts}
        <Text style={[s.muted, { color: theme.textMuted }]}>
          Les mises à jour sont disponibles sur la version desktop pour l’instant.
        </Text>
      </>
    );
  }

  return (
    <>
      {shortcuts}
      <View style={[s.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <Text style={[s.cardTitle, { color: theme.text }]}>Mises à jour</Text>
        <Text style={[s.cardValue, { color: theme.textMuted }]}>Version installée : {version ?? '…'}</Text>

        {status.state === 'idle' && (
          <View style={s.statusRow}>
            <ActivityIndicator size="small" color={theme.accent} />
            <Text style={{ color: theme.textMuted }}>Initialisation…</Text>
          </View>
        )}

        {status.state === 'checking' && (
          <View style={s.statusRow}>
            <ActivityIndicator size="small" color={theme.accent} />
            <Text style={{ color: theme.textMuted }}>Vérification…</Text>
          </View>
        )}

        {status.state === 'up-to-date' && (
          <>
            <Text style={{ color: theme.textMuted }}>✅ À jour.</Text>
            <Pressable onPress={() => void handleCheckForUpdates()} style={[s.button, { backgroundColor: theme.accent }]}>
              <Text style={s.buttonText}>Vérifier les mises à jour</Text>
            </Pressable>
          </>
        )}

        {status.state === 'available' && (
          <>
            <Text style={{ color: theme.textMuted }}>⬇️ Version {status.version} disponible.</Text>
            <Pressable onPress={() => void handleDownload()} style={[s.button, { backgroundColor: theme.accent }]}>
              <Text style={s.buttonText}>Télécharger la mise à jour</Text>
            </Pressable>
          </>
        )}

        {status.state === 'downloading' && (
          <View style={s.statusRow}>
            <ActivityIndicator size="small" color={theme.accent} />
            <Text style={{ color: theme.textMuted }}>
              Téléchargement de la v{status.version ?? '?'}… {status.percent}%
            </Text>
          </View>
        )}

        {status.state === 'ready' && (
          <>
            <Text style={{ color: theme.textMuted }}>🎉 Version {status.version} prête à installer.</Text>
            <Pressable onPress={() => void handleInstall()} style={[s.button, { backgroundColor: theme.accent }]}>
              <Text style={s.buttonText}>Redémarrer et installer</Text>
            </Pressable>
          </>
        )}

        <SettingsToggle
          label="Mise à jour automatique"
          value={autoUpdate}
          onChange={(next) => void handleToggleAutoUpdate(next)}
          theme={theme}
        />
        <Text style={{ color: theme.textMuted, fontSize: 12 }}>
          {autoUpdate
            ? 'Téléchargée en arrière-plan puis installée à la fermeture de l’application.'
            : 'Recherche, téléchargement et installation manuels.'}
        </Text>

        {status.state === 'error' && (
          <>
            <Text style={s.error}>⚠️ {status.message}</Text>
            <Pressable onPress={() => void handleCheckForUpdates()} style={[s.button, { backgroundColor: theme.accent }]}>
              <Text style={s.buttonText}>Réessayer</Text>
            </Pressable>
          </>
        )}
      </View>
    </>
  );
}
