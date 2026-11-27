// ✒️ 123ECRITURE — lib/search/vaultSearch.ts — recherche globale à partir de l'arborescence (Android)
//////////////////////////////////////////////////////////////////////////////
//
// Recherche globale pour les plateformes SANS backend de recherche dédié
// (Android : coffre SAF, coffre local vault-fs, coffre cloud). Avant
// v0.4.100, Android n'installait AUCUN pont `window.search` : la boîte de
// recherche répondait « Aucun résultat » à tout. Ce module n'utilise que
// ce que tous les coffres savent faire — `listTree()` et `readNote()` —
// et reproduit les règles du desktop (apps/desktop/electron/search.ts) :
// titre, puis #mot-clé, puis contenu, plus tâches et évènements.
//
// Invariants du fichier :
//   • Comparaison « repliée » (foldForSearch) : casse ignorée, accents
//     ignorés (é = e), NFC/NFD indifférents (noms SAF souvent en NFD),
//     emoji conservés tels quels — « worldbuilding », « ⚙️ base »,
//     « guide d'expertise » trouvent « 👋🌍 Guide d'expertise en
//     worldbuilding.mdx ». Les extraits et surlignages restent sur le
//     texte ORIGINAL (table de correspondance des positions).
//   • Le nom cherché inclut l'extension (« fichier.mdx » trouve le fichier).
//   • Dossiers et fichiers cachés (segment « . ») ignorés.
//   • Ni texte ni filtre → aucun résultat (pas de « tout lister »).
//   • Contenu lu en paresse, une fois, et MIS EN CACHE par (chemin, date
//     de modification) : la frappe suivante ne relit pas le coffre SAF.
//
//////////////////////////////////////////////////////////////////////////////

import { parseFrontmatter } from '../properties/frontmatter';

//////// 1. Repli de texte (casse, accents, Unicode) //////////////////////////

// Texte replié + position ORIGINALE (indice UTF-16) de chaque caractère
// replié, plus une sentinelle finale = longueur du texte.
export function foldWithMap(text: string): { folded: string; map: number[] } {
  let folded = '';
  const map: number[] = [];
  let i = 0;
  for (const ch of text) {
    const f = ch
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      // Apostrophes typographiques ≡ apostrophe droite.
      .replace(/[\u2018\u2019\u02bc]/g, "'");
    for (let k = 0; k < f.length; k += 1) map.push(i);
    folded += f;
    i += ch.length;
  }
  map.push(i);
  return { folded, map };
}

export function foldForSearch(text: string): string {
  return foldWithMap(text).folded;
}

// Première occurrence de `needle` (DÉJÀ replié) dans `text` → position et
// longueur dans le texte ORIGINAL, ou null.
export function findFolded(text: string, foldedNeedle: string): { index: number; length: number } | null {
  if (!foldedNeedle) return null;
  const { folded, map } = foldWithMap(text);
  const at = folded.indexOf(foldedNeedle);
  if (at === -1) return null;
  const start = map[at];
  const endFolded = at + foldedNeedle.length;
  // Fin = début du caractère suivant (ou fin du texte).
  let end = map[endFolded] ?? text.length;
  if (end <= start) end = map.slice(endFolded).find((p) => p > start) ?? text.length;
  return { index: start, length: end - start };
}

// Toutes les occurrences (pour le surlignage).
export function findAllFolded(text: string, foldedNeedle: string): { index: number; length: number }[] {
  if (!foldedNeedle) return [];
  const { folded, map } = foldWithMap(text);
  const out: { index: number; length: number }[] = [];
  let from = 0;
  for (;;) {
    const at = folded.indexOf(foldedNeedle, from);
    if (at === -1) break;
    const start = map[at];
    const end = map[at + foldedNeedle.length] ?? text.length;
    if (end > start && (out.length === 0 || start >= out[out.length - 1].index + out[out.length - 1].length)) {
      out.push({ index: start, length: end - start });
    }
    from = at + Math.max(1, foldedNeedle.length);
  }
  return out;
}

//////// 2. Recherche ////////////////////////////////////////////////////////

const SNIPPET_RADIUS = 60;
const TAG_PATTERN = /(^|[\s])#([\p{L}\p{N}_-]+)/gu;
const MONTHS_SHORT_FR = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

function buildSnippet(text: string, index: number, length: number): string {
  const start = Math.max(0, index - SNIPPET_RADIUS);
  const end = Math.min(text.length, index + length + SNIPPET_RADIUS);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${end < text.length ? '…' : ''}`;
}

function formatDueDateFr(dueDate: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return null;
  const [year, month, day] = dueDate.split('-').map(Number);
  const label = MONTHS_SHORT_FR[month - 1];
  return label ? `${day} ${label} ${year}` : null;
}

type FlatEntry = { relPath: string; name: string; fileName: string; kind: SearchResultKind; modifiedAt?: number };

export function flattenTree(nodes: readonly VaultTreeNode[], out: FlatEntry[] = []): FlatEntry[] {
  for (const node of nodes) {
    const fileName = node.relPath.split('/').pop() ?? node.name;
    if (fileName.startsWith('.') || node.name.startsWith('.')) continue;
    if (node.type === 'folder') {
      out.push({ relPath: node.relPath, name: node.name, fileName, kind: 'folder' });
      flattenTree(node.children ?? [], out);
    } else {
      out.push({ relPath: node.relPath, name: node.name, fileName, kind: node.kind, modifiedAt: node.modifiedAt });
    }
  }
  return out;
}

export type VaultSearchSource = {
  listTree: () => Promise<VaultTreeNode[]>;
  readNote: (relPath: string) => Promise<string>;
  listTasks?: () => Promise<Task[]>;
  listEvents?: () => Promise<CalendarEvent[]>;
};

// Cache de contenu (chemin + date de modification) — partagé entre frappes.
const contentCache = new Map<string, { modifiedAt: number | undefined; text: string }>();
const CONTENT_CACHE_MAX = 3000;

export function clearVaultSearchCache(): void {
  contentCache.clear();
}

async function readCached(source: VaultSearchSource, entry: FlatEntry): Promise<string | null> {
  const hit = contentCache.get(entry.relPath);
  if (hit && entry.modifiedAt !== undefined && hit.modifiedAt === entry.modifiedAt) return hit.text;
  try {
    const text = await source.readNote(entry.relPath);
    if (contentCache.size >= CONTENT_CACHE_MAX) contentCache.clear();
    contentCache.set(entry.relPath, { modifiedAt: entry.modifiedAt, text });
    return text;
  } catch {
    // Fichier illisible entre le listage et la lecture : ignoré.
    return null;
  }
}

// Lecture en parallèle limitée (SAF : un appel natif par fichier).
async function mapPool<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next;
      next += 1;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export async function searchVault(
  source: VaultSearchSource,
  query: string,
  options?: { propertyId?: string; propertyValue?: string },
): Promise<SearchResult[]> {
  const trimmed = (query ?? '').trim();
  const propertyId = options?.propertyId;
  if (!trimmed && !propertyId) return [];
  const needle = foldForSearch(trimmed);
  const entries = flattenTree(await source.listTree());
  const results: SearchResult[] = [];
  const toRead: FlatEntry[] = [];

  for (const entry of entries) {
    if (propertyId) {
      if (entry.kind === 'markdown') toRead.push(entry);
      continue;
    }
    if (findFolded(entry.name, needle) || findFolded(entry.fileName, needle)) {
      results.push({ relPath: entry.relPath, name: entry.name, kind: entry.kind, matchType: 'title' });
    } else if (entry.kind === 'markdown') {
      toRead.push(entry);
    }
  }

  const contents = await mapPool(toRead, 6, (entry) => readCached(source, entry));
  toRead.forEach((entry, i) => {
    const raw = contents[i];
    if (raw === null) return;
    let data: Record<string, unknown> = {};
    let body = raw;
    try {
      ({ data, body } = parseFrontmatter(raw));
    } catch {
      // Frontmatter invalide : tout le texte compte comme corps.
    }
    if (propertyId) {
      const value = data[propertyId];
      if (value === undefined || value === null || value === '') return;
      if (options?.propertyValue && !findFolded(String(value), foldForSearch(options.propertyValue))) return;
      if (!trimmed) {
        results.push({ relPath: entry.relPath, name: entry.name, kind: entry.kind, matchType: 'property' });
        return;
      }
      if (findFolded(entry.name, needle) || findFolded(entry.fileName, needle)) {
        results.push({ relPath: entry.relPath, name: entry.name, kind: entry.kind, matchType: 'title' });
        return;
      }
    }
    for (const m of body.matchAll(TAG_PATTERN)) {
      if (foldForSearch(m[2]).includes(needle)) {
        results.push({ relPath: entry.relPath, name: entry.name, kind: entry.kind, matchType: 'tag' });
        return;
      }
    }
    const hit = findFolded(body, needle);
    if (hit) {
      results.push({
        relPath: entry.relPath,
        name: entry.name,
        kind: entry.kind,
        matchType: 'content',
        snippet: buildSnippet(body, hit.index, hit.length),
      });
    }
  });

  if (trimmed && !propertyId) {
    const tasks = source.listTasks ? await source.listTasks().catch(() => [] as Task[]) : [];
    for (const task of tasks) {
      const base = { relPath: '', name: task.text, kind: 'task' as const, taskId: task.id, taskListId: task.listId };
      if (findFolded(task.text, needle)) {
        results.push({ ...base, matchType: 'title' });
        continue;
      }
      const description = task.description ?? '';
      const d = findFolded(description, needle);
      if (d) {
        results.push({ ...base, matchType: 'content', snippet: buildSnippet(description, d.index, d.length) });
        continue;
      }
      const due = typeof task.dueDate === 'string' ? task.dueDate : null;
      const dueLabel = due ? formatDueDateFr(due) : null;
      if (due && dueLabel && (due.includes(trimmed) || findFolded(dueLabel, needle))) {
        results.push({ ...base, matchType: 'content', snippet: `Échéance : ${dueLabel}` });
      }
    }
    const events = source.listEvents ? await source.listEvents().catch(() => [] as CalendarEvent[]) : [];
    for (const event of events) {
      const base = { relPath: '', name: event.title, kind: 'calendar-event' as const, eventId: event.id, eventDate: event.date };
      if (findFolded(event.title, needle)) {
        results.push({ ...base, matchType: 'title' });
        continue;
      }
      const notes = event.notes ?? '';
      const n = findFolded(notes, needle);
      if (n) results.push({ ...base, matchType: 'content', snippet: buildSnippet(notes, n.index, n.length) });
    }
  }

  const priority: Record<SearchMatchType, number> = { title: 0, tag: 1, content: 2, property: 3 };
  // Tri STABLE : l'ordre de l'arborescence est conservé à priorité égale.
  return results
    .map((r, i) => ({ r, i }))
    .sort((a, b) => priority[a.r.matchType] - priority[b.r.matchType] || a.i - b.i)
    .map(({ r }) => r);
}
