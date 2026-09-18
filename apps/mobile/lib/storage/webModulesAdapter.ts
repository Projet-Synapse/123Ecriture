// //1. 📚 SOMMAIRE — modules de productivité web
// ////////////////////////////////////////////////////////////////////////
// Port des handlers Electron de modules (tasks.ts, calendar.ts,
// properties.ts, occurrences.ts) sur le coffre web : mêmes fichiers JSON
// sous `.123ecriture/`, mêmes validations, mêmes messages d'erreur — un
// coffre écrit par l'app web reste lisible par l'app desktop et
// réciproquement. Chaque opération attend le coffre ACTIF du registre web
// (webVaultRegistry) et se dégrade comme le desktop quand aucun coffre
// n'est sélectionné ([] ou erreur explicite).
//
// - //2. Helpers JSON (lecture/écriture tolérante des registres)
// - //3. Tâches et listes de tâches (.123ecriture/tasks.json/tasklists.json)
// - //4. Calendrier (.123ecriture/events.json)
// - //5. Propriétés (.123ecriture/properties.json, + migration frontmatter
//      au renommage via lib/frontmatterMigration)
// - //6. Occurrences (.123ecriture/occurrences.json, + réécriture {{mot}}
//      dans tout le coffre au renommage)

import { randomUUID } from './webUuid';
import { parseFrontmatter } from '../frontmatter';
import { inferPropertyType } from '../propertyTypes';
import { type FsaDirectoryHandleLike, listNoteRelPaths, readFileText, writeFileText } from './webFs';

import { getActiveConfigDir, webVaultRegistry } from './webVaultRegistry';

// //2. 🔧 HELPERS JSON
// ////////////////////////////////////////////////////////////////////////

async function readJson<T>(configDir: FsaDirectoryHandleLike, fileName: string): Promise<T | null> {
  try {
    return JSON.parse(await readFileText(configDir, fileName)) as T;
  } catch {
    return null;
  }
}

async function writeJson(
  configDir: FsaDirectoryHandleLike,
  fileName: string,
  value: unknown,
): Promise<void> {
  await writeFileText(configDir, fileName, JSON.stringify(value, null, 2));
}

// Le répertoire `.123ecriture/` du coffre actif, ou null (aucun coffre /
// permission non accordée) — chaque handler en dérive son comportement
// "aucun vault sélectionné" identique au desktop.
function requireConfigDir(): Promise<FsaDirectoryHandleLike> {
  return (async () => {
    const configDir = await getActiveConfigDir();
    if (!configDir) throw new Error('Aucun vault sélectionné');
    return configDir;
  })();
}

function optionalConfigDir(): Promise<FsaDirectoryHandleLike | null> {
  return getActiveConfigDir();
}

// Handle racine du coffre actif — requis par les migrations qui écrivent
// dans les NOTES (frontmatter des propriétés renommées, occurrences
// renommées), pas seulement dans .123ecriture/.
async function requireActiveRoot(): Promise<FsaDirectoryHandleLike> {
  const root = await webVaultRegistry.getActiveHandle();
  if (!root) throw new Error('Aucun vault sélectionné');
  return root;
}

// //3. ✅ TÂCHES ET LISTES
// ////////////////////////////////////////////////////////////////////////

type TaskListsData = { lists: TaskList[]; activeListId: string | null };

// Normalisation à la LECTURE (jamais de migration silencieuse sur disque) —
// port direct de normalizeTask (tasks.ts desktop).
function normalizeTask(task: Task): Task {
  return {
    ...task,
    description: task.description ?? '',
    subtasks: task.subtasks ?? [],
    attachments: task.attachments ?? [],
    dueDate: task.dueDate ?? null,
  };
}

// Exportées pour webSearchAdapter (la recherche globale lit tasks.json et
// doit garantir la migration paresseuse avant) — on est dans le même
// paquet : import direct, pas de duplication à la search.ts desktop (dont la
// copie traverse la frontière renderer/main, ce qui n'existe pas ici).
export async function readTasks(configDir: FsaDirectoryHandleLike): Promise<Task[]> {
  const raw = await readJson<Task[]>(configDir, 'tasks.json');
  return (raw ?? []).map(normalizeTask);
}

async function writeTasks(configDir: FsaDirectoryHandleLike, tasks: Task[]): Promise<Task[]> {
  await writeJson(configDir, 'tasks.json', tasks);
  return tasks;
}

// Migration paresseuse et idempotente : première consultation d'un coffre
// (nouveau ou antérieur aux listes multiples) → liste par défaut créée,
// tâches sans listId rangées dedans (port de migrateTaskLists).
export async function migrateTaskLists(configDir: FsaDirectoryHandleLike): Promise<TaskListsData> {
  const data = await readJson<TaskListsData>(configDir, 'tasklists.json');
  if (data) return data;

  const defaultList: TaskList = { id: randomUUID(), name: 'Tâches', createdAt: new Date().toISOString() };
  const fresh: TaskListsData = { lists: [defaultList], activeListId: defaultList.id };
  await writeJson(configDir, 'tasklists.json', fresh);

  const tasks = await readTasks(configDir);
  if (tasks.some((task) => !task.listId)) {
    await writeTasks(
      configDir,
      tasks.map((task) => (task.listId ? task : { ...task, listId: defaultList.id })),
    );
  }
  return fresh;
}

async function getTaskLists(configDir: FsaDirectoryHandleLike): Promise<TaskList[]> {
  return (await migrateTaskLists(configDir)).lists;
}

function findListOrThrow(lists: TaskList[], id: string): TaskList {
  const list = lists.find((entry) => entry.id === id);
  if (!list) throw new Error('Liste introuvable.');
  return list;
}

function findTaskOrThrow(tasks: Task[], id: string): Task {
  const task = tasks.find((entry) => entry.id === id);
  if (!task) throw new Error('Tâche introuvable.');
  return task;
}

export const webTaskListsAdapter = {
  list: async (): Promise<TaskList[]> => {
    const configDir = await optionalConfigDir();
    if (!configDir) return [];
    return getTaskLists(configDir);
  },

  getActive: async (): Promise<string | null> => {
    const configDir = await optionalConfigDir();
    if (!configDir) return null;
    return (await migrateTaskLists(configDir)).activeListId;
  },

  create: async (name: string): Promise<TaskList[]> => {
    const configDir = await requireConfigDir();
    const trimmed = (name ?? '').trim();
    if (!trimmed) throw new Error('Le nom de la liste ne peut pas être vide.');

    const data = await migrateTaskLists(configDir);
    const list: TaskList = { id: randomUUID(), name: trimmed, createdAt: new Date().toISOString() };
    data.lists.push(list);
    data.activeListId = list.id;
    await writeJson(configDir, 'tasklists.json', data);
    return data.lists;
  },

  rename: async (id: string, name: string): Promise<TaskList[]> => {
    const configDir = await requireConfigDir();
    const trimmed = (name ?? '').trim();
    if (!trimmed) throw new Error('Le nom de la liste ne peut pas être vide.');

    const data = await migrateTaskLists(configDir);
    findListOrThrow(data.lists, id).name = trimmed;
    await writeJson(configDir, 'tasklists.json', data);
    return data.lists;
  },

  // Supprime la liste ET ses tâches (panier jetable — port du commentaire
  // desktop ; contrairement aux notes/dossiers, jamais supprimés
  // silencieusement). Dernière liste supprimée = aucun liste active,
  // l'écran Tâches propose d'en créer une nouvelle.
  remove: async (id: string): Promise<TaskList[]> => {
    const configDir = await requireConfigDir();
    const data = await migrateTaskLists(configDir);
    data.lists = data.lists.filter((list) => list.id !== id);
    if (data.activeListId === id) {
      data.activeListId = data.lists[0]?.id ?? null;
    }
    await writeJson(configDir, 'tasklists.json', data);
    await writeTasks(configDir, (await readTasks(configDir)).filter((task) => task.listId !== id));
    return data.lists;
  },

  switch: async (id: string): Promise<TaskList[]> => {
    const configDir = await requireConfigDir();
    const data = await migrateTaskLists(configDir);
    findListOrThrow(data.lists, id);
    data.activeListId = id;
    await writeJson(configDir, 'tasklists.json', data);
    return data.lists;
  },

  // Le pont desktop n'a pas d'évènement tasklists:changed en web (pas de
  // process principal pour diffuser) : retourne un no-op. Les écrans se
  // rafraîchissent déjà par re-fetch après chaque mutation (même contrat).
  onChanged: (): (() => void) => () => undefined,
} satisfies TaskListsBridge;

export const webTasksAdapter = {
  list: async (): Promise<Task[]> => {
    const configDir = await optionalConfigDir();
    if (!configDir) return [];
    const activeListId = (await migrateTaskLists(configDir)).activeListId;
    return (await readTasks(configDir)).filter((task) => task.listId === activeListId);
  },

  add: async (text: string): Promise<Task[]> => {
    const configDir = await requireConfigDir();
    const trimmed = (text ?? '').trim();
    if (!trimmed) throw new Error('Le texte de la tâche ne peut pas être vide.');
    const data = await migrateTaskLists(configDir);
    if (!data.activeListId) throw new Error('Aucune liste sélectionnée — crées-en une d’abord.');

    const tasks = await readTasks(configDir);
    // En tête plutôt qu'en fin de liste (voir tasks.ts : une tâche ajoutée
    // reste visible sans défiler).
    tasks.unshift({
      id: randomUUID(),
      text: trimmed,
      done: false,
      createdAt: new Date().toISOString(),
      listId: data.activeListId,
      description: '',
      subtasks: [],
      attachments: [],
    });
    await writeTasks(configDir, tasks);
    return tasks.filter((task) => task.listId === data.activeListId);
  },

  toggle: async (id: string): Promise<Task[]> => {
    const configDir = await requireConfigDir();
    const activeListId = (await migrateTaskLists(configDir)).activeListId;
    const tasks = (await readTasks(configDir)).map((task) =>
      task.id === id ? { ...task, done: !task.done } : task,
    );
    await writeTasks(configDir, tasks);
    return tasks.filter((task) => task.listId === activeListId);
  },

  remove: async (id: string): Promise<Task[]> => {
    const configDir = await requireConfigDir();
    const activeListId = (await migrateTaskLists(configDir)).activeListId;
    const tasks = (await readTasks(configDir)).filter((task) => task.id !== id);
    await writeTasks(configDir, tasks);
    return tasks.filter((task) => task.listId === activeListId);
  },

  // Un seul point d'entrée générique (texte/description/échéance/liste) —
  // port direct de tasks:update, validations incluses.
  update: async (
    id: string,
    patch: { text?: string; description?: string; dueDate?: string | null; listId?: string },
  ): Promise<Task[]> => {
    const configDir = await requireConfigDir();
    const listsData = await migrateTaskLists(configDir);
    if (patch.listId !== undefined) findListOrThrow(listsData.lists, patch.listId);
    if (patch.dueDate !== undefined && patch.dueDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(patch.dueDate)) {
      throw new Error('Date d’échéance invalide (attendu AAAA-MM-JJ).');
    }
    const tasks = await readTasks(configDir);
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
    await writeTasks(configDir, next);
    return next.filter((task) => task.listId === listsData.activeListId);
  },

  addSubtask: async (taskId: string, text: string): Promise<Task[]> => {
    const configDir = await requireConfigDir();
    const activeListId = (await migrateTaskLists(configDir)).activeListId;
    const trimmed = (text ?? '').trim();
    if (!trimmed) throw new Error('Le texte de la sous-étape ne peut pas être vide.');
    const tasks = await readTasks(configDir);
    findTaskOrThrow(tasks, taskId);
    const next = tasks.map((task) =>
      task.id === taskId
        ? { ...task, subtasks: [...task.subtasks, { id: randomUUID(), text: trimmed, done: false }] }
        : task,
    );
    await writeTasks(configDir, next);
    return next.filter((task) => task.listId === activeListId);
  },

  renameSubtask: async (taskId: string, subtaskId: string, text: string): Promise<Task[]> => {
    const configDir = await requireConfigDir();
    const activeListId = (await migrateTaskLists(configDir)).activeListId;
    const trimmed = (text ?? '').trim();
    if (!trimmed) throw new Error('Le texte de la sous-étape ne peut pas être vide.');
    const tasks = await readTasks(configDir);
    findTaskOrThrow(tasks, taskId);
    const next = tasks.map((task) =>
      task.id === taskId
        ? { ...task, subtasks: task.subtasks.map((sub) => (sub.id === subtaskId ? { ...sub, text: trimmed } : sub)) }
        : task,
    );
    await writeTasks(configDir, next);
    return next.filter((task) => task.listId === activeListId);
  },

  toggleSubtask: async (taskId: string, subtaskId: string): Promise<Task[]> => {
    const configDir = await requireConfigDir();
    const activeListId = (await migrateTaskLists(configDir)).activeListId;
    const tasks = await readTasks(configDir);
    findTaskOrThrow(tasks, taskId);
    const next = tasks.map((task) =>
      task.id === taskId
        ? { ...task, subtasks: task.subtasks.map((sub) => (sub.id === subtaskId ? { ...sub, done: !sub.done } : sub)) }
        : task,
    );
    await writeTasks(configDir, next);
    return next.filter((task) => task.listId === activeListId);
  },

  removeSubtask: async (taskId: string, subtaskId: string): Promise<Task[]> => {
    const configDir = await requireConfigDir();
    const activeListId = (await migrateTaskLists(configDir)).activeListId;
    const tasks = await readTasks(configDir);
    findTaskOrThrow(tasks, taskId);
    const next = tasks.map((task) =>
      task.id === taskId
        ? { ...task, subtasks: task.subtasks.filter((sub) => sub.id !== subtaskId) }
        : task,
    );
    await writeTasks(configDir, next);
    return next.filter((task) => task.listId === activeListId);
  },

  // Pas de copie de fichier ici : le renderer importe déjà la pièce via
  // window.vault.importAttachment() et transmet juste {relPath, name} —
  // même répartition des responsabilités que desktop.
  addAttachment: async (taskId: string, attachment: TaskAttachment): Promise<Task[]> => {
    const configDir = await requireConfigDir();
    const activeListId = (await migrateTaskLists(configDir)).activeListId;
    const tasks = await readTasks(configDir);
    findTaskOrThrow(tasks, taskId);
    const next = tasks.map((task) =>
      task.id === taskId ? { ...task, attachments: [...task.attachments, attachment] } : task,
    );
    await writeTasks(configDir, next);
    return next.filter((task) => task.listId === activeListId);
  },

  removeAttachment: async (taskId: string, relPath: string): Promise<Task[]> => {
    const configDir = await requireConfigDir();
    const activeListId = (await migrateTaskLists(configDir)).activeListId;
    const tasks = await readTasks(configDir);
    findTaskOrThrow(tasks, taskId);
    const next = tasks.map((task) =>
      task.id === taskId
        ? { ...task, attachments: task.attachments.filter((attachment) => attachment.relPath !== relPath) }
        : task,
    );
    await writeTasks(configDir, next);
    return next.filter((task) => task.listId === activeListId);
  },
} satisfies TasksBridge;

// //4. 📅 CALENDRIER (.123ecriture/events.json)
// ////////////////////////////////////////////////////////////////////////

async function readEvents(configDir: FsaDirectoryHandleLike): Promise<CalendarEvent[]> {
  return (await readJson<CalendarEvent[]>(configDir, 'events.json')) ?? [];
}

export const webCalendarAdapter = {
  listEvents: async (): Promise<CalendarEvent[]> => {
    const configDir = await optionalConfigDir();
    if (!configDir) return [];
    return readEvents(configDir);
  },

  addEvent: async (input: CalendarEventInput): Promise<CalendarEvent[]> => {
    const configDir = await requireConfigDir();
    const title = (input?.title ?? '').trim();
    if (!title) throw new Error('Le titre de l’évènement ne peut pas être vide.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input?.date ?? '')) {
      throw new Error('Date invalide (attendu AAAA-MM-JJ).');
    }

    const events = await readEvents(configDir);
    events.push({
      id: randomUUID(),
      title,
      date: input.date,
      time: input?.allDay ? null : input?.time || null,
      allDay: Boolean(input?.allDay),
      notes: input?.notes ?? '',
      createdAt: new Date().toISOString(),
    });
    await writeJson(configDir, 'events.json', events);
    return events;
  },

  updateEvent: async (id: string, patch: Partial<CalendarEventInput>): Promise<CalendarEvent[]> => {
    const configDir = await requireConfigDir();
    const events = (await readEvents(configDir)).map((event) =>
      event.id === id ? { ...event, ...patch, id: event.id } : event,
    );
    await writeJson(configDir, 'events.json', events);
    return events;
  },

  removeEvent: async (id: string): Promise<CalendarEvent[]> => {
    const configDir = await requireConfigDir();
    const events = (await readEvents(configDir)).filter((event) => event.id !== id);
    await writeJson(configDir, 'events.json', events);
    return events;
  },
} satisfies CalendarBridge;

// //5. 🏷️ PROPRIÉTÉS (.123ecriture/properties.json)
// ////////////////////////////////////////////////////////////////////////

const PROPERTY_TYPES: PropertyType[] = ['text', 'list', 'number', 'checkbox', 'date', 'datetime', 'path', 'options'];

function isPropertyType(value: unknown): value is PropertyType {
  return typeof value === 'string' && (PROPERTY_TYPES as string[]).includes(value);
}

// Type 'options' uniquement — normalisation identique au desktop (undefined
// reste undefined, liste vide = []).
function normalizeOptions(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error('La liste d’options est invalide.');
  return value.map((item) => String(item).trim()).filter((item) => item.length > 0);
}

async function readProperties(configDir: FsaDirectoryHandleLike): Promise<PropertyDefinition[]> {
  return (await readJson<PropertyDefinition[]>(configDir, 'properties.json')) ?? [];
}

// Migration de la CLÉ de frontmatter dans les notes au renommage — même
// logique pure et testée que desktop (migrateFrontmatterKey, importée du
// paquet apps/desktop ; ici on EST dans apps/mobile : import direct du
// module source, zéro duplication).
async function migrateRenamedProperty(
  root: FsaDirectoryHandleLike,
  oldName: string,
  newName: string,
): Promise<PropertyRenameMigrationSummary> {
  const { migrateFrontmatterKey } = await import('../frontmatterMigration');
  const summary: PropertyRenameMigrationSummary = { migratedCount: 0, skippedCount: 0, errorCount: 0 };

  for (const relPath of await listNoteRelPaths(root, ['.mdx', '.md'])) {
    try {
      const content = await readFileText(root, relPath);
      const result = migrateFrontmatterKey(content, oldName, newName);
      if (result.skipped) {
        summary.skippedCount += 1;
        continue;
      }
      if (!result.changed) continue;
      await writeFileText(root, relPath, result.content);
      summary.migratedCount += 1;
    } catch (error) {
      // Log-et-continue : une note en échec n'interrompt jamais la migration
      // des suivantes (CLAUDE.md, sauvegarde et gestion des données).
      console.error(`[properties-web] échec de la migration du frontmatter pour "${relPath}" :`, error);
      summary.errorCount += 1;
    }
  }
  return summary;
}

export const webPropertiesAdapter = {
  list: async (): Promise<PropertyDefinition[]> => {
    const configDir = await optionalConfigDir();
    if (!configDir) return [];
    return readProperties(configDir);
  },

  create: async (name: string, type: PropertyType, options?: string[]): Promise<PropertyDefinition[]> => {
    const configDir = await requireConfigDir();
    const trimmed = (name ?? '').trim();
    if (!trimmed) throw new Error('Le nom de la propriété ne peut pas être vide.');
    if (!isPropertyType(type)) throw new Error('Type de propriété invalide.');

    const properties = await readProperties(configDir);
    if (properties.some((property) => property.name.toLowerCase() === trimmed.toLowerCase())) {
      throw new Error('Une propriété porte déjà ce nom.');
    }
    const normalizedOptions = normalizeOptions(options);
    // ⚠️ La lib DOM de TypeScript déclare AUSSI une interface globale
    // PropertyDefinition (CSS @property : inherits/initialValue/syntax) qui
    // fusionne avec la nôtre (types/global.d.ts) — un littéral brut exigerait
    // le champ `inherits`, parasite du format properties.json (identique au
    // desktop). Le cast passe par unknown, localisé ici.
    const definition = {
      id: randomUUID(),
      name: trimmed,
      type,
      createdAt: new Date().toISOString(),
      ...(normalizedOptions !== undefined ? { options: normalizedOptions } : {}),
    } as unknown as PropertyDefinition;
    properties.push(definition);
    await writeJson(configDir, 'properties.json', properties);
    return properties;
  },

  // Schéma écrit D'ABORD, migration des notes seulement après (jamais de
  // notes migrées pour un renommage de schéma qui aurait échoué) — port
  // direct de properties:update.
  update: async (id: string, patch: PropertyPatch): Promise<PropertyUpdateResult> => {
    const configDir = await requireConfigDir();
    const root = await requireActiveRoot();
    const properties = await readProperties(configDir);
    const existing = properties.find((property) => property.id === id);
    if (!existing) throw new Error('Propriété introuvable.');

    const previousName = existing.name;

    if (patch?.name !== undefined) {
      const trimmed = patch.name.trim();
      if (!trimmed) throw new Error('Le nom de la propriété ne peut pas être vide.');
      if (properties.some((property) => property.id !== id && property.name.toLowerCase() === trimmed.toLowerCase())) {
        throw new Error('Une propriété porte déjà ce nom.');
      }
      existing.name = trimmed;
    }
    if (patch?.type !== undefined) {
      if (!isPropertyType(patch.type)) throw new Error('Type de propriété invalide.');
      existing.type = patch.type;
    }
    if (patch?.options !== undefined) {
      existing.options = normalizeOptions(patch.options);
    }

    await writeJson(configDir, 'properties.json', properties);

    if (existing.name !== previousName) {
      const migration = await migrateRenamedProperty(root, previousName, existing.name);
      return { properties, migration };
    }
    return { properties };
  },

  remove: async (id: string): Promise<PropertyDefinition[]> => {
    const configDir = await requireConfigDir();
    const properties = (await readProperties(configDir)).filter((property) => property.id !== id);
    await writeJson(configDir, 'properties.json', properties);
    return properties;
  },

  // Scan du coffre (demande utilisateur : auto-enregistrement des clés de
  // frontmatter + compteur d'usage) — port direct du handler
  // properties:scan-vault desktop, même fusion insensible à la casse,
  // mêmes exclusions created/modified.
  scanVault: async (): Promise<PropertyScanResult> => {
    const configDir = await optionalConfigDir();
    const root = await webVaultRegistry.getActiveHandle();
    if (!configDir || !root) return { properties: [], usage: {}, createdCount: 0 };

    const properties = await readProperties(configDir);
    const usage: Record<string, number> = {};
    const knownByLowerName = new Map(properties.map((property) => [property.name.toLowerCase(), property]));
    const toCreate: PropertyDefinition[] = [];

    for (const relPath of await listNoteRelPaths(root, ['.mdx', '.md'])) {
      let content: string;
      try {
        content = await readFileText(root, relPath);
      } catch {
        continue; // Note illisible entre le listage et la lecture — ignorée.
      }
      for (const [key, value] of Object.entries(parseFrontmatter(content).data)) {
        if (key === 'created' || key === 'modified') continue;
        usage[key] = (usage[key] ?? 0) + 1;
        const lower = key.toLowerCase();
        if (!knownByLowerName.has(lower)) {
          const definition = {
            id: randomUUID(),
            name: key,
            type: inferPropertyType(value),
            createdAt: new Date().toISOString(),
          } as unknown as PropertyDefinition;
          toCreate.push(definition);
          knownByLowerName.set(lower, definition);
        }
      }
    }

    const updatedProperties =
      toCreate.length > 0
        ? (await writeJson(configDir, 'properties.json', [...properties, ...toCreate]), [
            ...properties,
            ...toCreate,
          ])
        : properties;

    return { properties: updatedProperties, usage, createdCount: toCreate.length };
  },
} satisfies PropertiesBridge;

// //6. 🔤 OCCURRENCES (.123ecriture/occurrences.json)
// ////////////////////////////////////////////////////////////////////////

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function readOccurrences(configDir: FsaDirectoryHandleLike): Promise<OccurrenceEntry[]> {
  return (await readJson<OccurrenceEntry[]>(configDir, 'occurrences.json')) ?? [];
}

// Renomme {{ancien}} → {{nouveau}} dans tous les .mdx (mot exact, espaces
// superflus tolérés) — n'écrit que les fichiers réellement modifiés.
async function renameOccurrenceEverywhere(
  root: FsaDirectoryHandleLike,
  oldWord: string,
  newWord: string,
): Promise<void> {
  const pattern = new RegExp(`\\{\\{\\s*${escapeRegExp(oldWord)}\\s*\\}\\}`, 'g');
  for (const relPath of await listNoteRelPaths(root, ['.mdx'])) {
    const content = await readFileText(root, relPath);
    pattern.lastIndex = 0;
    if (!pattern.test(content)) continue;
    const updated = content.replace(pattern, `{{${newWord}}}`);
    if (updated !== content) await writeFileText(root, relPath, updated);
  }
}

export const webOccurrencesAdapter = {
  list: async (): Promise<OccurrenceEntry[]> => {
    const configDir = await optionalConfigDir();
    if (!configDir) return [];
    return readOccurrences(configDir);
  },

  create: async (word: string, description?: string): Promise<OccurrenceEntry[]> => {
    const configDir = await requireConfigDir();
    const trimmed = (word ?? '').trim();
    if (!trimmed) throw new Error('Le mot ne peut pas être vide.');

    const occurrences = await readOccurrences(configDir);
    if (occurrences.some((entry) => entry.word.toLowerCase() === trimmed.toLowerCase())) {
      throw new Error('Ce mot existe déjà dans le dictionnaire.');
    }
    occurrences.push({
      id: randomUUID(),
      word: trimmed,
      description: (description ?? '').trim(),
      createdAt: new Date().toISOString(),
    });
    await writeJson(configDir, 'occurrences.json', occurrences);
    return occurrences;
  },

  // Le renommage d'un mot DOIT rester cohérent avec le texte déjà écrit —
  // réécriture dans tout le coffre AVANT de persister (port direct du
  // commentaire desktop).
  update: async (id: string, patch: OccurrencePatch): Promise<OccurrenceEntry[]> => {
    const configDir = await requireConfigDir();
    const root = await requireActiveRoot();
    const occurrences = await readOccurrences(configDir);
    const existing = occurrences.find((entry) => entry.id === id);
    if (!existing) throw new Error('Occurrence introuvable.');

    if (patch?.word !== undefined) {
      const trimmed = patch.word.trim();
      if (!trimmed) throw new Error('Le mot ne peut pas être vide.');
      if (occurrences.some((entry) => entry.id !== id && entry.word.toLowerCase() === trimmed.toLowerCase())) {
        throw new Error('Ce mot existe déjà dans le dictionnaire.');
      }
      if (trimmed !== existing.word) {
        await renameOccurrenceEverywhere(root, existing.word, trimmed);
        existing.word = trimmed;
      }
    }
    if (patch?.description !== undefined) {
      existing.description = patch.description;
    }
    await writeJson(configDir, 'occurrences.json', occurrences);
    return occurrences;
  },

  remove: async (id: string): Promise<OccurrenceEntry[]> => {
    const configDir = await requireConfigDir();
    const occurrences = (await readOccurrences(configDir)).filter((entry) => entry.id !== id);
    await writeJson(configDir, 'occurrences.json', occurrences);
    return occurrences;
  },

  // {{word}} littéral — calculé à la demande, pas d'index (même choix que
  // desktop à cette échelle).
  findNotes: async (word: string): Promise<string[]> => {
    const root = await webVaultRegistry.getActiveHandle();
    if (!root) return [];
    const pattern = new RegExp(`\\{\\{\\s*${escapeRegExp(word ?? '')}\\s*\\}\\}`);
    const matches: string[] = [];
    for (const relPath of await listNoteRelPaths(root, ['.mdx'])) {
      const content = await readFileText(root, relPath);
      if (pattern.test(content)) matches.push(relPath);
    }
    return matches;
  },
} satisfies OccurrencesBridge;
