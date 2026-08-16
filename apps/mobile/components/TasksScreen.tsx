import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { useVaults } from '../lib/sync/VaultsContext';
import { usePreferences } from '../preferences/PreferencesContext';

// Écran Tâches — module de productivité (voir docs/ARCHITECTURE.md §8).
// Stocké dans le vault (.123ecriture/tasks.json + tasklists.json, voir
// apps/desktop/electron/tasks.js) — chaque coffre a son propre jeu de
// LISTES nommées (plusieurs listes, pas une seule liste plate comme avant),
// et chaque liste ses propres tâches. Une seule liste "active" à la fois,
// exactement comme un seul coffre "actif" à la fois (voir VaultsContext) —
// même logique, un cran plus bas. Fonctionnel mais volontairement minimal :
// pas encore de renommage/édition du texte d'une tâche une fois créée (à
// supprimer/recréer en attendant), pas de sous-tâches, d'échéances ou de
// priorités.
export function TasksScreen() {
  const { theme } = usePreferences();
  const vault = typeof window !== 'undefined' ? window.vault : undefined;
  const tasksBridge = typeof window !== 'undefined' ? window.tasks : undefined;
  const taskListsBridge = typeof window !== 'undefined' ? window.taskLists : undefined;
  const contextMenuBridge = typeof window !== 'undefined' ? window.contextMenu : undefined;
  const { activeVaultPath: vaultPath } = useVaults();

  const [taskLists, setTaskLists] = useState<TaskList[]>([]);
  const [activeListId, setActiveListId] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [draft, setDraft] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [listActionError, setListActionError] = useState<string | null>(null);
  const [renamingListId, setRenamingListId] = useState<string | null>(null);
  const [renameListDraft, setRenameListDraft] = useState('');
  const [showCreateListForm, setShowCreateListForm] = useState(false);
  const [createListDraft, setCreateListDraft] = useState('');

  const refreshTaskLists = useCallback(async () => {
    if (!taskListsBridge) return;
    const [lists, active] = await Promise.all([taskListsBridge.list(), taskListsBridge.getActive()]);
    setTaskLists(lists);
    setActiveListId(active);
  }, [taskListsBridge]);

  const refreshTasks = useCallback(async () => {
    if (!tasksBridge) return;
    setTasks(await tasksBridge.list());
  }, [tasksBridge]);

  // Charge les listes au montage / changement de coffre, et s'abonne aux
  // changements (créées/renommées/supprimées depuis n'importe où — pour
  // l'instant, seul cet écran les modifie, mais même schéma que
  // VaultsContext pour rester cohérent si un jour un deuxième point d'entrée
  // apparaît).
  useEffect(() => {
    if (!vault || !vaultPath || !taskListsBridge) return;
    void (async () => {
      try {
        await refreshTaskLists();
      } catch (error) {
        console.error('[tasklists] échec du chargement initial :', error);
      }
    })();
    const unsubscribe = taskListsBridge.onChanged((lists) => {
      setTaskLists(lists);
      void taskListsBridge.getActive().then(setActiveListId);
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vault, vaultPath, taskListsBridge]);

  // Recharge les tâches à chaque changement de liste active (création,
  // suppression, switch...) — le process principal sait déjà quelle liste
  // est active, `tasks:list` renvoie toujours les bonnes tâches ; `tasks`
  // ici ne fait que suivre `activeListId` pour rester affiché à jour.
  useEffect(() => {
    // Pas besoin de vider `tasks` explicitement quand `activeListId` devient
    // null (dernière liste supprimée) : le rendu bascule déjà sur l'état
    // "Aucune liste" sans jamais lire `tasks` dans ce cas (voir plus bas,
    // `!activeList ? ... : ...`) — la valeur reste simplement inutilisée
    // jusqu'au prochain vrai chargement.
    if (!vault || !vaultPath || !activeListId) return;
    void (async () => {
      try {
        await refreshTasks();
      } catch (error) {
        console.error('[tasks] échec du chargement :', error);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vault, vaultPath, activeListId]);

  const handleChooseFolder = async () => {
    if (!vault) return;
    try {
      await vault.chooseFolder();
    } catch (error) {
      console.error('[vault] échec du choix de dossier :', error);
    }
  };

  const runListAction = useCallback(async (action: () => Promise<void>) => {
    setListActionError(null);
    try {
      await action();
    } catch (error) {
      console.error('[tasklists] échec :', error);
      setListActionError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  const handleSwitchList = useCallback(
    (id: string) => runListAction(async () => {
      if (!taskListsBridge) return;
      setTaskLists(await taskListsBridge.switch(id));
      setActiveListId(id);
    }),
    [taskListsBridge, runListAction],
  );

  const submitCreateList = useCallback(async () => {
    const name = createListDraft.trim();
    if (!name || !taskListsBridge) return;
    setShowCreateListForm(false);
    setCreateListDraft('');
    await runListAction(async () => {
      setTaskLists(await taskListsBridge.create(name));
      setActiveListId(await taskListsBridge.getActive());
    });
  }, [createListDraft, taskListsBridge, runListAction]);

  const startRenameList = useCallback((list: TaskList) => {
    setRenamingListId(list.id);
    setRenameListDraft(list.name);
  }, []);

  const submitRenameList = useCallback(async () => {
    if (!renamingListId || !taskListsBridge) return;
    const id = renamingListId;
    const name = renameListDraft;
    setRenamingListId(null);
    await runListAction(async () => {
      setTaskLists(await taskListsBridge.rename(id, name));
    });
  }, [renamingListId, renameListDraft, taskListsBridge, runListAction]);

  const handleRemoveList = useCallback(
    (id: string) => runListAction(async () => {
      if (!taskListsBridge) return;
      setTaskLists(await taskListsBridge.remove(id));
      setActiveListId(await taskListsBridge.getActive());
    }),
    [taskListsBridge, runListAction],
  );

  const showListSwitcher = useCallback(() => {
    if (!contextMenuBridge) return;
    const items = [
      ...taskLists.map((list) => ({
        id: list.id,
        label: list.id === activeListId ? `✅ ${list.name}` : list.name,
      })),
      { id: '__new__', label: '➕ Nouvelle liste' },
    ];
    void contextMenuBridge.show(items).then((choice) => {
      if (!choice) return;
      if (choice === '__new__') {
        setShowCreateListForm(true);
        return;
      }
      void handleSwitchList(choice);
    });
  }, [contextMenuBridge, taskLists, activeListId, handleSwitchList]);

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

  const activeList = taskLists.find((l) => l.id === activeListId) ?? null;
  const isRenamingActiveList = renamingListId === activeListId;

  // Non cochées d'abord (ordre de création), cochées ensuite — évite que
  // la liste "saute" visuellement au fil des cases cochées tout en gardant
  // les tâches faites accessibles (annuler, supprimer) sans les mélanger.
  const pending = tasks.filter((task) => !task.done);
  const done = tasks.filter((task) => task.done);

  return (
    <View style={styles.container}>
      <View style={styles.listHeaderRow}>
        {isRenamingActiveList ? (
          <TextInput
            autoFocus
            value={renameListDraft}
            onChangeText={setRenameListDraft}
            onSubmitEditing={() => void submitRenameList()}
            onBlur={() => void submitRenameList()}
            style={[styles.listNameInput, { color: theme.text, borderColor: theme.accent }]}
          />
        ) : (
          <Pressable onPress={showListSwitcher} style={styles.listSwitcher}>
            <Text style={[styles.listName, { color: theme.text }]} numberOfLines={1}>
              📋 {activeList ? activeList.name : 'Aucune liste'} {taskLists.length > 0 ? '▾' : ''}
            </Text>
          </Pressable>
        )}
        {activeList && !isRenamingActiveList && (
          <>
            <Pressable onPress={() => startRenameList(activeList)} style={styles.listHeaderAction}>
              <Text style={{ color: theme.textMuted }}>✏️</Text>
            </Pressable>
            <Pressable onPress={() => void handleRemoveList(activeList.id)} style={styles.listHeaderAction}>
              <Text style={{ color: theme.textMuted }}>🗑️</Text>
            </Pressable>
          </>
        )}
        {!activeList && (
          <Pressable
            onPress={() => setShowCreateListForm((prev) => !prev)}
            style={[styles.button, styles.smallButton, { backgroundColor: theme.accent }]}
          >
            <Text style={styles.buttonText}>Nouvelle liste</Text>
          </Pressable>
        )}
      </View>

      {showCreateListForm && (
        <View style={styles.addRow}>
          <TextInput
            autoFocus
            value={createListDraft}
            onChangeText={setCreateListDraft}
            onSubmitEditing={() => void submitCreateList()}
            placeholder="Nom de la liste…"
            placeholderTextColor={theme.textMuted}
            style={[styles.input, { color: theme.text, borderColor: theme.border }]}
          />
          <Pressable
            onPress={() => void submitCreateList()}
            style={[styles.addButton, { backgroundColor: theme.accent }]}
          >
            <Text style={styles.buttonText}>Créer</Text>
          </Pressable>
        </View>
      )}
      {listActionError && <Text style={styles.error}>⚠️ {listActionError}</Text>}

      {!activeList ? (
        <Text style={[styles.muted, { color: theme.textMuted }]}>
          Aucune liste pour l’instant — crées-en une pour commencer.
        </Text>
      ) : (
        <>
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
        </>
      )}
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
  smallButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
  },
  listHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  listSwitcher: {
    flex: 1,
    paddingVertical: 4,
  },
  listName: {
    fontSize: 18,
    fontWeight: '600',
  },
  listNameInput: {
    flex: 1,
    fontSize: 18,
    fontWeight: '600',
    borderBottomWidth: 1,
    paddingVertical: 2,
  },
  listHeaderAction: {
    paddingHorizontal: 6,
    paddingVertical: 4,
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
