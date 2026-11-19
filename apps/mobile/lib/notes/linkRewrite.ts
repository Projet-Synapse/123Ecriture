// ✒️ 123ECRITURE — lib/notes/linkRewrite.ts — liens internes mis à jour au renommage
//////////////////////////////////////////////////////////////////////////////
//
// Quand un fichier (ou un dossier) est renommé ou déplacé, les liens qui le
// visaient sont réécrits dans tout le coffre, comme Obsidian :
//   [[Ancien]]  [[Ancien|alias]]  [[Ancien#Titre]]  [[dossier/Ancien]]
//   ![[Ancien]]  [texte](Ancien.md)  ![](dossier/image.png)
// et les cartes « fichier » des .canvas (`"file": "dossier/Ancien.md"`).
//
// Fonctions PURES (tests : linkRewrite.test.ts) ; l'écran (NotesScreen)
// lit les fichiers, appelle ces fonctions et réécrit SEULEMENT ce qui a
// changé — jamais de suppression, jamais de création.
//
// Invariants du fichier :
//   • Un lien n'est réécrit QUE s'il visait (avant le renommage) un fichier
//     renommé, avec la MÊME résolution que le clic (wikilinkResolution.ts) ;
//     alias, ancre, `!` d'intégration et `\|` des tableaux sont conservés.
//   • Style conservé : nom seul → nouveau nom seul (chemin si le nom seul
//     devient ambigu) ; chemin → même nombre de segments (chemin complet si
//     ambigu) ; relatif (`./`, `../`) → relatif depuis l'emplacement de la
//     note. Extension écrite dans le lien → nouvelle extension écrite.
//   • Accents comparés en NFC (deux graphies Unicode = même fichier) ;
//     casse ignorée, comme la résolution.
//   • Blocs de code (``` / ~~~) et code en ligne : jamais modifiés.
//   • Dossier renommé : les liens par chemin vers des fichiers absents de
//     l'arbre (images, PDF…) suivent aussi, par préfixe de chemin.
//
// SOMMAIRE :
//   1. Renommages et chemins
//   2. Zones de code à ignorer
//   3. Réécriture d'une note — rewriteNoteLinks
//   4. Réécriture d'un canvas — rewriteCanvasLinks
//
//////////////////////////////////////////////////////////////////////////////

import { createWikilinkResolver, type LinkableNote } from './wikilinkResolution';

//////// 1. Renommages et chemins ///////////////////////////////////////////

export type LinkRenameContext = {
  // Tous les fichiers connus AVANT le renommage (chemins relatifs au coffre).
  filesBefore: string[];
  // Élément renommé : fichier ou dossier (ancien → nouveau chemin).
  from: string;
  to: string;
  isFolder: boolean;
};

export type LinkRewriteResult = { content: string; count: number };

const nfcLower = (path: string) => path.normalize('NFC').replace(/\\/g, '/').toLowerCase();

function parentOf(relPath: string): string {
  const slash = relPath.lastIndexOf('/');
  return slash === -1 ? '' : relPath.slice(0, slash);
}

function baseName(relPath: string): string {
  return relPath.slice(relPath.lastIndexOf('/') + 1);
}

function extOf(path: string): string {
  const name = baseName(path);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot) : '';
}

function stripExt(path: string): string {
  const ext = extOf(path);
  return ext ? path.slice(0, path.length - ext.length) : path;
}

const isNoteExt = (ext: string) => ['.md', '.mdx'].includes(ext.toLowerCase());

function normalizeSegments(path: string): string | null {
  const out: string[] = [];
  for (const segment of path.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (out.length === 0) return null;
      out.pop();
      continue;
    }
    out.push(segment);
  }
  return out.join('/');
}

// Nouveau chemin d'un fichier après le renommage, ou null s'il n'a pas bougé.
export function renamedPath(relPath: string, ctx: Pick<LinkRenameContext, 'from' | 'to' | 'isFolder'>): string | null {
  const key = nfcLower(relPath);
  const from = nfcLower(ctx.from);
  if (key === from) return ctx.to;
  if (ctx.isFolder && key.startsWith(`${from}/`)) return `${ctx.to}${relPath.slice(ctx.from.length)}`;
  return null;
}

// Chemin de `target` relatif au dossier `fromFolder` (sans `./`).
export function relativePath(fromFolder: string, target: string): string {
  const a = fromFolder ? fromFolder.split('/') : [];
  const b = target.split('/');
  let common = 0;
  while (common < a.length && common < b.length - 1 && nfcLower(a[common]) === nfcLower(b[common])) common += 1;
  return [...a.slice(common).map(() => '..'), ...b.slice(common)].join('/');
}

function toLinkable(paths: string[]): LinkableNote[] {
  return paths.map((relPath) => ({ relPath: relPath.normalize('NFC'), name: stripExt(baseName(relPath)).normalize('NFC') }));
}

//////// 2. Zones de code à ignorer //////////////////////////////////////////

// Intervalles [début, fin[ des blocs ``` / ~~~ et du code en ligne.
export function codeRanges(text: string): [number, number][] {
  const ranges: [number, number][] = [];
  let fence: { marker: string; start: number } | null = null;
  let offset = 0;
  const lines = text.split('\n');
  const inlineCandidates: [number, number][] = [];
  for (const line of lines) {
    const lineEnd = offset + line.length;
    const match = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (match && match[1][0] === fence.marker[0] && match[1].length >= fence.marker.length) {
        ranges.push([fence.start, lineEnd]);
        fence = null;
      }
    } else if (match) {
      fence = { marker: match[1], start: offset };
    } else {
      inlineCandidates.push([offset, lineEnd]);
    }
    offset = lineEnd + 1;
  }
  if (fence) ranges.push([fence.start, text.length]);
  // Code en ligne : séquence de N backticks fermée par la même longueur.
  for (const [start, end] of inlineCandidates) {
    let i = start;
    while (i < end) {
      if (text[i] !== '`') {
        i += 1;
        continue;
      }
      let n = 0;
      while (text[i + n] === '`') n += 1;
      const ticks = '`'.repeat(n);
      let j = i + n;
      let close = -1;
      while (j < end) {
        const k = text.indexOf(ticks, j);
        if (k === -1 || k >= end) break;
        let m = 0;
        while (text[k + m] === '`') m += 1;
        if (m === n) {
          close = k;
          break;
        }
        j = k + m;
      }
      if (close === -1) {
        i += n;
        continue;
      }
      ranges.push([i, close + n]);
      i = close + n;
    }
  }
  return ranges;
}

const inRanges = (ranges: [number, number][], index: number) => ranges.some(([s, e]) => index >= s && index < e);

//////// 3. Réécriture d'une note — rewriteNoteLinks ///////////////////////

type Target = { oldPath: string; newPath: string; inTree: boolean };

export function rewriteNoteLinks(
  content: string,
  sourceBefore: string,
  ctx: LinkRenameContext,
): LinkRewriteResult {
  const sourceAfter = renamedPath(sourceBefore, ctx) ?? sourceBefore;
  const sourceMoved = nfcLower(parentOf(sourceAfter)) !== nfcLower(parentOf(sourceBefore));
  const filesAfter = ctx.filesBefore.map((p) => renamedPath(p, ctx) ?? p);
  const before = createWikilinkResolver(toLinkable(ctx.filesBefore), sourceBefore.normalize('NFC'));
  const after = createWikilinkResolver(toLinkable(filesAfter), sourceAfter.normalize('NFC'));
  const fileByKey = new Map(ctx.filesBefore.map((p) => [nfcLower(p), p]));
  const resolvesTo = (raw: string, newPath: string) => {
    const hit = after.resolve(raw);
    return hit !== null && hit !== 'self' && nfcLower(hit.relPath) === nfcLower(newPath);
  };

  // Cible d'un chemin écrit (lien markdown, ou wikilink par chemin hors
  // arbre) : relatif au dossier de la note, puis depuis la racine.
  const targetOfPath = (path: string, allowRoot: boolean): Target | null => {
    const candidates: string[] = [];
    const rel = normalizeSegments(parentOf(sourceBefore) ? `${parentOf(sourceBefore)}/${path}` : path);
    if (rel !== null) candidates.push(rel);
    if (allowRoot) {
      const root = normalizeSegments(path);
      if (root !== null) candidates.push(root);
    }
    for (const candidate of candidates) {
      const known = fileByKey.get(nfcLower(candidate));
      const real = known ?? candidate;
      const moved = renamedPath(real, ctx);
      if (known || moved) return { oldPath: real, newPath: moved ?? real, inTree: Boolean(known) };
    }
    return null;
  };

  const ranges = codeRanges(content);
  let count = 0;

  // --- Wikilinks [[…]] / ![[…]]
  let out = content.replace(/(!?)\[\[([^\[\]\n]+?)\]\]/g, (whole: string, bang: string, inner: string, index: number) => {
    if (inRanges(ranges, index)) return whole;
    // Séparateur d'alias : `|`, ou `\|` dans un tableau.
    const pipe = inner.indexOf('|');
    let targetPart = pipe === -1 ? inner : inner.slice(0, pipe);
    let rest = pipe === -1 ? '' : inner.slice(pipe);
    if (targetPart.endsWith('\\')) {
      targetPart = targetPart.slice(0, -1);
      rest = `\\${rest}`;
    }
    const hash = targetPart.indexOf('#');
    const rawPath = hash === -1 ? targetPart : targetPart.slice(0, hash);
    const anchor = hash === -1 ? '' : targetPart.slice(hash);
    const path = rawPath.trim().replace(/\\/g, '/');
    if (!path) return whole;
    const style = path.startsWith('./') || path.startsWith('../') ? 'relative' : path.includes('/') ? 'path' : 'name';

    let target: Target | null = null;
    const hit = before.resolve(path.normalize('NFC'));
    if (hit && hit !== 'self') {
      const real = fileByKey.get(nfcLower(hit.relPath)) ?? hit.relPath;
      const moved = renamedPath(real, ctx);
      target = { oldPath: real, newPath: moved ?? real, inTree: true };
    } else if (style !== 'name') {
      target = targetOfPath(path, style === 'path');
    }
    if (!target) return whole;
    const targetMoved = nfcLower(target.newPath) !== nfcLower(target.oldPath);
    if (!targetMoved && !(sourceMoved && style === 'relative')) return whole;

    const writtenExt = extOf(path);
    const keepExt = writtenExt !== '' && (nfcLower(writtenExt) === nfcLower(extOf(target.oldPath)) || isNoteExt(writtenExt));
    const display = (p: string) => (keepExt || !isNoteExt(extOf(p)) ? p : stripExt(p));
    let next: string;
    if (style === 'relative') {
      const relative = relativePath(parentOf(sourceAfter), target.newPath);
      next = display(relative.startsWith('..') ? relative : `./${relative}`);
    } else if (style === 'name') {
      next = display(baseName(target.newPath));
      if (!resolvesTo(next, target.newPath)) next = display(target.newPath);
    } else {
      const segments = path.split('/').filter(Boolean).length;
      const parts = target.newPath.split('/');
      next = display(parts.slice(Math.max(0, parts.length - segments)).join('/'));
      if (target.inTree && !resolvesTo(next, target.newPath)) next = display(target.newPath);
      if (!target.inTree) next = display(target.newPath);
    }
    // Dernier recours : chemin complet AVEC extension (jamais ambigu).
    if (target.inTree && !resolvesTo(next, target.newPath)) next = target.newPath;
    if (next === path) return whole;
    count += 1;
    const leading = rawPath.slice(0, rawPath.length - rawPath.trimStart().length);
    return `${bang}[[${leading}${next}${anchor}${rest}]]`;
  });

  // --- Liens markdown [texte](cible) / ![alt](cible)
  const mdRanges = codeRanges(out);
  out = out.replace(
    /(!?\[[^\]\n]*\]\()(<[^>\n]+>|[^)\s]+)((?:\s+"[^"\n]*")?\))/g,
    (whole: string, head: string, url: string, tail: string, index: number) => {
      if (inRanges(mdRanges, index)) return whole;
      const angled = url.startsWith('<');
      const rawUrl = angled ? url.slice(1, -1) : url;
      if (/^[a-z][a-z0-9+.-]*:/i.test(rawUrl) || rawUrl.startsWith('#') || rawUrl.startsWith('/')) return whole;
      const hash = rawUrl.indexOf('#');
      const pathPart = hash === -1 ? rawUrl : rawUrl.slice(0, hash);
      const anchor = hash === -1 ? '' : rawUrl.slice(hash);
      let decoded = pathPart;
      try {
        decoded = decodeURIComponent(pathPart);
      } catch {
        // `%` littéral : gardé tel quel
      }
      if (!decoded) return whole;
      const explicitRelative = decoded.startsWith('./') || decoded.startsWith('../');
      const target = targetOfPath(decoded, !explicitRelative);
      if (!target) return whole;
      const targetMoved = nfcLower(target.newPath) !== nfcLower(target.oldPath);
      // Était-il écrit relativement au dossier de la note ?
      const relCandidate = normalizeSegments(parentOf(sourceBefore) ? `${parentOf(sourceBefore)}/${decoded}` : decoded);
      const wasRelative = relCandidate !== null && nfcLower(relCandidate) === nfcLower(target.oldPath);
      if (!targetMoved && !(sourceMoved && wasRelative)) return whole;
      let nextPath = wasRelative ? relativePath(parentOf(sourceAfter), target.newPath) : target.newPath;
      if (decoded.startsWith('./') && !nextPath.startsWith('..')) nextPath = `./${nextPath}`;
      if (!extOf(decoded) && isNoteExt(extOf(nextPath))) nextPath = stripExt(nextPath);
      let encoded: string;
      if (angled) encoded = nextPath;
      else if (pathPart !== decoded) {
         
        encoded = /[^\x00-\x7f]/.test(pathPart) ? nextPath.replace(/ /g, '%20') : encodeURI(nextPath);
      } else encoded = nextPath.replace(/ /g, '%20');
      const nextUrl = angled ? `<${encoded}${anchor}>` : `${encoded}${anchor}`;
      if (nextUrl === url) return whole;
      count += 1;
      return `${head}${nextUrl}${tail}`;
    },
  );

  return { content: out, count };
}

//////// 4. Réécriture d'un canvas — rewriteCanvasLinks ///////////////////

export function rewriteCanvasLinks(content: string, ctx: LinkRenameContext): LinkRewriteResult {
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch {
    return { content, count: 0 }; // canvas illisible : jamais réécrit
  }
  const nodes = (data as { nodes?: unknown })?.nodes;
  if (!Array.isArray(nodes)) return { content, count: 0 };
  let count = 0;
  for (const node of nodes as Record<string, unknown>[]) {
    if (node && node.type === 'file' && typeof node.file === 'string') {
      const moved = renamedPath(node.file, ctx);
      if (moved && moved !== node.file) {
        node.file = moved;
        count += 1;
      }
    }
  }
  if (count === 0) return { content, count: 0 };
  const indent = /\n\t/.test(content) ? '\t' : /\n {2}/.test(content) ? 2 : undefined;
  return { content: JSON.stringify(data, null, indent) + (content.endsWith('\n') ? '\n' : ''), count };
}

// Le fichier peut-il contenir des liens à réécrire ?
export function linkRewriteKind(relPath: string): 'note' | 'canvas' | null {
  const ext = extOf(relPath).toLowerCase();
  if (ext === '.md' || ext === '.mdx') return 'note';
  if (ext === '.canvas') return 'canvas';
  return null;
}
