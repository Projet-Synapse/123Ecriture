import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  getNotificationsPermission,
  isValidNotifyTime,
  syncTaskDueNotifications,
} from '../../lib/tasks/taskNotifications';
import { usePreferences } from '../../preferences/PreferencesContext';
import { SettingsToggle } from './SettingsToggle';
import { settingsStyles as s } from './settingsStyles';

// ✒️ 123ECRITURE — components/settings/NotificationsSection.tsx — les rappels d'échéance
//////////////////////////////////////////////////////////////////////////////
//
// Section "Notifications" (mobile natif uniquement) : rappels locaux
// d'échéance des tâches (voir lib/taskNotifications.ts).
//
// Invariants du fichier :
//   • La demande de permission système est EXPLICITE (jamais au démarrage
//     de l'app) : bouton dédié ici, ou première activation du pill « 🔔 »
//     de l'écran Tâches.
//   • L'accès rapide au toggle reste le pill de l'en-tête Tâches ; cette
//     section porte la permission et l'heure de rappel.
//   • Activer les rappels replanifie immédiatement avec les tâches
//     courantes du coffre actif — sinon les rappels n'existeraient qu'au
//     prochain passage par l'écran Tâches.
//
//////////////////////////////////////////////////////////////////////////////

export function NotificationsSection() {
  const { preferences, theme, setTasksNotifyEnabled, setTasksNotifyTime } = usePreferences();
  const [permissionState, setPermissionState] = useState<'unknown' | 'granted' | 'denied'>('unknown');
  const [timeDraft, setTimeDraft] = useState(preferences.tasksNotifyTime);
  const [timeError, setTimeError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  if (Platform.OS === 'web') {
    return (
      <View style={[s.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <Text style={[s.cardTitle, { color: theme.text }]}>🔔 Notifications</Text>
        <Text style={{ color: theme.textMuted }}>
          Les rappels d’échéance des tâches sont disponibles sur l’application mobile.
        </Text>
      </View>
    );
  }

  const askPermission = () => {
    void getNotificationsPermission().then((granted) => {
      setPermissionState(granted ? 'granted' : 'denied');
      if (!granted) {
        setActionError('Notification refusée — réessayez ici après les avoir autorisées dans les réglages Android.');
        return;
      }
      setActionError(null);
      // Replanifie immédiatement avec les tâches courantes du coffre actif :
      // sans ça, les rappels n'existeraient qu'au prochain passage par
      // l'écran Tâches.
      const tasksBridge = typeof window !== 'undefined' ? window.tasks : undefined;
      if (!tasksBridge || !preferences.tasksNotifyEnabled) return;
      void tasksBridge
        .list()
        .then((tasks) => syncTaskDueNotifications(tasks, true, preferences.tasksNotifyTime))
        .catch(() => undefined);
    });
  };

  const commitTime = () => {
    const trimmed = timeDraft.trim();
    if (!isValidNotifyTime(trimmed)) {
      setTimeError('Format attendu : HH:MM (par ex. 09:00).');
      return;
    }
    setTimeError(null);
    void setTasksNotifyTime(trimmed);
  };

  return (
    <View style={styles.stack}>
      <View style={[s.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <Text style={[s.cardTitle, { color: theme.text }]}>🔔 Notifications</Text>

        <SettingsToggle
          label="Rappels d'échéance des tâches"
          value={preferences.tasksNotifyEnabled}
          onChange={(value) => {
            if (!value) {
              void setTasksNotifyEnabled(false);
              return;
            }
            void getNotificationsPermission().then((granted) => {
              setPermissionState(granted ? 'granted' : 'denied');
              if (!granted) {
                setActionError('Notification refusée — autorisez-les ci-dessous pour activer les rappels.');
                return;
              }
              void setTasksNotifyEnabled(true);
            });
          }}
          theme={theme}
        />
        <Text style={[s.label, { color: theme.textMuted }]}>
          Une notification locale part le jour de l’échéance de chaque tâche non terminée (l’app n’a pas besoin
          d’être ouverte au moment du rappel).
        </Text>
        <Text style={[s.label, { color: theme.textMuted }]}>Heure des rappels</Text>
        <TextInput
          value={timeDraft}
          onChangeText={(text) => {
            setTimeDraft(text);
            setTimeError(null);
          }}
          onBlur={commitTime}
          onSubmitEditing={commitTime}
          placeholder="09:00"
          placeholderTextColor={theme.textMuted}
          keyboardType="numbers-and-punctuation"
          maxLength={5}
          style={[s.input, { color: theme.text, borderColor: theme.border }]}
        />
        {timeError && <Text style={{ color: theme.danger }}>⚠️ {timeError}</Text>}

        <Pressable onPress={askPermission} style={[s.button, { backgroundColor: theme.accent }]}>
          <Text style={s.buttonText}>
            {permissionState === 'denied' ? 'Réessayer d’autoriser les notifications' : 'Autoriser les notifications'}
          </Text>
        </Pressable>
        {permissionState === 'granted' && <Text style={{ color: theme.textMuted }}>✓ Notifications autorisées.</Text>}
        {actionError && <Text style={{ color: theme.danger }}>⚠️ {actionError}</Text>}

        <Text style={[s.label, { color: theme.textMuted }]}>
          Les rappels sont (re)planifiés à chaque passage dans l’écran Tâches : après avoir ajouté ou modifié une
          échéance, ouvrez cet écran une fois pour mettre la planification à jour.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 16 },
});
