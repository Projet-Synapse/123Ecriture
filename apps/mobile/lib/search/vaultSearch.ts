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
import { matchDocument, type SearchDoc } from './queryMatch';
import { parseSearchQuery, queryNeedles, queryNeedsContent, type QueryNode } from './queryParser';

//////// 1. Repli de texte (casse, accents, Unicode) //////////////////////////

export type FoldOptions = { caseSensitive?: boolean };

// Texte replié + position ORIGINALE (indice UTF-16) de chaque caractère
// replié, plus une sentinelle finale = longueur du texte.
// Accents et apostrophes sont toujours normalisés ; la casse n'est
// conservée que si `caseSensitive` est vrai (bouton Aa).
export function foldWithMap(text: string, options?: FoldOptions): { folded: string; map: number[] } {
  let folded = '';
  const map: number[] = [];
  let i = 0;
  const keepCase = Boolean(options?.caseSensitive);
  for (const ch of text) {
    let f = ch
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      // Apostrophes typographiques ≡ apostrophe droite.
      .replace(/[\u2018\u2019\u02bc]/g, "'");
    if (!keepCase) f = f.toLowerCase();
    for (let k = 0; k < f.length; k += 1) map.push(i);
    folded += f;
    i += ch.length;
  }
  map.push(i);
  return { folded, map };
}

export function foldForSearch(text: string, options?: FoldOptions): string {
  return foldWithMap(text, options).folded;
}

// Première occurrence de `needle` (DÉJÀ replié) dans `text` → position et
// longueur dans le texte ORIGINAL, ou null.
export function findFolded(
  text: string,
  foldedNeedle: string,
  options?: FoldOptions,
): { index: number; length: number } | null {
  if (!foldedNeedle) return null;
  const { folded, map } = foldWithMap(text, options);
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
export function findAllFolded(
  text: string,
  foldedNeedle: string,
  options?: FoldOptions,
): { index: number; length: number }[] {
  if (!foldedNeedle) return [];
  const { folded, map } = foldWithMap(text, options);
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

// Cherche `needle` brut : le replie avec les mêmes options que le texte.
export function locateNeedle(
  text: string,
  needle: string,
  options?: FoldOptions,
): { index: number; length: number } | null {
  return findFolded(text, foldForSearch(needle, options), options);
}

export function locateAllNeedles(
  text: string,
  needle: string,
  options?: FoldOptions,
): { index: number; length: number }[] {
  return findAllFolded(text, foldForSearch(needle, options), options);
}

//////// 2. Recherche ////////////////////////////////////////////////////////

const SNIPPET_RADIUS = 60;
export const TAG_PATTERN = /(^|[\s])#([\p{L}\p{N}_-]+)/gu;

export function extractTags(text: string): string[] {
  const tags = new Set<string>();
  for (const match of text.matchAll(TAG_PATTERN)) tags.add(match[2]);
  return [...tags];
}

const MONTHS_SHORT_FR = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

export function buildSnippet(text: string, index: number, length: number): string {
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

function withPropertyFilter(ast: QueryNode | null, options?: SearchOptions): QueryNode | null {
  if (!options?.propertyId) return ast;
  const filter: QueryNode = {
    type: 'property',
    name: options.propertyId,
    value: options.propertyValue?.trim() ? options.propertyValue : null,
  };
  return ast ? { type: 'and', children: [filter, ast] } : filter;
}

function toSearchResult(
  base: Pick<SearchResult, 'relPath' | 'name' | 'kind'> & Partial<SearchResult>,
  hit: { matchType: SearchMatchType; matchCount: number; snippet?: string; offset?: number },
  needles: string[],
): SearchResult {
  return {
    ...base,
    matchType: hit.matchType,
    snippet: hit.snippet,
    matchCount: hit.matchCount,
    offset: hit.offset,
    needles,
  };
}

function docFromEntry(entry: FlatEntry, body?: string, properties?: Record<string, unknown>, bodyOffset?: number): SearchDoc {
  return {
    relPath: entry.relPath,
    name: entry.name,
    fileName: entry.fileName,
    kind: entry.kind,
    body,
    bodyOffset,
    properties,
  };
}

export async function searchVault(
  source: VaultSearchSource,
  query: string,
  options?: SearchOptions,
): Promise<SearchResult[]> {
  const trimmed = (query ?? '').trim();
  const parsed = parseSearchQuery(trimmed);
  const ast = withPropertyFilter(parsed.ast, options);
  if (!ast) return [];
  const fold = { caseSensitive: Boolean(options?.caseSensitive) };
  const needles = queryNeedles(ast);
  const needsContent = queryNeedsContent(ast);
  const entries = flattenTree(await source.listTree());
  const results: SearchResult[] = [];
  const toRead: FlatEntry[] = [];

  for (const entry of entries) {
    const pending = needsContent && entry.kind === 'markdown';
    if (pending) {
      toRead.push(entry);
      continue;
    }
    const hit = matchDocument(docFromEntry(entry), ast, fold);
    if (hit) results.push(toSearchResult(entry, hit, needles));
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
    const bodyOffset = raw.endsWith(body) ? raw.length - body.length : 0;
    const hit = matchDocument(docFromEntry(entry, body, data, bodyOffset), ast, fold);
    if (hit) results.push(toSearchResult(entry, hit, needles));
  });

  // Tâches et évènements : évalués par le même parseur (un [propriété]
  // les écarte tout seuls, ils n'ont pas de frontmatter).
  const tasks = source.listTasks ? await source.listTasks().catch(() => [] as Task[]) : [];
  for (const task of tasks) {
    const due = typeof task.dueDate === 'string' ? task.dueDate : null;
    const dueLabel = due ? formatDueDateFr(due) : null;
    const extra = [task.description ?? '', due ?? '', dueLabel ? `Échéance : ${dueLabel}` : ''].filter(Boolean).join('\n');
    const hit = matchDocument(
      { relPath: '', name: task.text, fileName: task.text, kind: 'task', body: extra || undefined },
      ast,
      fold,
    );
    if (hit) {
      results.push(
        toSearchResult(
          { relPath: '', name: task.text, kind: 'task', taskId: task.id, taskListId: task.listId },
          hit,
          needles,
        ),
      );
    }
  }
  const events = source.listEvents ? await source.listEvents().catch(() => [] as CalendarEvent[]) : [];
  for (const event of events) {
    const notes = event.notes ?? '';
    const hit = matchDocument(
      { relPath: '', name: event.title, fileName: event.title, kind: 'calendar-event', body: notes || undefined },
      ast,
      fold,
    );
    if (hit) {
      results.push(
        toSearchResult(
          { relPath: '', name: event.title, kind: 'calendar-event', eventId: event.id, eventDate: event.date },
          hit,
          needles,
        ),
      );
    }
  }

  const priority: Record<SearchMatchType, number> = { title: 0, tag: 1, content: 2, property: 3 };
  // Tri STABLE : l'ordre de l'arborescence est conservé à priorité égale.
  return results
    .map((r, i) => ({ r, i }))
    .sort((a, b) => priority[a.r.matchType] - priority[b.r.matchType] || a.i - b.i)
    .map(({ r }) => r);
}
