// ✒️ 123ECRITURE — lib/storage/nativeTasksAdapter.ts — pont de tâches natif (Android)
//////////////////////////////////////////////////////////////////////////////
//
// Miroir du pont Electron (apps/desktop/electron/tasks.ts, duplication
// assumée comme partout entre les deux paquets, CLAUDE.md) : les tâches
// vivent dans `.123ecriture/tasks.json` (toutes listes confondues, chacune
// taguée `listId`) et le registre des listes dans
// `.123ecriture/tasklists.json`, lus/écrits PAR COFFRE via readNote/
// writeNote du coffre actif.
//
// Invariants du fichier :
//   • Tout passe par le coffre actif — jamais un stockage global : les
//     tâches et listes suivent leur coffre (et donc sa synchro).
//   • Toute migration est PERSISTÉE immédiatement (readListsData réécrit
//     la liste par défaut migrée) — sinon chaque lecture régénère un id
//     différent et les appels suivants échouent « Liste introuvable ».
//   • JSON cassé à la lecture = sauvegarde `.corrupt-*` DANS le coffre
//     avant de repartir à vide : jamais de perte silencieuse (l'écriture
//     partielle SAF est réparée en amont par le pont troncature-sûr).
//
// SOMMAIRE :
//   1. Lectures tolérantes, ids et migration paresseuse des listes
//   2. nativeTasksBridge — les tâches (tasks.json)
//   3. nativeTaskListsBridge — les listes (tasklists.json)
//
//////////////////////////////////////////////////////////////////////////////

//////// 1. Lectures tolérantes, ids et migration paresseuse des listes ///////////////

import { nativeVaultAdapter } from './nativeVaultAdapter';

const TASKS_PATH = '.123ecriture/tasks.json';
const LISTS_PATH = '.123ecriture/tasklists.json';

// Contenu de tasklists.json — miroir manuel de TaskListsData
// (apps/desktop/electron/types.ts, duplication assumée entre paquets).
type NativeTaskListsData = {
  lists: TaskList[];
  activeListId: string | null;
};

// Hermes n'expose pas crypto.randomUUID — identifiant local suffisant
// (unicité dans le fichier du coffre, aucune collision réaliste).
let idCounter = 0;
function newId(): string {
  idCounter += 1;
  return `t-${Date.now().toString(36)}-${idCounter.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

async function readJson(relPath: string): Promise<unknown> {
  let brut: string;
  try {
    brut = await nativeVaultAdapter.readNote(relPath);
  } catch {
    // Fichier absent (coffre neuf, premières tâches) ou coffre inactif :
    // état vide, même sémantique que le try/catch de readTasks côté desktop.
    return null;
  }
  try {
    return JSON.parse(brut);
  } catch {
    // ANTI-PERTE : le fichier existe mais son JSON est cassé (écriture
    // partielle SAF). On le SAUVEGARDE tel quel dans le coffre (jamais de
    // perte silencieuse) et on repart à zéro : l'état vide est réécrit au
    // prochain write, la copie reste récupérable.
    const sauvegarde = `${relPath}.corrupt-${Date.now()}`;
    try {
      await nativeVaultAdapter.writeNote(sauvegarde, brut);
      console.error(`[tasks] ${relPath} : JSON cassé — contenu sauvegardé dans ${sauvegarde}`);
    } catch {
      console.error(`[tasks] ${relPath} : JSON cassé ET sauvegarde impossible`);
    }
    return null;
  }
}

function normalizeTask(task: Task): Task {
  return {
    ...task,
    description: task.description ?? '',
    subtasks: task.subtasks ?? [],
    attachments: task.attachments ?? [],
    dueDate: task.dueDate ?? null,
  };
}

async function readTasks(): Promise<Task[]> {
  const raw = await readJson(TASKS_PATH);
  if (!Array.isArray(raw)) return [];
  return (raw as Task[]).map(normalizeTask);
}

async function writeTasks(tasks: Task[]): Promise<void> {
  await nativeVaultAdapter.writeNote(TASKS_PATH, JSON.stringify(tasks, null, 2));
}

function filterActive(tasks: Task[], activeListId: string | null): Task[] {
  return activeListId ? tasks.filter((task) => task.listId === activeListId) : [];
}

// Même migration paresseuse que desktop : premier accès = liste par défaut.
// Non-async volontairement pour rester appelable de partout (desktop idem).
function migrateLists(data: NativeTaskListsData | null): NativeTaskListsData {
  if (data && Array.isArray(data.lists)) return data;
  const defaultList: TaskList = {
    id: newId(),
    name: 'Tâches',
    createdAt: new Date().toISOString(),
  };
  return { lists: [defaultList], activeListId: defaultList.id };
}

const listListeners = new Set<(lists: TaskList[]) => void>();

async function readListsData(): Promise<NativeTaskListsData> {
  const data = migrateLists((await readJson(LISTS_PATH)) as NativeTaskListsData | null);
  // La liste par défaut fraîchement migrée est PERSISTÉE immédiatement :
  // sinon chaque lecture régénère un identifiant différent et `tasks:add`
  // / `tasklists:switch` échouent (« Liste introuvable » — l'identifiant
  // affiché à l'écran n'existe plus à l'appel suivant). Desktop fait la
  // même écriture dans migrateTaskLists (tasks.ts).
  await nativeVaultAdapter.writeNote(LISTS_PATH, JSON.stringify(data, null, 2));
  return data;
}

async function writeListsData(data: NativeTaskListsData): Promise<NativeTaskListsData> {
  await nativeVaultAdapter.writeNote(LISTS_PATH, JSON.stringify(data, null, 2));
  for (const listener of listListeners) listener(data.lists);
  return data;
}

function findListOrThrow(lists: TaskList[], id: string): TaskList {
  const list = lists.find((l) => l.id === id);
  if (!list) throw new Error('Liste introuvable.');
  return list;
}

function findTaskOrThrow(tasks: Task[], id: string): void {
  if (!tasks.some((task) => task.id === id)) throw new Error('Tâche introuvable.');
}

//////// 2. nativeTasksBridge — les tâches (tasks.json) ////////////////////////////////

export const nativeTasksBridge: TasksBridge = {
  list: async () => {
    const data = await readListsData();
    return filterActive(await readTasks(), data.activeListId);
  },

  add: async (text) => {
    const trimmed = (text ?? '').trim();
    if (!trimmed) throw new Error('Le texte de la tâche ne peut pas être vide.');
    const data = await readListsData();
    if (!data.activeListId) throw new Error('Aucune liste sélectionnée — crées-en une d’abord.');
    const tasks = await readTasks();
    // En tête (desktop idem) : une tâche ajoutée reste visible sans défile.
    tasks.unshift({
      id: newId(),
      text: trimmed,
      done: false,
      createdAt: new Date().toISOString(),
      listId: data.activeListId,
      description: '',
      subtasks: [],
      attachments: [],
    });
    await writeTasks(tasks);
    return filterActive(tasks, data.activeListId);
  },

  toggle: async (id) => {
    const data = await readListsData();
    const tasks = (await readTasks()).map((task) => (task.id === id ? { ...task, done: !task.done } : task));
    await writeTasks(tasks);
    return filterActive(tasks, data.activeListId);
  },

  remove: async (id) => {
    const data = await readListsData();
    const tasks = (await readTasks()).filter((task) => task.id !== id);
    await writeTasks(tasks);
    return filterActive(tasks, data.activeListId);
  },

  update: async (id, patch) => {
    const data = await readListsData();
    if (patch.listId !== undefined) findListOrThrow(data.lists, patch.listId);
    if (patch.dueDate !== undefined && patch.dueDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(patch.dueDate)) {
      throw new Error('Date d’échéance invalide (attendu AAAA-MM-JJ).');
    }
    const tasks = await readTasks();
    findTaskOrThrow(tasks, id);
    const next = tasks.map((task) => {
      if (task.id !== id) return task;
      const text = patch.text !== undefined ? patch.text.trim() : task.text;
      if (!text) throw new Error('Le texte de la tâche ne peut pas être vide.');
      return {
        ...task,
        text,
        description: patch.description ?? task.description,
        dueDate: patch.dueDate !== undefined ? patch.dueDate : (task.dueDate ?? null),
        listId: patch.listId ?? task.listId,
      };
    });
    await writeTasks(next);
    return filterActive(next, data.activeListId);
  },

  addSubtask: async (taskId, text) => {
    const data = await readListsData();
    const trimmed = (text ?? '').trim();
    if (!trimmed) throw new Error('Le texte de la sous-étape ne peut pas être vide.');
    const tasks = await readTasks();
    findTaskOrThrow(tasks, taskId);
    const subtask: Subtask = { id: newId(), text: trimmed, done: false };
    const next = tasks.map((task) =>
      task.id === taskId ? { ...task, subtasks: [...task.subtasks, subtask] } : task,
    );
    await writeTasks(next);
    return filterActive(next, data.activeListId);
  },

  renameSubtask: async (taskId, subtaskId, text) => {
    const data = await readListsData();
    const trimmed = (text ?? '').trim();
    if (!trimmed) throw new Error('Le texte de la sous-étape ne peut pas être vide.');
    const tasks = await readTasks();
    findTaskOrThrow(tasks, taskId);
    const next = tasks.map((task) =>
      task.id === taskId
        ? { ...task, subtasks: task.subtasks.map((s) => (s.id === subtaskId ? { ...s, text: trimmed } : s)) }
        : task,
    );
    await writeTasks(next);
    return filterActive(next, data.activeListId);
  },

  toggleSubtask: async (taskId, subtaskId) => {
    const data = await readListsData();
    const tasks = await readTasks();
    findTaskOrThrow(tasks, taskId);
    const next = tasks.map((task) =>
      task.id === taskId
        ? { ...task, subtasks: task.subtasks.map((s) => (s.id === subtaskId ? { ...s, done: !s.done } : s)) }
        : task,
    );
    await writeTasks(next);
    return filterActive(next, data.activeListId);
  },

  removeSubtask: async (taskId, subtaskId) => {
    const data = await readListsData();
    const tasks = await readTasks();
    findTaskOrThrow(tasks, taskId);
    const next = tasks.map((task) =>
      task.id === taskId ? { ...task, subtasks: task.subtasks.filter((s) => s.id !== subtaskId) } : task,
    );
    await writeTasks(next);
    return filterActive(next, data.activeListId);
  },

  addAttachment: async (taskId, attachment) => {
    const data = await readListsData();
    const tasks = await readTasks();
    findTaskOrThrow(tasks, taskId);
    const next = tasks.map((task) =>
      task.id === taskId ? { ...task, attachments: [...task.attachments, attachment] } : task,
    );
    await writeTasks(next);
    return filterActive(next, data.activeListId);
  },

  removeAttachment: async (taskId, relPath) => {
    const data = await readListsData();
    const tasks = await readTasks();
    findTaskOrThrow(tasks, taskId);
    const next = tasks.map((task) =>
      task.id === taskId ? { ...task, attachments: task.attachments.filter((a) => a.relPath !== relPath) } : task,
    );
    await writeTasks(next);
    return filterActive(next, data.activeListId);
  },
};

//////// 3. nativeTaskListsBridge — les listes (tasklists.json) ////////////////////////

export const nativeTaskListsBridge: TaskListsBridge = {
  list: async () => (await readListsData()).lists,

  getActive: async () => (await readListsData()).activeListId,

  create: async (name, isFolder) => {
    const trimmed = (name ?? '').trim();
    if (!trimmed) throw new Error('Le nom de la liste ne peut pas être vide.');
    const data = await readListsData();
    const nextOrder = Math.max(-1, ...data.lists.map((l) => l.order ?? 0)) + 1;
    const list: TaskList = {
      id: newId(),
      name: trimmed,
      createdAt: new Date().toISOString(),
      ...(isFolder ? { isFolder: true } : {}),
      order: nextOrder,
    };
    data.lists.push(list);
    if (!isFolder) data.activeListId = list.id;
    await writeListsData(data);
    return data.lists;
  },

  rename: async (id, name) => {
    const trimmed = (name ?? '').trim();
    if (!trimmed) throw new Error('Le nom de la liste ne peut pas être vide.');
    const data = await readListsData();
    findListOrThrow(data.lists, id).name = trimmed;
    await writeListsData(data);
    return data.lists;
  },

  remove: async (id) => {
    const data = await readListsData();
    const removed = findListOrThrow(data.lists, id);
    if (removed.isFolder) {
      // Dossier : suppression NON destructive, les enfants remontent.
      for (const item of data.lists) {
        if (item.folderId === id) item.folderId = removed.folderId ?? null;
      }
      data.lists = data.lists.filter((l) => l.id !== id);
      await writeListsData(data);
      return data.lists;
    }
    // Liste : supprimée AVEC ses tâches (desktop idem — un panier jetable).
    data.lists = data.lists.filter((l) => l.id !== id);
    if (data.activeListId === id) {
      data.activeListId = data.lists.find((l) => !l.isFolder)?.id ?? null;
    }
    await writeListsData(data);
    await writeTasks((await readTasks()).filter((task) => task.listId !== id));
    return data.lists;
  },

  switch: async (id) => {
    const data = await readListsData();
    findListOrThrow(data.lists, id);
    data.activeListId = id;
    await writeListsData(data);
    return data.lists;
  },

  moveList: async (id, folderId) => {
    const data = await readListsData();
    const item = findListOrThrow(data.lists, id);
    const target = folderId ? findListOrThrow(data.lists, folderId) : null;
    if (target && !target.isFolder) throw new Error('La destination doit être un dossier.');
    let cursor: TaskList | null = target;
    while (cursor) {
      if (cursor.id === id) throw new Error('Impossible de déplacer un dossier dans lui-même.');
      cursor = cursor.folderId ? (data.lists.find((l) => l.id === cursor?.folderId) ?? null) : null;
    }
    item.folderId = folderId ?? null;
    item.order =
      Math.max(-1, ...data.lists.filter((l) => l.id !== id && l.folderId === folderId).map((l) => l.order ?? 0)) + 1;
    await writeListsData(data);
    return data.lists;
  },

  setOrder: async (entries) => {
    const data = await readListsData();
    for (const { id, order } of entries ?? []) {
      const item = data.lists.find((l) => l.id === id);
      if (item) item.order = order;
    }
    await writeListsData(data);
    return data.lists;
  },

  onChanged: (callback) => {
    listListeners.add(callback);
    return () => listListeners.delete(callback);
  },
};
