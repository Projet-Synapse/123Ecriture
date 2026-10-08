import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { useVaults } from '../lib/sync/VaultsContext';
import {
  compareByDueDate,
  dueDateStatus,
  formatDueDate,
  isoDateFromOffset,
  normalizeDueDateInput,
} from '../lib/taskDueDates';
import { orderAfterDrop, pendingTaskCount, sortNavigatorItems } from '../lib/tasksNavigator';
import { usePreferences } from '../preferences/PreferencesContext';
import { ConfirmDialog } from './ConfirmDialog';
import { DraftTextField } from './DraftTextField';
import { errorMessage } from '../lib/errorMessage';

// Écran Tâches — module de productivité (voir docs/ARCHITECTURE.md §8).
// Stocké dans le vault (.123ecriture/tasks.json + tasklists.json, voir
// apps/desktop/electron/tasks.ts) — chaque coffre a son propre jeu de
// LISTES nommées, chaque liste ses propres tâches. Une seule liste "active"
// à la fois, même logique que le coffre actif (voir VaultsContext).
//
// Refonte façon Microsoft To Do (voir .claude/References/Sources.md §3) :
// chaque tâche peut porter une description, des sous-étapes cochables et
// des pièces jointes, et son texte reste éditable après création — les 4
// manques que documentait l'ancienne version de ce commentaire sont
// comblés. Une tâche "à plat" (checkbox + texte) reste la vue par défaut ;
// cliquer son chevron déplie une "fiche" avec le reste, même idée que
// PropertiesPanel.tsx/OccurrencesPanel.tsx pour les notes.
type Props = {
  // Révélation d'une tâche demandée par un AUTRE écran (recherche globale,
  // palette de commandes — voir App.tsx, `requestOpenTask`) : bascule sur la
  // liste qui la contient puis déplie sa fiche. Même mécanique que
  // `pendingOpenRelPath` pour les notes (voir NotesScreen.tsx) —
  // `onOpenedPendingTask` prévient le parent une fois fait, pour qu'il
  // remette ce champ à null.
  pendingOpenTask?: { taskListId: string; taskId: string } | null;
  onOpenedPendingTask?: () => void;
  // « Nouvelle tâche » demandée depuis la palette de commandes (App.tsx) :
  // un COMPTEUR (token), pas un booléen — redemander la création alors
  // qu'on est déjà sur l'écran Tâches doit re-déclencher le focus, ce
  // qu'un booléen déjà à `true` ne ferait pas. 0 = aucune demande.
  pendingNewTaskToken?: number;
  onConsumedPendingNewTask?: () => void;
};

export function TasksScreen({
  pendingOpenTask,
  onOpenedPendingTask,
  pendingNewTaskToken = 0,
  onConsumedPendingNewTask,
}: Props = {}) {
  const { theme, preferences, setTasksSortByDueDate, setTasksHideCompleted } = usePreferences();
  const vault = typeof window !== 'undefined' ? window.vault : undefined;
  const tasksBridge = typeof window !== 'undefined' ? window.tasks : undefined;
  const taskListsBridge = typeof window !== 'undefined' ? window.taskLists : undefined;
  const contextMenuBridge = typeof window !== 'undefined' ? window.contextMenu : undefined;
  const { vaults, switchVault, activeVaultPath: vaultPath } = useVaults();

  const [taskLists, setTaskLists] = useState<TaskList[]>([]);
  const [activeListId, setActiveListId] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [addError, setAddError] = useState<string | null>(null);
  const [listActionError, setListActionError] = useState<string | null>(null);
  const [taskActionError, setTaskActionError] = useState<string | null>(null);
  const [renamingListId, setRenamingListId] = useState<string | null>(null);
  const [renameListDraft, setRenameListDraft] = useState('');
  const [createListDraft, setCreateListDraft] = useState('');
  // Une seule "fiche" de tâche dépliée à la fois — même idée que le rail
  // de RightSidebar.tsx, évite une liste qui s'étire dans tous les sens si
  // plusieurs tâches étaient dépliées en même temps.
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [newSubtaskDraft, setNewSubtaskDraft] = useState('');
  // Supprimer une liste = suppression EN CASCADE de toutes ses tâches
  // (voir apps/desktop/electron/tasks.ts, "panier jetable") — la plus
  // destructive de l'app, elle passe donc par ConfirmDialog, contrairement
  // aux suppressions simples (tâche/sous-étape) qui restent directes :
  // re-taper une tâche perdue reste supportable, une liste entière non.
  const [confirmDeleteList, setConfirmDeleteList] = useState<TaskList | null>(null);
  // Masquage des tâches terminées + tri par échéance — PRÉFÉRENCES
  // persistées (tasksHideCompleted/tasksSortByDueDate, voir
  // PreferencesContext) : ce sont des préférences de lecture stables, au
  // même titre que fileSortMode pour les fichiers — une utilisatrice qui
  // trie toujours par échéance ou masque toujours les terminées ne devait
  // pas re-configurer à chaque lancement (l'ancien état de session local
  // datait d'avant l'infrastructure de préférences de cet écran).
  const hideCompleted = preferences.tasksHideCompleted;
  const sortByDueDate = preferences.tasksSortByDueDate;
  // Filtre texte local (titre + description, insensible à la casse) —
  // non persisté volontairement : un besoin de session, pas une préférence.
  const [filterDraft, setFilterDraft] = useState('');

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

  useEffect(() => {
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

  // Révèle une tâche demandée par un AUTRE écran (voir Props ci-dessus) —
  // bascule d'abord sur SA liste si ce n'est pas déjà la liste active
  // (`taskListsBridge.switch`, l'effet ci-dessus rechargera alors `tasks`
  // via le changement d'`activeListId`), puis déplie sa fiche. Compare à
  // `activeListId` lu à l'exécution (pas dans les deps) : ce qui compte est
  // l'état COURANT au moment de la demande, pas de re-déclencher cet effet
  // à chaque changement de liste par ailleurs.
  useEffect(() => {
    if (!pendingOpenTask || !taskListsBridge) return;
    void (async () => {
      try {
        if (pendingOpenTask.taskListId !== activeListId) {
          setTaskLists(await taskListsBridge.switch(pendingOpenTask.taskListId));
          setActiveListId(pendingOpenTask.taskListId);
        }
        setExpandedTaskId(pendingOpenTask.taskId);
      } catch (error) {
        console.error('[tasks] échec de la révélation de la tâche demandée :', error);
      } finally {
        onOpenedPendingTask?.();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingOpenTask, taskListsBridge]);

  // « Nouvelle tâche » demandée depuis la palette (voir Props) : focus du
  // champ de création. Consommé seulement une fois une liste active
  // chargée (le champ n'existe pas avant — monté derrière le retour
  // asynchrone du bridge `tasklists:list`) : l'effet rejoue quand
  // `activeListId` passe à non-null et le focus part alors, sinon la
  // demande resterait sans effet à chaque changement d'écran. S'il
  // n'existe AUCUNE liste, la demande reste en attente sans rien casser
  // (écran affiché, message "crées-en une" visible).
  useEffect(() => {
    if (!pendingNewTaskToken || !activeListId) return;
    quickAddInputRefs.current[activeListId]?.focus();
    onConsumedPendingNewTask?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingNewTaskToken, activeListId]);

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
      setListActionError(errorMessage(error));
    }
  }, []);

  // Même idée que runListAction, pour les actions sur une tâche/sous-étape/
  // pièce jointe — regroupées ici puisqu'elles suivent toutes le même
  // schéma (appel bridge → `setTasks` du résultat → erreur visible).
  const runTaskAction = useCallback(async (action: () => Promise<Task[]>) => {
    setTaskActionError(null);
    try {
      setTasks(await action());
    } catch (error) {
      console.error('[tasks] échec :', error);
      setTaskActionError(errorMessage(error));
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

  // v0.4.40 : alias sémantique pour la barre latérale (même mécanique que
  // le sélecteur historique) + tâches de TOUTES les listes (l'arborescence
  // latérale montre chaque liste avec ses tâches, pas seulement l'active).
  const selectList = handleSwitchList;
  const [tasksByList, setTasksByList] = useState<Record<string, Task[]>>({});
  useEffect(() => {
    if (!vault || taskLists.length === 0) return;
    let cancelled = false;
    const load = async () => {
      // tasks.json est une liste PLATE de tâches avec listId (voir
      // apps/desktop/electron/tasks.ts) — on la lit directement pour
      // regrouper par liste, sans dépendre de la liste ACTIVE du pont.
      try {
        const raw = await vault.readNote('.123ecriture/tasks.json');
        const all = JSON.parse(raw) as Task[];
        const out: Record<string, Task[]> = {};
        for (const list of taskLists) out[list.id] = [];
        for (const task of Array.isArray(all) ? all : []) {
          if (out[task.listId]) out[task.listId].push(task);
        }
        if (!cancelled) setTasksByList(out);
      } catch {
        if (!cancelled) setTasksByList({});
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [vault, taskLists, tasks]);

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

  // Champ de création PAR LISTE (brouillons séparés — le navigateur
  // affiche un champ sous chaque liste, ils ne peuvent pas partager un
  // seul state sans se réécrire mutuellement). `handleAddTaskFor` bascule
  // d'abord sur la liste ciblée si nécessaire (`tasks:add` range dans la
  // liste ACTIVE — voir tasks.ts), puis ajoute.
  const [draftsByList, setDraftsByList] = useState<Record<string, string>>({});
  const quickAddInputRefs = useRef<Record<string, TextInput | null>>({});
  // Focus demandé par un handler : programmé via setTimeout(0) plutôt qu'un
  // setState-in-effect (react-hooks l'interdit — cascading renders) ; le
  // champ ciblé est déjà monté (les sections de listes sont rendues en
  // permanence), un micro-délai suffit après le changement d'état.
  const requestFocusListField = useCallback((listId: string) => {
    setTimeout(() => quickAddInputRefs.current[listId]?.focus(), 0);
  }, []);

  const handleAddTaskFor = useCallback(
    async (listId: string) => {
      if (!tasksBridge || !taskListsBridge) return;
      const text = (draftsByList[listId] ?? '').trim();
      if (!text) return;
      setAddError(null);
      try {
        if (activeListId !== listId) {
          setTaskLists(await taskListsBridge.switch(listId));
          setActiveListId(listId);
        }
        setTasks(await tasksBridge.add(text));
        setDraftsByList((prev) => ({ ...prev, [listId]: '' }));
      } catch (error) {
        console.error('[tasks] échec de l’ajout :', error);
        setAddError(errorMessage(error));
      }
    },
    [tasksBridge, taskListsBridge, draftsByList, activeListId],
  );

  const handleToggleTask = useCallback(
    (id: string) => runTaskAction(async () => {
      if (!tasksBridge) return tasks;
      return tasksBridge.toggle(id);
    }),
    [tasksBridge, runTaskAction, tasks],
  );

  const handleRemoveTask = useCallback(
    (id: string) => runTaskAction(async () => {
      if (!tasksBridge) return tasks;
      if (expandedTaskId === id) setExpandedTaskId(null);
      return tasksBridge.remove(id);
    }),
    [tasksBridge, runTaskAction, tasks, expandedTaskId],
  );

  const handleRenameTask = useCallback(
    (id: string, text: string) => runTaskAction(async () => {
      if (!tasksBridge) return tasks;
      return tasksBridge.update(id, { text });
    }),
    [tasksBridge, runTaskAction, tasks],
  );

  const handleChangeDescription = useCallback(
    (id: string, description: string) => runTaskAction(async () => {
      if (!tasksBridge) return tasks;
      return tasksBridge.update(id, { description });
    }),
    [tasksBridge, runTaskAction, tasks],
  );

  // Champ libre au commit différé (DraftTextField) : vide = retire
  // l'échéance, sinon normalisé via normalizeDueDateInput — un format non
  // reconnu est refusé avec message plutôt que silencieusement écrasé.
  const handleChangeDueDate = useCallback(
    (id: string, raw: string) => {
      const trimmed = raw.trim();
      if (!trimmed) {
        void runTaskAction(async () => {
          if (!tasksBridge) return tasks;
          return tasksBridge.update(id, { dueDate: null });
        });
        return;
      }
      const normalized = normalizeDueDateInput(trimmed);
      if (!normalized) {
        setTaskActionError('Date d’échéance invalide — formats attendus : AAAA-MM-JJ ou JJ/MM/AAAA.');
        return;
      }
      void runTaskAction(async () => {
        if (!tasksBridge) return tasks;
        return tasksBridge.update(id, { dueDate: normalized });
      });
    },
    [tasksBridge, runTaskAction, tasks],
  );

  // Déplacer la tâche vers une AUTRE liste (voir tasks:update, patch
  // listId) : elle disparaît de la liste affichée au retour du bridge
  // (filtrage par liste active côté main process).
  const handleMoveTaskToList = useCallback(
    (id: string, listId: string) =>
      runTaskAction(async () => {
        if (!tasksBridge) return tasks;
        if (expandedTaskId === id) setExpandedTaskId(null);
        return tasksBridge.update(id, { listId });
      }),
    [tasksBridge, runTaskAction, tasks, expandedTaskId],
  );

  const handleAddSubtask = useCallback(
    async (taskId: string) => {
      const text = newSubtaskDraft.trim();
      if (!text || !tasksBridge) return;
      setNewSubtaskDraft('');
      await runTaskAction(() => tasksBridge.addSubtask(taskId, text));
    },
    [newSubtaskDraft, tasksBridge, runTaskAction],
  );

  const handleRenameSubtask = useCallback(
    (taskId: string, subtaskId: string, text: string) =>
      runTaskAction(async () => {
        if (!tasksBridge) return tasks;
        return tasksBridge.renameSubtask(taskId, subtaskId, text);
      }),
    [tasksBridge, runTaskAction, tasks],
  );

  const handleToggleSubtask = useCallback(
    (taskId: string, subtaskId: string) =>
      runTaskAction(async () => {
        if (!tasksBridge) return tasks;
        return tasksBridge.toggleSubtask(taskId, subtaskId);
      }),
    [tasksBridge, runTaskAction, tasks],
  );

  const handleRemoveSubtask = useCallback(
    (taskId: string, subtaskId: string) =>
      runTaskAction(async () => {
        if (!tasksBridge) return tasks;
        return tasksBridge.removeSubtask(taskId, subtaskId);
      }),
    [tasksBridge, runTaskAction, tasks],
  );

  // Réutilise le bridge vault GÉNÉRIQUE d'import de pièce jointe (voir
  // NotesScreen.tsx, `handleInsertAttachment`) — pas de mécanisme d'import
  // séparé pour les tâches, juste un ajout du `{relPath, name}` résultant
  // sur la tâche (voir tasks.ts, `tasks:add-attachment`).
  const handleAddAttachment = useCallback(
    async (taskId: string) => {
      if (!vault || !tasksBridge) return;
      try {
        const result = await vault.importAttachment();
        if (!result) return; // dialogue annulé
        await runTaskAction(() => tasksBridge.addAttachment(taskId, result));
      } catch (error) {
        console.error('[tasks] échec de l’ajout de la pièce jointe :', error);
        setTaskActionError(errorMessage(error));
      }
    },
    [vault, tasksBridge, runTaskAction],
  );

  const handleRemoveAttachment = useCallback(
    (taskId: string, relPath: string) =>
      runTaskAction(async () => {
        if (!tasksBridge) return tasks;
        return tasksBridge.removeAttachment(taskId, relPath);
      }),
    [tasksBridge, runTaskAction, tasks],
  );

  // //x. 🗂️ NAVIGATEUR — dossiers, sections, glisser-déposer (v0.4.48,
  // demandes utilisateur : navigateur collé à la barre latérale et élargi,
  // aperçu cochable des sous-étapes sous chaque tâche, réorganisation par
  // glisser-déposer, création par bouton « + » ou clic droit). Les items du
  // navigateur sont des TaskList : une entrée `isFolder` est un DOSSIER de
  // listes (voir types/global.d.ts — stockée dans le même tasklists.json).
  const [openFolderIds, setOpenFolderIds] = useState<string[]>([]);
  const toggleFolder = useCallback((id: string) => {
    setOpenFolderIds((prev) => (prev.includes(id) ? prev.filter((entry) => entry !== id) : [...prev, id]));
  }, []);

  // Création : cible = {isFolder, folderId} choisie dans le menu (« +
  // liste » global, « + » d'un dossier, clic droit « Nouvelle liste ici »).
  // Le formulaire inline s'affiche dans le scope ciblé.
  const [createTarget, setCreateTarget] = useState<{ isFolder: boolean; folderId: string | null } | null>(null);

  const submitCreateList = useCallback(async () => {
    const name = createListDraft.trim();
    if (!name || !taskListsBridge || !createTarget) return;
    setCreateTarget(null);
    setCreateListDraft('');
    await runListAction(async () => {
      setTaskLists(await taskListsBridge.create(name, createTarget.isFolder));
      if (!createTarget.isFolder) {
        setActiveListId(await taskListsBridge.getActive());
      } else if (createTarget.folderId) {
        const parentFolderId = createTarget.folderId;
        setOpenFolderIds((prev) => (prev.includes(parentFolderId) ? prev : [...prev, parentFolderId]));
      }
    });
  }, [createListDraft, taskListsBridge, runListAction, createTarget]);

  // Déplace une liste/dossier vers un dossier (menu « Déplacer vers… »).
  const handleMoveList = useCallback(
    (id: string, folderId: string | null) => runListAction(async () => {
      if (!taskListsBridge) return;
      setTaskLists(await taskListsBridge.moveList(id, folderId));
    }),
    [taskListsBridge, runListAction],
  );

  // Persiste l'ordre après un dépôt (glisser-déposer).
  const handleSetOrder = useCallback(
    (entries: { id: string; order: number }[]) => runListAction(async () => {
      if (!taskListsBridge) return;
      setTaskLists(await taskListsBridge.setOrder(entries));
    }),
    [taskListsBridge, runListAction],
  );

  // Ordre final du scope après dépôt avant `beforeId`, envoyé au pont.
  const commitDrop = useCallback(
    (draggedId: string, beforeId: string | null) => {
      const dragged = taskLists.find((entry) => entry.id === draggedId);
      if (!dragged) return;
      const scope = taskLists.filter((entry) => (entry.folderId ?? null) === (dragged.folderId ?? null));
      void handleSetOrder(orderAfterDrop(scope, draggedId, beforeId));
    },
    [taskLists, handleSetOrder],
  );

  // DnD délégué DOM (même mécanique que l'explorateur de fichiers, voir
  // NotesScreen) : chaque ligne porte `data-tl-id` ; un dépôt SUR un dossier
  // y déplace l'item, un dépôt SUR une liste réordonne avant elle.
  const navigatorRef = useRef<View>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  useEffect(() => {
    const container = navigatorRef.current as unknown as HTMLElement | null;
    if (!container) return;

    let draggedId: string | null = null;
    const rowFrom = (target: EventTarget | null): HTMLElement | null =>
      (target as HTMLElement | null)?.closest?.('[data-tl-id]') as HTMLElement | null ?? null;

    const onDragStart = (event: DragEvent) => {
      const row = rowFrom(event.target);
      draggedId = row?.getAttribute('data-tl-id') ?? null;
    };
    const onDragOver = (event: DragEvent) => {
      if (!draggedId) return;
      event.preventDefault(); // autorise le drop
      const row = rowFrom(event.target);
      const targetId = row?.getAttribute('data-tl-id') ?? null;
      if (targetId !== draggedId) setDropTargetId(targetId);
    };
    const onDrop = (event: DragEvent) => {
      event.preventDefault();
      const row = rowFrom(event.target);
      const targetId = row?.getAttribute('data-tl-id') ?? null;
      if (draggedId && targetId && targetId !== draggedId) {
        const target = taskLists.find((entry) => entry.id === targetId);
        if (target?.isFolder) {
          void handleMoveList(draggedId, targetId);
        } else {
          commitDrop(draggedId, targetId);
        }
      }
      draggedId = null;
      setDropTargetId(null);
    };
    const onDragEnd = () => {
      draggedId = null;
      setDropTargetId(null);
    };

    container.addEventListener('dragstart', onDragStart);
    container.addEventListener('dragover', onDragOver);
    container.addEventListener('drop', onDrop);
    container.addEventListener('dragend', onDragEnd);
    return () => {
      container.removeEventListener('dragstart', onDragStart);
      container.removeEventListener('dragover', onDragOver);
      container.removeEventListener('drop', onDrop);
      container.removeEventListener('dragend', onDragEnd);
    };
  }, [taskLists, handleMoveList, commitDrop]);

  // Pose l'attribut HTML `draggable` réel sur chaque ligne — react-native-
  // web ne transmet pas `draggable` via les props (voir NotesScreen.tsx,
  // même contournement documenté).
  useEffect(() => {
    const container = navigatorRef.current as unknown as HTMLElement | null;
    if (!container) return;
    container.querySelectorAll<HTMLElement>('[data-tl-id]').forEach((row) => {
      row.draggable = true;
    });
  }, [taskLists]);

  // « Déplacer vers… » : racine ou l'un des dossiers (jamais soi-même ni
  // ses descendants — le pont refuse de toute façon les cycles). Déclaré
  // AVANT showNavigatorMenu qui l'appelle.
  const showMoveToMenu = useCallback(
    (item: TaskList) => {
      if (!contextMenuBridge) return;
      const descendants = (folderId: string): string[] => {
        const direct = taskLists.filter((entry) => entry.folderId === folderId).map((entry) => entry.id);
        return [folderId, ...direct.flatMap(descendants)];
      };
      const forbidden = item.isFolder ? new Set(descendants(item.id)) : new Set([item.id]);
      const destinations = [
        { id: '__root__', label: '📁 Racine' },
        ...sortNavigatorItems(taskLists.filter((entry) => entry.isFolder && !forbidden.has(entry.id))).map(
          (folder) => ({ id: folder.id, label: `📁 ${folder.name}` }),
        ),
      ];
      void contextMenuBridge.show(destinations).then((choice) => {
        if (!choice) return;
        void handleMoveList(item.id, choice === '__root__' ? null : choice);
      });
    },
    [contextMenuBridge, taskLists, handleMoveList],
  );

  // Menu contextuel (clic droit délégué + bouton « ⋯ ») d'un item du
  // navigateur — créer/renommer/déplacer/supprimer, comme le navigateur de
  // fichiers. Supprimer un dossier est NON destructif (ses enfants
  // remontent — voir tasks.ts), supprimer une liste passe par
  // ConfirmDialog (panier jetable).
  const showNavigatorMenu = useCallback(
    (item: TaskList) => {
      if (!contextMenuBridge) return;
      const menuItems: { id: string; label: string }[] = item.isFolder
        ? [
            { id: 'new-list-here', label: 'Nouvelle liste ici' },
            { id: 'new-folder-here', label: 'Nouveau dossier ici' },
            { id: 'rename', label: 'Renommer' },
            { id: 'move', label: 'Déplacer vers…' },
            { id: 'delete', label: 'Supprimer le dossier (les listes remontent)' },
          ]
        : [
            { id: 'new-task', label: 'Nouvelle tâche' },
            { id: 'rename', label: 'Renommer' },
            { id: 'move', label: 'Déplacer vers…' },
            { id: 'delete', label: 'Supprimer la liste' },
          ];
      void contextMenuBridge.show(menuItems).then((choice) => {
        if (!choice) return;
        if (choice === 'rename') startRenameList(item);
        if (choice === 'delete') {
          if (item.isFolder) void handleRemoveList(item.id);
          else setConfirmDeleteList(item);
        }
        if (choice === 'move') showMoveToMenu(item);
        if (choice === 'new-list-here') setCreateTarget({ isFolder: false, folderId: item.id });
        if (choice === 'new-folder-here') setCreateTarget({ isFolder: true, folderId: item.id });
        if (choice === 'new-task') {
          void selectList(item.id);
          requestFocusListField(item.id);
        }
      });
    },
    [contextMenuBridge, startRenameList, handleRemoveList, showMoveToMenu, selectList, requestFocusListField],
  );

  // Clic droit délégué sur tout le navigateur (même mécanique que
  // l'explorateur de fichiers — voir NotesScreen.tsx).
  useEffect(() => {
    const container = navigatorRef.current as unknown as HTMLElement | null;
    if (!container || !contextMenuBridge) return;
    const handler = (event: MouseEvent) => {
      event.preventDefault();
      const target = event.target as HTMLElement | null;
      const rowEl = target?.closest ? (target.closest('[data-tl-id]') as HTMLElement | null) : null;
      const id = rowEl?.getAttribute('data-tl-id');
      const item = id ? taskLists.find((entry) => entry.id === id) : null;
      if (item) showNavigatorMenu(item);
    };
    container.addEventListener('contextmenu', handler);
    return () => container.removeEventListener('contextmenu', handler);
  }, [taskLists, contextMenuBridge, showNavigatorMenu]);

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
    // Même logique que NotesScreen : coffre enregistré dont la permission a
    // expiré (web) → réactivation en un clic plutôt que re-choix du dossier.
    return (
      <View style={styles.centered}>
        <Text style={[styles.title, { color: theme.text }]}>✅ Tâches</Text>
        {vaults.length > 0 && (
          <>
            <Text style={[styles.muted, { color: theme.textMuted }]}>
              Réactive ton coffre pour cette session — le navigateur demande à nouveau la permission des dossiers locaux à chaque ouverture.
            </Text>
            {vaults.map((vaultEntry) => (
              <Pressable
                key={vaultEntry.id}
                onPress={() => void switchVault(vaultEntry.id)}
                style={[styles.button, { backgroundColor: theme.accent }]}
              >
                <Text style={styles.buttonText}>Réactiver « {vaultEntry.name} »</Text>
              </Pressable>
            ))}
          </>
        )}
        {vaults.length === 0 && (
          <Text style={[styles.muted, { color: theme.textMuted }]}>
            Choisis un dossier local pour en faire ton vault (le même que pour tes notes).
          </Text>
        )}
        <Pressable
          onPress={() => void handleChooseFolder()}
          style={[styles.button, { backgroundColor: theme.accent }]}
        >
          <Text style={styles.buttonText}>Choisir un dossier</Text>
        </Pressable>
      </View>
    );
  }

  // Filtre global de l'en-tête : s'applique aux tâches de TOUTES les
  // listes (chaque liste filtre ses propres tâches au rendu, voir
  // renderScopeItems).
  const filter = filterDraft.trim().toLowerCase();
  const filterActive = filter.length > 0;
  const matchesFilter = (task: Task) =>
    task.text.toLowerCase().includes(filter) || (task.description ?? '').toLowerCase().includes(filter);
  // Libellé + couleur du badge d'échéance selon le jour courant — "en
  // retard" reste informatif même cochée (la donnée survit au tri).
  const dueDateBadge = (task: Task): { label: string; color: string } | null => {
    if (!task.dueDate) return null;
    const status = dueDateStatus(task.dueDate);
    if (!status) return null;
    const formatted = formatDueDate(task.dueDate);
    if (task.done) return { label: `📅 ${formatted}`, color: theme.textMuted };
    if (status === 'today') return { label: "📅 Aujourd'hui", color: '#d97706' };
    if (status === 'overdue') return { label: `⏰ ${formatted}`, color: theme.danger };
    return { label: `📅 ${formatted}`, color: theme.textMuted };
  };

  const renderTask = (task: Task) => {
    const isExpanded = expandedTaskId === task.id;
    const doneSubtasks = task.subtasks.filter((s) => s.done).length;
    const dueBadge = dueDateBadge(task);

    return (
      <View key={task.id} style={[styles.taskCard, { borderColor: theme.border }]}>
        <View style={styles.taskRow}>
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
          <DraftTextField
            initialValue={task.text}
            onCommit={(text) => text.trim() && void handleRenameTask(task.id, text.trim())}
            theme={theme}
            style={[
              styles.taskTextInput,
              { color: task.done ? theme.textMuted : theme.text },
              task.done && styles.taskTextDone,
            ] as unknown as object}
          />
          {dueBadge && (
            <Text style={[styles.dueBadge, { color: dueBadge.color }]} numberOfLines={1}>
              {dueBadge.label}
            </Text>
          )}
          {task.subtasks.length > 0 && (
            <Text style={[styles.subtaskBadge, { color: theme.textMuted, borderColor: theme.border }]}>
              {doneSubtasks}/{task.subtasks.length}
            </Text>
          )}
          <Pressable
            onPress={() => setExpandedTaskId(isExpanded ? null : task.id)}
            style={styles.chevronButton}
            accessibilityLabel={isExpanded ? 'Masquer les détails' : 'Afficher les détails'}
          >
            <Text style={{ color: theme.textMuted }}>{isExpanded ? '▾' : '▸'}</Text>
          </Pressable>
          <Pressable onPress={() => void handleRemoveTask(task.id)} style={styles.removeButton}>
            <Text style={{ color: theme.textMuted }}>✕</Text>
          </Pressable>
        </View>

        {/* APERÇU (tâche repliée) — demande utilisateur : « juste dessous un
            aperçu cochable des sous-étapes (si existantes) ainsi que de la
            description », en gris discret. Cocher ici coche pour de bon
            (même pont que la fiche dépliée) ; l'édition complète passe par
            le chevron. Masqué en fiche dépliée pour ne pas tout doubler. */}
        {!isExpanded && (task.description?.trim() || task.subtasks.length > 0) && (
          <View style={styles.taskPreview}>
            {task.description?.trim() ? (
              <Text style={[styles.previewDescription, { color: theme.textMuted }]} numberOfLines={2}>
                {task.description}
              </Text>
            ) : null}
            {task.subtasks.map((subtask) => (
              <Pressable
                key={subtask.id}
                style={styles.previewSubtaskRow}
                onPress={() => void handleToggleSubtask(task.id, subtask.id)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: subtask.done }}
              >
                <View
                  style={[
                    styles.previewCheckbox,
                    { borderColor: theme.border },
                    subtask.done && { backgroundColor: theme.accent, borderColor: theme.accent },
                  ]}
                >
                  {subtask.done && <Text style={styles.checkboxMark}>✓</Text>}
                </View>
                <Text
                  numberOfLines={1}
                  style={{
                    color: subtask.done ? theme.textMuted : theme.text,
                    fontSize: 12,
                    flex: 1,
                    textDecorationLine: subtask.done ? 'line-through' : 'none',
                  }}
                >
                  {subtask.text}
                </Text>
              </Pressable>
            ))}
          </View>
        )}

        {isExpanded && (
          <View style={[styles.taskDetails, { borderColor: theme.border }]}>
            <Text style={[styles.detailLabel, { color: theme.textMuted }]}>Description</Text>
            <DraftTextField
              initialValue={task.description}
              onCommit={(text) => void handleChangeDescription(task.id, text)}
              placeholder="Ajouter une description…"
              multiline
              theme={theme}
              style={[styles.descriptionInput, { color: theme.text, borderColor: theme.border }] as unknown as object}
            />

            <Text style={[styles.detailLabel, { color: theme.textMuted }]}>Échéance</Text>
            <DraftTextField
              initialValue={task.dueDate ?? ''}
              onCommit={(raw) => handleChangeDueDate(task.id, raw)}
              placeholder="AAAA-MM-JJ ou JJ/MM/AAAA — vider pour retirer"
              theme={theme}
              style={[styles.dueDateInput, { color: theme.text, borderColor: theme.border }] as unknown as object}
            />
            {/* Raccourcis de saisie (boutons) — la date part directement via
                handleChangeDueDate (même chemin que le champ libre, ISO déjà
                valide) : DraftTextField resynchronise son brouillon quand
                `initialValue` change, le champ suit donc le clic. */}
            <View style={styles.dueQuickRow}>
              <Pressable
                onPress={() => handleChangeDueDate(task.id, isoDateFromOffset(0))}
                style={[styles.dueQuickChip, { borderColor: theme.border }]}
                accessibilityLabel="Échéance : aujourd’hui"
              >
                <Text style={[styles.dueQuickChipText, { color: theme.textMuted }]}>Aujourd’hui</Text>
              </Pressable>
              <Pressable
                onPress={() => handleChangeDueDate(task.id, isoDateFromOffset(1))}
                style={[styles.dueQuickChip, { borderColor: theme.border }]}
                accessibilityLabel="Échéance : demain"
              >
                <Text style={[styles.dueQuickChipText, { color: theme.textMuted }]}>Demain</Text>
              </Pressable>
              <Pressable
                onPress={() => handleChangeDueDate(task.id, isoDateFromOffset(7))}
                style={[styles.dueQuickChip, { borderColor: theme.border }]}
                accessibilityLabel="Échéance : dans une semaine"
              >
                <Text style={[styles.dueQuickChipText, { color: theme.textMuted }]}>+7 j</Text>
              </Pressable>
              {task.dueDate && (
                <Pressable
                  onPress={() => handleChangeDueDate(task.id, '')}
                  style={[styles.dueQuickChip, { borderColor: theme.border }]}
                  accessibilityLabel="Retirer l’échéance"
                >
                  <Text style={[styles.dueQuickChipText, { color: theme.danger }]}>✕ Retirer</Text>
                </Pressable>
              )}
            </View>

            {taskLists.length > 1 && (
              <Pressable
                onPress={() => {
                  if (!contextMenuBridge) return;
                  void contextMenuBridge
                    .show(taskLists.filter((list) => list.id !== task.listId).map((list) => ({ id: list.id, label: list.name })))
                    .then((choice) => {
                      if (choice) void handleMoveTaskToList(task.id, choice);
                    });
                }}
                style={styles.moveListRow}
                accessibilityLabel="Déplacer la tâche vers une autre liste"
              >
                <Text style={{ color: theme.accent, fontSize: 12 }} numberOfLines={1}>
                  ↪ Déplacer vers une autre liste…
                </Text>
              </Pressable>
            )}

            <Text style={[styles.detailLabel, { color: theme.textMuted }]}>Sous-étapes</Text>
            {task.subtasks.map((subtask) => (
              <View key={subtask.id} style={styles.subtaskRow}>
                <Pressable
                  onPress={() => void handleToggleSubtask(task.id, subtask.id)}
                  style={[
                    styles.checkboxSmall,
                    { borderColor: theme.border },
                    subtask.done && { backgroundColor: theme.accent, borderColor: theme.accent },
                  ]}
                >
                  {subtask.done && <Text style={styles.checkboxMarkSmall}>✓</Text>}
                </Pressable>
                <DraftTextField
                  initialValue={subtask.text}
                  onCommit={(text) => text.trim() && void handleRenameSubtask(task.id, subtask.id, text.trim())}
                  theme={theme}
                  style={[
                    styles.subtaskTextInput,
                    { color: subtask.done ? theme.textMuted : theme.text },
                    subtask.done && styles.taskTextDone,
                  ] as unknown as object}
                />
                <Pressable onPress={() => void handleRemoveSubtask(task.id, subtask.id)} style={styles.removeButton}>
                  <Text style={{ color: theme.textMuted }}>✕</Text>
                </Pressable>
              </View>
            ))}
            <View style={styles.addRow}>
              <TextInput
                value={newSubtaskDraft}
                onChangeText={setNewSubtaskDraft}
                onSubmitEditing={() => void handleAddSubtask(task.id)}
                placeholder="Nouvelle sous-étape…"
                placeholderTextColor={theme.textMuted}
                style={[styles.input, { color: theme.text, borderColor: theme.border }]}
              />
              <Pressable
                onPress={() => void handleAddSubtask(task.id)}
                style={[styles.addButton, { backgroundColor: theme.accent }]}
              >
                <Text style={styles.buttonText}>Ajouter</Text>
              </Pressable>
            </View>

            <Text style={[styles.detailLabel, { color: theme.textMuted }]}>Pièces jointes</Text>
            {task.attachments.map((attachment) => (
              <View key={attachment.relPath} style={styles.attachmentChip}>
                <Text style={[styles.attachmentName, { color: theme.text }]} numberOfLines={1}>
                  📎 {attachment.name}
                </Text>
                <Pressable onPress={() => void handleRemoveAttachment(task.id, attachment.relPath)}>
                  <Text style={{ color: theme.textMuted }}>✕</Text>
                </Pressable>
              </View>
            ))}
            <Pressable onPress={() => void handleAddAttachment(task.id)} style={styles.addAttachmentButton}>
              <Text style={{ color: theme.accent, fontSize: 12 }}>📎 Joindre un fichier</Text>
            </Pressable>
          </View>
        )}
      </View>
    );
  };

  // //y. 🌳 RENDU DU NAVIGATEUR — récursif : dossiers (repliables) puis
  // listes ; chaque liste affiche TOUJOURS ses tâches : champ de création,
  // aperçu cochable (description grise, sous-étapes) et fiche dépliable.
  const renderScopeItems = (folderId: string | null, depth: number): ReactNode[] => {
    const items = sortNavigatorItems(taskLists.filter((entry) => (entry.folderId ?? null) === folderId));
    return items.map((item) => {
      const indentStyle = { paddingLeft: depth * 16 };

      if (item.isFolder) {
        const isOpen = openFolderIds.includes(item.id);
        return (
          <View key={item.id} style={indentStyle}>
            <View
              style={[styles.navigatorRow, dropTargetId === item.id && styles.dropTargetRow]}
              dataSet={{ tlId: item.id }}
            >
              <Pressable onPress={() => toggleFolder(item.id)} style={styles.chevronButton}>
                <Text style={{ color: theme.textMuted }}>{isOpen ? '▾' : '▸'}</Text>
              </Pressable>
              <Pressable onPress={() => toggleFolder(item.id)} style={styles.navigatorNameButton}>
                <Text style={{ color: theme.text, fontSize: 13, fontWeight: '600', flex: 1 }} numberOfLines={1}>
                  📁 {item.name}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setCreateTarget({ isFolder: false, folderId: item.id })}
                style={styles.navigatorAction}
                accessibilityLabel={`Nouvelle liste dans ${item.name}`}
              >
                <Text style={{ color: theme.accent }}>➕</Text>
              </Pressable>
              <Pressable onPress={() => showNavigatorMenu(item)} style={styles.navigatorAction}>
                <Text style={{ color: theme.textMuted }}>⋯</Text>
              </Pressable>
            </View>
            {isOpen && (
              <View>
                {renderScopeItems(item.id, depth + 1)}
                {createTarget && createTarget.folderId === item.id && (
                  <View style={[styles.addRow, { paddingLeft: 16 }]}>
                    <TextInput
                      autoFocus
                      value={createListDraft}
                      onChangeText={setCreateListDraft}
                      onSubmitEditing={() => void submitCreateList()}
                      placeholder={createTarget.isFolder ? 'Nom du sous-dossier…' : 'Nom de la liste…'}
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
              </View>
            )}
          </View>
        );
      }

      // LISTE — titre + champ de création + tâches en permanence (filtrées
      // et triées selon les préférences de l'en-tête).
      const isRenamingList = renamingListId === item.id;
      const listTasksAll = tasksByList[item.id] ?? [];
      const pendingAll = listTasksAll.filter((task) => !task.done);
      const doneAll = listTasksAll.filter((task) => task.done);
      const pending = filterActive ? pendingAll.filter(matchesFilter) : pendingAll;
      const done = filterActive ? doneAll.filter(matchesFilter) : doneAll;
      const sortedPending = sortByDueDate
        ? [...pending].sort((a, b) => compareByDueDate(a.dueDate, b.dueDate))
        : pending;
      const visibleTasks = [...sortedPending, ...(hideCompleted ? [] : done)];

      return (
        <View key={item.id} style={indentStyle}>
          <View
            style={[
              styles.navigatorRow,
              styles.listRow,
              item.id === activeListId && { backgroundColor: `${theme.accent}14` },
              dropTargetId === item.id && styles.dropTargetRow,
            ]}
            dataSet={{ tlId: item.id }}
          >
            <Pressable
              onPress={() => void selectList(item.id)}
              style={styles.navigatorNameButton}
              accessibilityRole="button"
            >
              {isRenamingList ? (
                <TextInput
                  autoFocus
                  value={renameListDraft}
                  onChangeText={setRenameListDraft}
                  onSubmitEditing={() => void submitRenameList()}
                  onBlur={() => void submitRenameList()}
                  style={[styles.listNameInput, { color: theme.text, borderColor: theme.accent }]}
                />
              ) : (
                <Text
                  style={{
                    color: item.id === activeListId ? theme.accent : theme.text,
                    fontSize: 13,
                    fontWeight: '600',
                    flex: 1,
                  }}
                  numberOfLines={1}
                >
                  📋 {item.name}
                </Text>
              )}
            </Pressable>
            <Text style={{ color: theme.textMuted, fontSize: 11 }}>{pendingTaskCount(listTasksAll)}</Text>
            <Pressable
              onPress={() => requestFocusListField(item.id)}
              style={styles.navigatorAction}
              accessibilityLabel={`Nouvelle tâche dans ${item.name}`}
            >
              <Text style={{ color: theme.accent }}>➕</Text>
            </Pressable>
            <Pressable onPress={() => showNavigatorMenu(item)} style={styles.navigatorAction}>
              <Text style={{ color: theme.textMuted }}>⋯</Text>
            </Pressable>
          </View>

          <View style={[styles.listTasksBlock, { paddingLeft: 16 }]}>
            <View style={styles.addRow}>
              <TextInput
                ref={(input) => {
                  quickAddInputRefs.current[item.id] = input;
                }}
                value={draftsByList[item.id] ?? ''}
                onChangeText={(text) => {
                  setDraftsByList((prev) => ({ ...prev, [item.id]: text }));
                  if (addError) setAddError(null);
                }}
                onSubmitEditing={() => void handleAddTaskFor(item.id)}
                placeholder="Nouvelle tâche…"
                placeholderTextColor={theme.textMuted}
                style={[styles.input, { color: theme.text, borderColor: theme.border }]}
              />
              <Pressable
                onPress={() => void handleAddTaskFor(item.id)}
                style={[styles.addButton, { backgroundColor: theme.accent }]}
              >
                <Text style={styles.buttonText}>Ajouter</Text>
              </Pressable>
            </View>
            {visibleTasks.map(renderTask)}
            {listTasksAll.length === 0 && (
              <Text style={[styles.navigatorMuted, { color: theme.textMuted }]}>Aucune tâche pour l’instant.</Text>
            )}
            {filterActive && listTasksAll.length > 0 && visibleTasks.length === 0 && (
              <Text style={[styles.navigatorMuted, { color: theme.textMuted }]}>
                Aucune tâche ne correspond au filtre.
              </Text>
            )}
          </View>
        </View>
      );
    });
  };

  return (
    <View style={[styles.container, styles.navigatorScreen]}>
      {/* En-tête : titre + créations (menu « + » : liste/dossier) + filtre +
          préférences de lecture (tri échéance / masquage des terminées —
          persistées, appliquées à TOUTES les listes du navigateur). */}
      <View style={styles.headerRow}>
        <Text style={[styles.screenTitle, { color: theme.text }]}>Tâches</Text>
        <View style={styles.headerActions}>
          <Pressable
            onPress={() => {
              if (!contextMenuBridge) {
                setCreateTarget({ isFolder: false, folderId: null });
                return;
              }
              void contextMenuBridge
                .show([
                  { id: 'list', label: 'Nouvelle liste' },
                  { id: 'folder', label: 'Nouveau dossier' },
                ])
                .then((choice) => {
                  if (choice === 'list') setCreateTarget({ isFolder: false, folderId: null });
                  if (choice === 'folder') setCreateTarget({ isFolder: true, folderId: null });
                });
            }}
            style={styles.headerAction}
            accessibilityLabel="Nouvelle liste ou nouveau dossier"
          >
            <Text style={{ color: theme.accent, fontSize: 18 }}>➕</Text>
          </Pressable>
          <Pressable
            onPress={() => void setTasksSortByDueDate(!sortByDueDate)}
            accessibilityLabel={sortByDueDate ? 'Revenir à l’ordre d’ajout' : 'Trier par échéance'}
            style={[styles.headerChip, { borderColor: theme.border }, sortByDueDate && { borderColor: theme.accent }]}
          >
            <Text style={{ color: sortByDueDate ? theme.accent : theme.textMuted, fontSize: 11 }}>
              {sortByDueDate ? '✓ Tri : échéance' : 'Trier par échéance'}
            </Text>
          </Pressable>
          {tasks.some((task) => task.done) && (
            <Pressable
              onPress={() => void setTasksHideCompleted(!hideCompleted)}
              accessibilityLabel={hideCompleted ? 'Afficher les tâches terminées' : 'Masquer les tâches terminées'}
              style={[styles.headerChip, { borderColor: theme.border }, hideCompleted && { borderColor: theme.accent }]}
            >
              <Text style={{ color: hideCompleted ? theme.accent : theme.textMuted, fontSize: 11 }}>
                {hideCompleted ? '✓ Terminées masquées' : 'Masquer les terminées'}
              </Text>
            </Pressable>
          )}
        </View>
      </View>
      <TextInput
        value={filterDraft}
        onChangeText={setFilterDraft}
        placeholder="Filtrer les tâches…"
        placeholderTextColor={theme.textMuted}
        style={[styles.filterInput, { color: theme.text, borderColor: theme.border }]}
      />
      {listActionError && <Text style={[styles.error, { color: theme.danger }]}>⚠️ {listActionError}</Text>}
      {taskActionError && <Text style={[styles.error, { color: theme.danger }]}>⚠️ {taskActionError}</Text>}

      {/* Navigateur — PLEIN ESPACE, collé à la barre latérale principale
          (l'ancien conteneur le centrait avec maxWidth 560 : grand vide
          rapporté). Chaque DOSSIER se replie ; chaque LISTE affiche ses
          tâches en permanence : titre, champ de création, et tâches en
          aperçu cochable (description grise, sous-étapes) avec fiche
          complète dépliable via le chevron. */}
      <ScrollView style={styles.navigatorScroll} nestedScrollEnabled>
        <View ref={navigatorRef} style={styles.navigator}>
          {taskLists.length === 0 ? (
            <View style={styles.centered}>
              <Text style={[styles.muted, { color: theme.textMuted }]}>
                Aucune liste pour l’instant — crées-en une pour commencer.
              </Text>
              <Pressable
                onPress={() => setCreateTarget({ isFolder: false, folderId: null })}
                style={[styles.button, { backgroundColor: theme.accent }]}
              >
                <Text style={styles.buttonText}>Nouvelle liste</Text>
              </Pressable>
            </View>
          ) : (
            renderScopeItems(null, 0)
          )}
          {/* Formulaire de création inline (cible choisie dans le menu « + »
              ou le clic droit — racine ici ; les dossiers l'affichent à
              l'intérieur de leur propre scope). */}
          {createTarget && createTarget.folderId === null && (
            <View style={styles.addRow}>
              <TextInput
                autoFocus
                value={createListDraft}
                onChangeText={setCreateListDraft}
                onSubmitEditing={() => void submitCreateList()}
                placeholder={createTarget.isFolder ? 'Nom du dossier…' : 'Nom de la liste…'}
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
        </View>
      </ScrollView>

      {/* Confirmation de suppression de LISTE (panier jetable — les tâches
          partent avec) ; un DOSSIER ne passe pas ici : sa suppression est
          non destructive (les listes remontent, voir tasks.ts). */}
      {confirmDeleteList && (
        <ConfirmDialog
          theme={theme}
          title={`Supprimer « ${confirmDeleteList.name} » ?`}
          message={`La liste et ses ${(tasksByList[confirmDeleteList.id] ?? []).length} tâche${(tasksByList[confirmDeleteList.id] ?? []).length > 1 ? 's' : ''} seront supprimées définitivement.`}
          onConfirm={() => handleRemoveList(confirmDeleteList.id)}
          onCancel={() => setConfirmDeleteList(null)}
          onSettled={() => setConfirmDeleteList(null)}
        />
      )}
    </View>
  );
}


const styles = StyleSheet.create({
  // v0.4.48 : l'écran est UN navigateur plein espace, collé à la barre
  // latérale principale — l'ancien conteneur se centrait avec maxWidth 560
  // (grand vide à gauche de la sidebar des tâches, capture rapportée) et
  // la colonne d'édition à droite est remplacée par les fiches dépliables
  // du navigateur lui-même.
  navigatorScreen: {
    gap: 10,
    padding: 12,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
  },
  screenTitle: {
    fontSize: 20,
    fontWeight: '600',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
    flexWrap: 'wrap',
  },
  headerAction: {
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  headerChip: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  navigatorScroll: {
    flex: 1,
  },
  navigator: {
    gap: 2,
    paddingBottom: 60,
  },
  navigatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 7,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  listRow: {
    marginTop: 6,
  },
  navigatorNameButton: {
    flex: 1,
    minWidth: 0,
  },
  navigatorAction: {
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  navigatorMuted: {
    fontSize: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  dropTargetRow: {
    borderTopWidth: 2,
    borderTopColor: '#4f46e5',
  },
  listTasksBlock: {
    gap: 4,
    paddingBottom: 4,
  },
  taskPreview: {
    paddingHorizontal: 34,
    paddingTop: 2,
    gap: 2,
  },
  previewDescription: {
    fontSize: 12,
    lineHeight: 16,
  },
  previewSubtaskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 2,
  },
  previewCheckbox: {
    width: 14,
    height: 14,
    borderRadius: 4,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  screenRow: {
    flexDirection: 'row',
  },
  sidebar: {
    width: 230,
    borderRightWidth: 1,
    padding: 8,
    gap: 4,
  },
  sidebarTitle: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingHorizontal: 6,
    paddingBottom: 4,
  },
  sidebarScroll: {
    flex: 1,
  },
  sidebarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 6,
    borderRadius: 6,
  },
  sidebarTaskRow: {
    paddingLeft: 22,
  },
  sidebarMuted: {
    fontSize: 12,
    paddingHorizontal: 6,
  },
  mainColumn: {
    flex: 1,
    minWidth: 0,
  },
  container: {
    flex: 1,
    gap: 12,
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
  // Compteur "N à faire · M terminées" + bascule de masquage
  listMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  // Regroupe "Trier par échéance" et "Masquer les terminées" quand les deux
  // sont présents (sinon les deux libellés se partagent mal l'espace).
  listMetaActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  listMetaText: {
    fontSize: 13,
  },
  listMetaAction: {
    fontSize: 13,
    fontWeight: '500',
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
    fontSize: 13,
    fontWeight: '600',
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 6,
    flex: 1,
    borderBottomWidth: 1,
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
  // Filtre texte local — une ligne compacte, visuellement distincte du
  // champ de création (plus étroite, pas de bouton associé).
  filterInput: {
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 12,
    fontSize: 13,
  },
  list: {
    gap: 8,
  },
  taskCard: {
    borderWidth: 1,
    borderRadius: 8,
  },
  taskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
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
  // `flex:1` + bordure transparente par défaut (cohérent visuellement avec
  // le reste de la ligne) : le champ ne se distingue d'un simple <Text>
  // qu'au focus, où `DraftTextField`/react-native-web affiche le curseur —
  // pas besoin d'un style "mode édition" séparé.
  taskTextInput: {
    flex: 1,
    fontSize: 14,
    paddingVertical: 2,
  },
  taskTextDone: {
    textDecorationLine: 'line-through',
  },
  subtaskBadge: {
    fontSize: 11,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  // Badge 📅/⏰ d'échéance — sans bordure (contrairement au badge de
  // sous-étapes) : c'est une date informative, pas un compteur.
  dueBadge: {
    fontSize: 11,
    flexShrink: 1,
  },
  chevronButton: {
    paddingHorizontal: 4,
  },
  removeButton: {
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  taskDetails: {
    borderTopWidth: 1,
    padding: 10,
    gap: 6,
  },
  detailLabel: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    marginTop: 4,
  },
  descriptionInput: {
    borderWidth: 1,
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 8,
    fontSize: 13,
    minHeight: 60,
  },
  // Une ligne seulement (contrairement à la description multiligne) : une
  // échéance est courte par nature, pas un texte à rédiger.
  dueDateInput: {
    borderWidth: 1,
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 8,
    fontSize: 13,
  },
  // Raccourcis d'échéance cliquables (Aujourd'hui/Demain/+7 j/Retirer) —
  // chips fines sous le champ libre, sans bouton plein (l'action est
  // secondaire par rapport à la saisie).
  dueQuickRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  dueQuickChip: {
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 3,
    paddingHorizontal: 8,
  },
  dueQuickChipText: {
    fontSize: 11,
  },
  moveListRow: {
    paddingVertical: 4,
  },
  subtaskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  checkboxSmall: {
    width: 16,
    height: 16,
    borderRadius: 4,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxMarkSmall: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
  },
  subtaskTextInput: {
    flex: 1,
    fontSize: 13,
  },
  attachmentChip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  attachmentName: {
    fontSize: 13,
    flex: 1,
  },
  addAttachmentButton: {
    paddingVertical: 4,
  },
  error: {
    fontSize: 13,
  },
});
