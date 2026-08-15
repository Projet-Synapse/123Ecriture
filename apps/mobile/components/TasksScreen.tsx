import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { usePreferences } from '../preferences/PreferencesContext';

// Écran Tâches — premier module de productivité (voir
// docs/ARCHITECTURE.md §8). Stocké dans le vault (.123ecriture/tasks.json,
// voir apps/desktop/electron/tasks.js), donc partage le même vault que
// Notes plutôt que d'en redemander un séparément. Fonctionnel mais
// volontairement minimal pour l'instant : pas encore de renommage/édition
// du texte d'une tâche une fois créée (à supprimer/recréer en attendant),
// pas de sous-tâches, d'échéances ou de priorités.
export function TasksScreen() {
  const { theme } = usePreferences();
  const vault = typeof window !== 'undefined' ? window.vault : undefined;
  const tasksBridge = typeof window !== 'undefined' ? window.tasks : undefined;

  const [vaultPath, setVaultPath] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [draft, setDraft] = useState('');
  const [addError, setAddError] = useState<string | null>(null);

  const refreshTasks = useCallback(async () => {
    if (!tasksBridge) return;
    setTasks(await tasksBridge.list());
  }, [tasksBridge]);

  useEffect(() => {
    if (!vault) return;
    void (async () => {
      try {
        const current = await vault.getCurrentPath();
        setVaultPath(current);
        if (current) await refreshTasks();
      } catch (error) {
        console.error('[tasks] échec du chargement initial :', error);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vault]);

  const handleChooseFolder = async () => {
    if (!vault) return;
    try {
      const chosen = await vault.chooseFolder();
      setVaultPath(chosen);
      if (chosen) await refreshTasks();
    } catch (error) {
      console.error('[vault] échec du choix de dossier :', error);
    }
  };

  const handleAddTask = useCallback(async () => {
    if (!tasksBridge) return;
    const text = draft.trim();
    if (!text) return;
    setAddError(null);
    try {
      setTasks(await tasksBridge.add(text));
      setDraft('');
    } catch (error) {
      // Visible dans l'UI, pas juste dans la console — un échec silencieux
      // donnait l'impression que le bouton "ne faisait rien".
      console.error('[tasks] échec de l’ajout :', error);
      setAddError(error instanceof Error ? error.message : String(error));
    }
  }, [tasksBridge, draft]);

  const handleToggleTask = useCallback(
    async (id: string) => {
      if (!tasksBridge) return;
      try {
        setTasks(await tasksBridge.toggle(id));
      } catch (error) {
        console.error('[tasks] échec du basculement :', error);
      }
    },
    [tasksBridge],
  );

  const handleRemoveTask = useCallback(
    async (id: string) => {
      if (!tasksBridge) return;
      try {
        setTasks(await tasksBridge.remove(id));
      } catch (error) {
        console.error('[tasks] échec de la suppression :', error);
      }
    },
    [tasksBridge],
  );

  if (!vault || !tasksBridge) {
    return (
      <View style={styles.centered}>
        <Text style={[styles.title, { color: theme.text }]}>✅ Tâches</Text>
        <Text style={[styles.muted, { color: theme.textMuted }]}>
          Disponible sur la version desktop pour l’instant (Phase 2 pour mobile/web).
        </Text>
      </View>
    );
  }

  if (!vaultPath) {
    return (
      <View style={styles.centered}>
        <Text style={[styles.title, { color: theme.text }]}>✅ Tâches</Text>
        <Text style={[styles.muted, { color: theme.textMuted }]}>
          Choisis un dossier local pour en faire ton vault (le même que pour tes notes).
        </Text>
        <Pressable
          onPress={() => void handleChooseFolder()}
          style={[styles.button, { backgroundColor: theme.accent }]}
        >
          <Text style={styles.buttonText}>Choisir un dossier</Text>
        </Pressable>
      </View>
    );
  }

  // Non cochées d'abord (ordre de création), cochées ensuite — évite que
  // la liste "saute" visuellement au fil des cases cochées tout en gardant
  // les tâches faites accessibles (annuler, supprimer) sans les mélanger.
  const pending = tasks.filter((task) => !task.done);
  const done = tasks.filter((task) => task.done);

  return (
    <View style={styles.container}>
      <View style={styles.addRow}>
        <TextInput
          value={draft}
          onChangeText={(text) => {
            setDraft(text);
            if (addError) setAddError(null);
          }}
          onSubmitEditing={() => void handleAddTask()}
          placeholder="Nouvelle tâche…"
          placeholderTextColor={theme.textMuted}
          style={[styles.input, { color: theme.text, borderColor: theme.border }]}
        />
        <Pressable
          onPress={() => void handleAddTask()}
          style={[styles.addButton, { backgroundColor: theme.accent }]}
        >
          <Text style={styles.buttonText}>Ajouter</Text>
        </Pressable>
      </View>
      {addError && <Text style={styles.error}>⚠️ {addError}</Text>}

      <ScrollView contentContainerStyle={styles.list}>
        {[...pending, ...done].map((task) => (
          <View key={task.id} style={[styles.taskRow, { borderColor: theme.border }]}>
            <Pressable
              onPress={() => void handleToggleTask(task.id)}
              style={[
                styles.checkbox,
                { borderColor: theme.border },
                task.done && { backgroundColor: theme.accent, borderColor: theme.accent },
              ]}
            >
              {task.done && <Text style={styles.checkboxMark}>✓</Text>}
            </Pressable>
            <Text
              style={[
                styles.taskText,
                { color: task.done ? theme.textMuted : theme.text },
                task.done && styles.taskTextDone,
              ]}
            >
              {task.text}
            </Text>
            <Pressable onPress={() => void handleRemoveTask(task.id)} style={styles.removeButton}>
              <Text style={{ color: theme.textMuted }}>✕</Text>
            </Pressable>
          </View>
        ))}
        {tasks.length === 0 && (
          <Text style={[styles.muted, { color: theme.textMuted }]}>Aucune tâche pour l’instant.</Text>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    maxWidth: 560,
    width: '100%',
    alignSelf: 'center',
    gap: 16,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 12,
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
  button: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
  },
  addRow: {
    flexDirection: 'row',
    gap: 8,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    fontSize: 14,
  },
  addButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    justifyContent: 'center',
  },
  list: {
    gap: 8,
  },
  taskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderRadius: 8,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxMark: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  taskText: {
    flex: 1,
    fontSize: 14,
  },
  taskTextDone: {
    textDecorationLine: 'line-through',
  },
  removeButton: {
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  error: {
    color: '#dc2626',
    fontSize: 13,
  },
});
