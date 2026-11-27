// ✒️ 123ECRITURE — lib/search/queryMatch.ts — évaluation d'une requête sur un fichier
//////////////////////////////////////////////////////////////////////////////
//
// Applique l'arbre produit par queryParser.ts à un document (chemin, nom,
// contenu, propriétés, mots-clés). Comparaison « repliée » (vaultSearch.ts) :
// accents et apostrophes ignorés, casse ignorée sauf si `caseSensitive`.
//
//////////////////////////////////////////////////////////////////////////////

import type { QueryField, QueryNode } from './queryParser';
import {
  buildSnippet,
  extractTags,
  locateAllNeedles,
  locateNeedle,
  type FoldOptions,
} from './vaultSearch';

export type SearchDoc = {
  relPath: string;
  name: string;
  fileName: string;
  kind: SearchResultKind;
  body?: string;
  // Décalage du corps dans le fichier brut (après le frontmatter), pour
  // ouvrir l'éditeur au bon endroit.
  bodyOffset?: number;
  properties?: Record<string, unknown>;
};

export type MatchHit = {
  matchType: SearchMatchType;
  matchCount: number;
  snippet?: string;
  offset?: number;
  needles: string[];
};

type Range = { index: number; length: number; where: SearchMatchType };
type Eval = { ok: boolean; ranges: Range[] };

const TYPE_RANK: Record<SearchMatchType, number> = { title: 0, tag: 1, content: 2, property: 3 };

function bestType(ranges: Range[]): SearchMatchType {
  let best: SearchMatchType = 'content';
  let rank = 99;
  for (const r of ranges) {
    if (TYPE_RANK[r.where] < rank) {
      rank = TYPE_RANK[r.where];
      best = r.where;
    }
  }
  return best;
}

function merge(a: Eval, b: Eval): Eval {
  return { ok: a.ok && b.ok, ranges: [...a.ranges, ...b.ranges] };
}

function yes(ranges: Range[]): Eval {
  return { ok: true, ranges };
}

function no(): Eval {
  return { ok: false, ranges: [] };
}

function findIn(text: string, needle: string, options: FoldOptions, where: SearchMatchType, from = 0): Range[] {
  const hits = locateAllNeedles(text, needle, options);
  return hits.map((h) => ({ index: h.index + from, length: h.length, where }));
}

function propertyEntries(properties: Record<string, unknown> | undefined): { key: string; value: string }[] {
  if (!properties) return [];
  const out: { key: string; value: string }[] = [];
  for (const [key, raw] of Object.entries(properties)) {
    if (raw === undefined || raw === null || raw === '') continue;
    if (Array.isArray(raw)) {
      for (const item of raw) out.push({ key, value: String(item) });
    } else {
      out.push({ key, value: String(raw) });
    }
  }
  return out;
}

function tagsOf(doc: SearchDoc): string[] {
  return extractTags(doc.body ?? '');
}

type Ctx = {
  doc: SearchDoc;
  options: FoldOptions;
  // Fenêtre (ligne ou section) : les termes « contenu » ne regardent qu'elle.
  window?: { text: string; start: number };
};

function termTargets(ctx: Ctx, field: QueryField): { text: string; where: SearchMatchType; start: number }[] {
  const { doc, window } = ctx;
  if (window) {
    if (field === 'path' || field === 'file') return [];
    return [{ text: window.text, where: field === 'tag' ? 'tag' : 'content', start: window.start }];
  }
  switch (field) {
    case 'path':
      return [{ text: doc.relPath, where: 'title', start: 0 }];
    case 'file':
      return [
        { text: doc.fileName, where: 'title', start: 0 },
        { text: doc.name, where: 'title', start: 0 },
      ];
    case 'tag':
      return [{ text: tagsOf(doc).map((t) => `#${t}`).join(' '), where: 'tag', start: 0 }];
    case 'line':
    case 'section':
    case 'content':
      return [
        { text: doc.name, where: 'title', start: 0 },
        { text: doc.fileName, where: 'title', start: 0 },
        { text: doc.relPath, where: 'title', start: 0 },
        { text: tagsOf(doc).map((t) => `#${t}`).join(' '), where: 'tag', start: 0 },
        ...(doc.body !== undefined ? [{ text: doc.body, where: 'content' as const, start: 0 }] : []),
      ];
  }
}

function evalTerm(ctx: Ctx, value: string, field: QueryField): Eval {
  if (!value) return no();
  // line:/section: sans groupe = le mot doit apparaître dans une ligne / section.
  if ((field === 'line' || field === 'section') && !ctx.window) {
    return evalGroup(ctx, field, { type: 'term', value, phrase: false, field: 'content' });
  }
  if (field === 'tag') {
    const needle = value.startsWith('#') ? value.slice(1) : value;
    const tags = tagsOf(ctx.doc);
    const hit = tags.some((t) => locateNeedle(t, needle, ctx.options));
    return hit ? yes([{ index: 0, length: needle.length, where: 'tag' }]) : no();
  }
  const ranges: Range[] = [];
  for (const target of termTargets(ctx, field)) {
    const found = findIn(target.text, value, ctx.options, target.where, target.start);
    ranges.push(...found);
  }
  return ranges.length > 0 ? yes(ranges) : no();
}

function lineWindows(body: string): { text: string; start: number }[] {
  const out: { text: string; start: number }[] = [];
  let start = 0;
  const parts = body.split('\n');
  for (const line of parts) {
    out.push({ text: line, start });
    start += line.length + 1;
  }
  return out;
}

function sectionWindows(body: string): { text: string; start: number }[] {
  const lines = lineWindows(body);
  const headings: { index: number; level: number; start: number }[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const m = /^(#{1,6})[ \t]+/.exec(lines[i].text);
    if (m) headings.push({ index: i, level: m[1].length, start: lines[i].start });
  }
  const windows: { text: string; start: number }[] = [];
  const slice = (fromLine: number, toLine: number) => {
    const start = lines[fromLine]?.start ?? 0;
    const end = toLine < lines.length ? lines[toLine].start - 1 : body.length;
    const from = start;
    const to = Math.max(from, end);
    windows.push({ text: body.slice(from, to), start: from });
  };
  if (headings.length === 0) {
    windows.push({ text: body, start: 0 });
    return windows;
  }
  if (headings[0].index > 0) slice(0, headings[0].index);
  for (let i = 0; i < headings.length; i += 1) {
    const h = headings[i];
    // Jusqu'au prochain titre de niveau inférieur ou égal.
    let end = lines.length;
    for (let j = i + 1; j < headings.length; j += 1) {
      if (headings[j].level <= h.level) {
        end = headings[j].index;
        break;
      }
    }
    slice(h.index, end);
    // Fenêtre serrée : jusqu'au prochain titre, quel que soit le niveau.
    const tightEnd = i + 1 < headings.length ? headings[i + 1].index : lines.length;
    if (tightEnd !== end) slice(h.index, tightEnd);
  }
  return windows;
}

function evalGroup(ctx: Ctx, field: 'line' | 'section', child: QueryNode): Eval {
  const body = ctx.doc.body;
  if (body === undefined) return no();
  const windows = field === 'line' ? lineWindows(body) : sectionWindows(body);
  let best: Eval | null = null;
  for (const window of windows) {
    const ev = evalNode({ ...ctx, window }, child);
    if (ev.ok) {
      // Les indices renvoyés par les termes dans la fenêtre sont déjà
      // décalés (termTargets utilise window.start).
      if (!best || ev.ranges.length > best.ranges.length) best = ev;
    }
  }
  return best ?? no();
}

function evalProperty(ctx: Ctx, name: string, value: string | null): Eval {
  const entries = propertyEntries(ctx.doc.properties);
  const keyHit = entries.filter((e) => locateNeedle(e.key, name, ctx.options));
  if (keyHit.length === 0) return no();
  if (value === null) return yes([{ index: 0, length: name.length, where: 'property' }]);
  for (const e of keyHit) {
    if (locateNeedle(e.value, value, ctx.options)) {
      return yes([{ index: 0, length: value.length, where: 'property' }]);
    }
  }
  return no();
}

function evalNode(ctx: Ctx, node: QueryNode): Eval {
  switch (node.type) {
    case 'and': {
      const evs = node.children.map((c) => evalNode(ctx, c));
      if (evs.some((e) => !e.ok)) return no();
      return evs.reduce((a, b) => merge(a, b));
    }
    case 'or': {
      const ok = node.children.map((c) => evalNode(ctx, c)).filter((e) => e.ok);
      if (ok.length === 0) return no();
      return ok.reduce((a, b) => ({ ok: true, ranges: [...a.ranges, ...b.ranges] }));
    }
    case 'not': {
      const child = evalNode(ctx, node.child);
      return child.ok ? no() : yes([]);
    }
    case 'term':
      return evalTerm(ctx, node.value, node.field);
    case 'group':
      return evalGroup(ctx, node.field, node.child);
    case 'property':
      return evalProperty(ctx, node.name, node.value);
  }
}

export function matchDocument(
  doc: SearchDoc,
  ast: QueryNode,
  options?: FoldOptions,
): MatchHit | null {
  const ev = evalNode({ doc, options: options ?? {} }, ast);
  if (!ev.ok) return null;
  const contentRanges = ev.ranges.filter((r) => r.where === 'content').sort((a, b) => a.index - b.index);
  const matchType = ev.ranges.length > 0 ? bestType(ev.ranges) : 'title';
  const matchCount = contentRanges.length > 0 ? contentRanges.length : ev.ranges.length > 0 ? ev.ranges.length : 1;
  const first = contentRanges[0];
  const body = doc.body ?? '';
  return {
    matchType,
    matchCount,
    snippet: first ? buildSnippet(body, first.index, first.length) : undefined,
    offset: first ? (doc.bodyOffset ?? 0) + first.index : undefined,
    needles: [],
  };
}

export function hitFromMatch(hit: MatchHit, needles: string[]): MatchHit {
  return { ...hit, needles };
}
