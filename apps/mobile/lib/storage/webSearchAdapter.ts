// //1. 🔍 RECHERCHE GLOBALE + HASH DE SYNC (web)
// ////////////////////////////////////////////////////////////////////////
// Port de search.ts (recherche globale) et sync.ts (hashVaultTree) sur le
// coffre web. Mêmes règles que le desktop :
// - parcours SANS filtre d'extension (pièces jointes et dossiers sont des
//   résultats), fichiers cachés ignorés ;
// - lecture paresseuse du contenu (une seule fois par entrée) ;
// - tags = #mot-clé au contour de mot, frontmatter écarté (même parseur que
//   le reste de l'app — vue Tags incluse, voir webVaultAdapter.listTags) ;
// - tâches et évènements cherchables (échéance en ISO ET en français) ;
// - hashVaultTree = SHA-256 de chaque note (mêmes extensions que walkTree,
//   voir le commentaire de sync.ts sur EXTENSION_TO_KIND).

import { parseFrontmatter } from '../frontmatter';
import { type FsaDirectoryHandleLike, getFileByRelPath, listNoteRelPaths, readFileText } from './webFs';

import { getActiveConfigDir, webVaultRegistry } from './webVaultRegistry';
import { migrateTaskLists, readTasks } from './webModulesAdapter';

const NOTE_EXTENSIONS: Partial<Record<string, VaultEntryKind>> = {
  '.mdx': 'markdown',
  '.md': 'markdown',
  '.canvas': 'canvas',
  '.chart': 'chart',
  '.excalidraw': 'excalidraw',
};

const SNIPPET_RADIUS = 60;

// Copie conforme du tableau de lib/taskDueDates.ts (convention de
// duplication assumée entre paquets, voir search.ts desktop pour le
// raisonnement complet).
const MONTHS_SHORT_FR = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

function formatDueDateFr(dueDate: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return null;
  const [year, month, day] = dueDate.split('-').map(Number);
  const label = MONTHS_SHORT_FR[month - 1];
  if (!label) return null;
  return `${day} ${label} ${year}`;
}

function buildSnippet(text: string, matchIndex: number, matchLength: number): string {
  const start = Math.max(0, matchIndex - SNIPPET_RADIUS);
  const end = Math.min(text.length, matchIndex + matchLength + SNIPPET_RADIUS);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';
  return `${prefix}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${suffix}`;
}

const TAG_PATTERN = /(^|[\s])#([\p{L}\p{N}_-]+)/gu;

function extractTags(text: string): string[] {
  const tags = new Set<string>();
  for (const match of text.matchAll(TAG_PATTERN)) {
    tags.add(match[2].toLowerCase());
  }
  return [...tags];
}

type WalkedEntry = {
  relPath: string;
  name: string;
  isFolder: boolean;
  kind: SearchResultKind;
};

// Parcours plat de TOUT le coffre (hors cachés) — équivalent walkAll
// (search.ts desktop). Fichiers non-note = 'attachment'.
async function walkAll(root: FsaDirectoryHandleLike): Promise<WalkedEntry[]> {
  const out: WalkedEntry[] = [];
  async function walk(dir: FsaDirectoryHandleLike, prefix: string): Promise<void> {
    for await (const entry of dir.values()) {
      if (entry.name.startsWith('.')) continue;
      const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.kind === 'directory') {
        out.push({ relPath, name: entry.name, isFolder: true, kind: 'folder' });
        await walk(entry, relPath);
      } else {
        const dot = entry.name.lastIndexOf('.');
        const extension = dot === -1 ? '' : entry.name.slice(dot).toLowerCase();
        const noteKind = NOTE_EXTENSIONS[extension];
        if (noteKind) {
          out.push({ relPath, name: entry.name.slice(0, -extension.length), isFolder: false, kind: noteKind });
        } else {
          out.push({ relPath, name: entry.name, isFolder: false, kind: 'attachment' });
        }
      }
    }
  }
  await walk(root, '');
  return out;
}

async function searchTasks(needle: string): Promise<SearchResult[]> {
  const configDir = await getActiveConfigDir();
  if (!configDir) return [];

  // Assure la migration paresseuse (listId des tâches antérieures aux
  // listes multiples) AVANT la lecture — sinon une tâche legacy remonterait
  // sans taskListId exploitable (même commentaire que search.ts desktop).
  await migrateTaskLists(configDir);
  const tasks = await readTasks(configDir);

  const results: SearchResult[] = [];
  for (const task of tasks) {
    const textIndex = task.text.toLowerCase().indexOf(needle);
    if (textIndex !== -1) {
      results.push({
        relPath: '',
        name: task.text,
        kind: 'task',
        matchType: 'title',
        taskId: task.id,
        taskListId: task.listId,
      });
      continue;
    }

    const description = task.description ?? '';
    const descriptionIndex = description.toLowerCase().indexOf(needle);
    if (descriptionIndex !== -1) {
      results.push({
        relPath: '',
        name: task.text,
        kind: 'task',
        matchType: 'content',
        snippet: buildSnippet(description, descriptionIndex, needle.length),
        taskId: task.id,
        taskListId: task.listId,
      });
      continue;
    }

    const dueDate = typeof task.dueDate === 'string' ? task.dueDate : null;
    const dueLabel = dueDate ? formatDueDateFr(dueDate) : null;
    const dueMatched =
      (dueDate !== null && dueDate.includes(needle)) ||
      (dueLabel !== null && dueLabel.toLowerCase().includes(needle));
    if (dueMatched && dueDate && dueLabel) {
      results.push({
        relPath: '',
        name: task.text,
        kind: 'task',
        matchType: 'content',
        snippet: `Échéance : ${dueLabel}`,
        taskId: task.id,
        taskListId: task.listId,
      });
    }
  }
  return results;
}

async function searchCalendarEvents(needle: string): Promise<SearchResult[]> {
  const configDir = await getActiveConfigDir();
  if (!configDir) return [];
  let events: CalendarEvent[];
  try {
    events = JSON.parse(await readFileText(configDir, 'events.json')) as CalendarEvent[];
  } catch {
    events = [];
  }

  const results: SearchResult[] = [];
  for (const event of events ?? []) {
    const titleIndex = event.title.toLowerCase().indexOf(needle);
    if (titleIndex !== -1) {
      results.push({
        relPath: '',
        name: event.title,
        kind: 'calendar-event',
        matchType: 'title',
        eventId: event.id,
        eventDate: event.date,
      });
      continue;
    }

    const notes = event.notes ?? '';
    const notesIndex = notes.toLowerCase().indexOf(needle);
    if (notesIndex !== -1) {
      results.push({
        relPath: '',
        name: event.title,
        kind: 'calendar-event',
        matchType: 'content',
        snippet: buildSnippet(notes, notesIndex, needle.length),
        eventId: event.id,
        eventDate: event.date,
      });
    }
  }
  return results;
}

export const webSearchAdapter = {
  run: async (query: string, options?: { propertyId?: string; propertyValue?: string }): Promise<SearchResult[]> => {
    const root = await webVaultRegistry.getActiveHandle();
    if (!root) return [];
    const trimmedQuery = (query ?? '').trim();
    const propertyId = options?.propertyId;
    // Ni texte ni filtre : pas de « tout lister » (même règle que desktop).
    if (!trimmedQuery && !propertyId) return [];

    const needle = trimmedQuery.toLowerCase();
    const entries = await walkAll(root);
    const results: SearchResult[] = [];

    for (const entry of entries) {
      // Le filtre par propriété ne concerne que les notes (le frontmatter
      // n'existe que là) — silencieusement ignoré pour le reste.
      if (propertyId && entry.kind !== 'markdown') continue;

      let data: Record<string, unknown> = {};
      let body = '';
      let hasReadContent = false;
      const readNoteOnce = async () => {
        if (hasReadContent) return;
        hasReadContent = true;
        try {
          ({ data, body } = parseFrontmatter(await readFileText(root, entry.relPath)));
        } catch {
          // Fichier illisible entre le listage et la lecture — ignoré plutôt
          // que de faire échouer toute la recherche pour un fichier.
        }
      };

      if (propertyId) {
        await readNoteOnce();
        const rawValue = data[propertyId];
        if (rawValue === undefined || rawValue === null || rawValue === '') continue;
        if (options?.propertyValue) {
          const serialized = String(rawValue).toLowerCase();
          if (!serialized.includes(options.propertyValue.toLowerCase())) continue;
        }
      }

      if (!trimmedQuery) {
        // Filtre par propriété seul, sans texte — tout ce qui a passé le
        // filtre est un résultat.
        results.push({ relPath: entry.relPath, name: entry.name, kind: entry.kind, matchType: 'property' });
        continue;
      }

      const nameIndex = entry.name.toLowerCase().indexOf(needle);
      if (nameIndex !== -1) {
        results.push({ relPath: entry.relPath, name: entry.name, kind: entry.kind, matchType: 'title' });
        continue;
      }

      if (entry.kind !== 'markdown') continue;
      await readNoteOnce();

      const tags = extractTags(body);
      if (tags.some((tag) => tag.includes(needle))) {
        results.push({ relPath: entry.relPath, name: entry.name, kind: entry.kind, matchType: 'tag' });
        continue;
      }

      const bodyLower = body.toLowerCase();
      const contentIndex = bodyLower.indexOf(needle);
      if (contentIndex !== -1) {
        results.push({
          relPath: entry.relPath,
          name: entry.name,
          kind: entry.kind,
          matchType: 'content',
          snippet: buildSnippet(body, contentIndex, needle.length),
        });
      }
    }

    // Tâches et évènements n'ont pas de frontmatter — un filtre par
    // propriété les exclut entièrement (même règle que desktop).
    if (trimmedQuery && !propertyId) {
      results.push(...(await searchTasks(needle)));
      results.push(...(await searchCalendarEvents(needle)));
    }

    // Titre d'abord, puis mots-clés, puis contenu, puis propriété seule.
    const priority: Record<SearchResult['matchType'], number> = { title: 0, tag: 1, content: 2, property: 3 };
    results.sort((a, b) => priority[a.matchType] - priority[b.matchType]);
    return results;
  },
} satisfies SearchBridge;

// Hash SHA-256 du coffre actif (port de sync.ts) — crypto.subtle au lieu de
// node:crypto, même sortie hexadécimale.
export const webSyncAdapter = {
  hashVaultTree: async (): Promise<HashedNote[]> => {
    const root = await webVaultRegistry.getActiveHandle();
    if (!root) return [];
    const out: HashedNote[] = [];

    for (const relPath of await listNoteRelPaths(root, ['.mdx', '.md', '.canvas', '.chart', '.excalidraw'])) {
      const file = await (await getFileByRelPath(root, relPath)).getFile();
      const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
      out.push({
        relPath,
        contentHash: [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join(''),
        sizeBytes: file.size,
        modifiedAt: file.lastModified,
      });
    }
    return out;
  },
} satisfies SyncBridge;
