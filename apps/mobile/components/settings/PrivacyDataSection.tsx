import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { usePreferences } from '../../preferences/PreferencesContext';
import { settingsStyles as s } from './settingsStyles';

// Section "Confidentialité et données" — n'agit que sur la personnalisation
// (thème, barre d'outils, réglages Éditeur/Fichiers ci-dessus), jamais sur
// les notes ou les coffres eux-mêmes : pas d'action destructive sur les
// données de l'utilisatrice ici. Masquée sans pont Electron (web/mobile),
// même logique de dégradation que le reste de l'écran.
export function PrivacyDataSection() {
  const { theme, resetPreferences, getConfigPath, revealConfigFolder } = usePreferences();
  const [configPath, setConfigPath] = useState<string | null>(null);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [resetDone, setResetDone] = useState(false);

  useEffect(() => {
    if (!getConfigPath) return;
    void getConfigPath()
      .then(setConfigPath)
      .catch((error) => console.error('[preferences] échec de lecture du chemin de config :', error));
  }, [getConfigPath]);

  if (!getConfigPath || !revealConfigFolder) {
    return (
      <Text style={[s.muted, { color: theme.textMuted }]}>
        Ces réglages sont disponibles sur la version desktop pour l’instant.
      </Text>
    );
  }

  const handleReset = () => {
    resetPreferences();
    setConfirmingReset(false);
    setResetDone(true);
  };

  return (
    <View style={[s.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <Text style={[s.cardTitle, { color: theme.text }]}>🔒 Confidentialité et données</Text>

      <Text style={[s.label, { color: theme.textMuted }]}>Personnalisation</Text>
      {!confirmingReset ? (
        <Pressable
          onPress={() => {
            setConfirmingReset(true);
            setResetDone(false);
          }}
          style={[s.button, { backgroundColor: theme.accent }]}
        >
          <Text style={s.buttonText}>Réinitialiser la personnalisation</Text>
        </Pressable>
      ) : (
        <View style={{ gap: 8 }}>
          <Text style={[s.hint, { color: theme.textMuted }]}>
            ⚠️ Remet l’apparence, la barre d’outils, l’éditeur et la gestion des fichiers/liens à leurs valeurs par
            défaut — n’affecte pas vos notes ni vos coffres.
          </Text>
          <View style={s.row}>
            <Pressable onPress={handleReset} style={[s.button, { backgroundColor: '#dc2626' }]}>
              <Text style={s.buttonText}>Confirmer la réinitialisation</Text>
            </Pressable>
            <Pressable
              onPress={() => setConfirmingReset(false)}
              style={[s.button, { backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border }]}
            >
              <Text style={{ color: theme.text }}>Annuler</Text>
            </Pressable>
          </View>
        </View>
      )}
      {resetDone && <Text style={{ color: theme.textMuted }}>✅ Personnalisation réinitialisée.</Text>}

      <Text style={[s.label, { color: theme.textMuted }]}>Dossier de configuration</Text>
      <Text style={[s.cardValue, { color: theme.textMuted }]} numberOfLines={1}>
        {configPath ?? '…'}
      </Text>
      <Pressable
        onPress={() => void revealConfigFolder()}
        style={[s.button, { backgroundColor: theme.accent }]}
      >
        <Text style={s.buttonText}>Ouvrir le dossier</Text>
      </Pressable>
    </View>
  );
}
