// ✒️ 123ECRITURE — lib/graph/graphGroups.ts — « Groupes » de la vue graphique (couleurs par requête)
//////////////////////////////////////////////////////////////////////////////
//
// Comme Obsidian : une liste ordonnée de groupes `{ requête, couleur }`.
// Un nœud du graphe prend la couleur du PREMIER groupe dont la requête le
// reconnaît ; aucun groupe ne le reconnaît → couleur par défaut du graphe.
//
// Invariants du fichier :
//   • Module PUR (aucun import React/RN), testé dans graphGroups.test.ts.
//   • La requête est celle de la recherche (lib/search : path:, file:, tag:,
//     line:, section:, [propriété], ET / OR / "phrase" / -exclusion) — même
//     parseur, même moteur (matchDocument) : un groupe et la recherche ne
//     peuvent pas diverger.
//   • Performance : chaque requête est parsée UNE fois et évaluée UNE fois
//     par nœud (computeGroupMatches) ; changer la couleur d'un groupe ou
//     son rang ne ré-évalue rien (resolveGroupIndex ne fait que lire les
//     ensembles). Le CONTENU d'une note (corps, propriétés, tags) n'est
//     analysé que si une requête en a besoin (queryNeedsContent) et jamais
//     deux fois pour la même note (createGraphDocResolver).
//   • Une requête vide, incomplète (`path:`, `[`, guillemet ouvert) ou qui
//     fait lever le parseur ne reconnaît AUCUN nœud — jamais d'exception
//     pendant la frappe.
//
// SOMMAIRE :
//   1. Le modèle (type, normalisation, couleurs)
//   2. Compilation et évaluation des requêtes
//   3. Résolution : quel groupe pour quel nœud
//
//////////////////////////////////////////////////////////////////////////////

import { parseFrontmatter } from '../properties/frontmatter';
import { matchDocument, type SearchDoc } from '../search/queryMatch';
import { parseSearchQuery, queryNeedsContent, type QueryNode } from '../search/queryParser';

//////// 1. Le modèle (type, normalisation, couleurs) //////////////////////

export type GraphGroup = { id: string; query: string; color: string };

export const MAX_GRAPH_GROUPS = 30;

// Couleurs proposées aux nouveaux groupes (rouge, orange, vert… comme
// Obsidian) — le groupe n°k reçoit la couleur k du cycle.
export const GRAPH_GROUP_COLORS = ['#e5484d', '#f5a524', '#30a46c', '#3e8fd6', '#8e4ec6', '#12a594', '#e93d82', '#978365'];

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

export function isHexColor(value: string): boolean {
  return HEX.test(value.trim());
}

function newId(taken: Set<string>): string {
  let id = '';
  do {
    id = `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  } while (taken.has(id));
  return id;
}

// Lecture tolérante des préférences (fichier édité à la main, version
// ancienne, synchro) : entrées invalides écartées, identifiants uniques,
// couleur invalide remplacée par celle du cycle, plafond MAX_GRAPH_GROUPS.
export function normalizeGraphGroups(raw: unknown): GraphGroup[] {
  if (!Array.isArray(raw)) return [];
  const out: GraphGroup[] = [];
  const ids = new Set<string>();
  for (const item of raw) {
    if (out.length >= MAX_GRAPH_GROUPS) break;
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const query = typeof rec.query === 'string' ? rec.query : '';
    const colorRaw = typeof rec.color === 'string' ? rec.color.trim() : '';
    const color = isHexColor(colorRaw) ? colorRaw : GRAPH_GROUP_COLORS[out.length % GRAPH_GROUP_COLORS.length];
    let id = typeof rec.id === 'string' && rec.id ? rec.id : '';
    if (!id || ids.has(id)) id = newId(ids);
    ids.add(id);
    out.push({ id, query, color });
  }
  return out;
}

export function createGraphGroup(existing: readonly GraphGroup[]): GraphGroup {
  return {
    id: newId(new Set(existing.map((g) => g.id))),
    query: '',
    color: GRAPH_GROUP_COLORS[existing.length % GRAPH_GROUP_COLORS.length],
  };
}

// Déplace le groupe `index` de `delta` rangs (−1 = plus prioritaire).
export function moveGraphGroup(groups: readonly GraphGroup[], index: number, delta: number): GraphGroup[] {
  const to = index + delta;
  if (index < 0 || index >= groups.length || to < 0 || to >= groups.length || delta === 0) return [...groups];
  const next = [...groups];
  const [item] = next.splice(index, 1);
  next.splice(to, 0, item);
  return next;
}

//////// 2. Compilation et évaluation des requêtes /////////////////////////

export type CompiledGroupQuery = { ast: QueryNode; needsContent: boolean } | null;

export function compileGroupQuery(query: string): CompiledGroupQuery {
  const trimmed = (query ?? '').trim();
  if (!trimmed) return null;
  try {
    const ast = parseSearchQuery(trimmed).ast;
    if (!ast) return null;
    return { ast, needsContent: queryNeedsContent(ast) };
  } catch {
    return null;
  }
}

// Ce que le graphe sait d'un nœud sans lire le fichier.
export type GraphGroupEntry = { relPath: string; name: string; fileName: string; kind: SearchResultKind };

// Fabrique de documents de recherche pour les requêtes qui lisent le
// contenu : frontmatter analysé UNE fois par note (cache), corps sans
// frontmatter, décalage conservé. Note absente de `contents` (au-delà de la
// limite de lecture du graphe, illisible) : corps/propriétés indéfinis → un
// critère de contenu ne la reconnaît pas.
export function createGraphDocResolver(contents: Readonly<Record<string, string>>) {
  const cache = new Map<string, SearchDoc>();
  return (entry: GraphGroupEntry): SearchDoc => {
    const hit = cache.get(entry.relPath);
    if (hit) return hit;
    const raw = contents[entry.relPath];
    let body: string | undefined;
    let properties: Record<string, unknown> | undefined;
    let bodyOffset = 0;
    if (typeof raw === 'string') {
      body = raw;
      if (entry.kind === 'markdown') {
        try {
          const parsed = parseFrontmatter(raw);
          properties = parsed.data;
          body = parsed.body;
          bodyOffset = raw.endsWith(parsed.body) ? raw.length - parsed.body.length : 0;
        } catch {
          // Frontmatter invalide : tout le texte compte comme corps.
        }
      }
    }
    const doc: SearchDoc = {
      relPath: entry.relPath,
      name: entry.name,
      fileName: entry.fileName,
      kind: entry.kind,
      body,
      bodyOffset,
      properties,
    };
    cache.set(entry.relPath, doc);
    return doc;
  };
}

// Pour chaque requête (même ordre que `queries`), l'ensemble des chemins
// reconnus (null = requête vide/invalide). Évaluation unique par requête et
// par nœud ; les requêtes qui n'ont besoin que du chemin/nom ne touchent
// jamais au contenu.
export function computeGroupMatches(
  entries: readonly GraphGroupEntry[],
  queries: readonly string[],
  docOf: (entry: GraphGroupEntry) => SearchDoc,
): (Set<string> | null)[] {
  return queries.map((query) => {
    const compiled = compileGroupQuery(query);
    if (!compiled) return null;
    const matched = new Set<string>();
    for (const entry of entries) {
      const doc = compiled.needsContent
        ? docOf(entry)
        : { relPath: entry.relPath, name: entry.name, fileName: entry.fileName, kind: entry.kind };
      let ok = false;
      try {
        ok = matchDocument(doc, compiled.ast) !== null;
      } catch {
        ok = false;
      }
      if (ok) matched.add(entry.relPath);
    }
    return matched;
  });
}

//////// 3. Résolution : quel groupe pour quel nœud ////////////////////////

// Rang du PREMIER groupe qui reconnaît le nœud (−1 = aucun).
export function resolveGroupIndex(relPath: string, matches: readonly (Set<string> | null)[]): number {
  for (let i = 0; i < matches.length; i += 1) {
    if (matches[i]?.has(relPath)) return i;
  }
  return -1;
}

// Couleur de chaque nœud reconnu (les autres sont absents de la table) et
// effectif par groupe (nœuds dont CE groupe est le premier gagnant — sert
// à la légende).
export function resolveGroupColors(
  relPaths: readonly string[],
  groups: readonly GraphGroup[],
  matches: readonly (Set<string> | null)[],
): { colorByPath: Map<string, string>; counts: number[] } {
  const colorByPath = new Map<string, string>();
  const counts = groups.map(() => 0);
  for (const relPath of relPaths) {
    const index = resolveGroupIndex(relPath, matches);
    if (index < 0 || index >= groups.length) continue;
    colorByPath.set(relPath, groups[index].color);
    counts[index] += 1;
  }
  return { colorByPath, counts };
}
