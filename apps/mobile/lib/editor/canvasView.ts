// ✒️ 123ECRITURE — lib/editor/canvasView.ts — lecture et cadrage d'un canvas JSON Canvas (Obsidian)
//////////////////////////////////////////////////////////////////////////////
//
// Bug 2026-11-16 : « Hiérarchie des Eleven.canvas » s'ouvrait sur une zone
// VIDE. Cause : l'éditeur plaçait la vue sur le centre d'un « monde » fixe
// de 4000 px (coordonnées 1600…2400), alors qu'Obsidian place les nœuds
// autour de (0, 0), souvent en coordonnées NÉGATIVES. Tous les nœuds
// tombaient hors de la fenêtre, et ceux en négatif hors du monde lui-même.
// S'ajoutaient : nœuds 'group'/'link' inconnus, nœuds 'file' sans `title`
// (titre vide), couleurs '1'…'6' ignorées, liens toujours tracés de centre
// à centre, BOM UTF-8 qui faisait échouer JSON.parse (repli sur « vide »).
//
// Ce module (PUR, testé) : lecture tolérante, boîte englobante, cadrage
// automatique, zoom autour d'un point, ancrage des liens par côté,
// couleurs JSON Canvas, ordre de dessin (groupes derrière).
//
//////////////////////////////////////////////////////////////////////////////

export const DEFAULT_W = 250;
export const DEFAULT_H = 60;
export const MIN_SCALE = 0.1;
export const MAX_SCALE = 2;

// Préréglages JSON Canvas (mêmes teintes qu'Obsidian).
export const CANVAS_PRESET_COLORS: Record<string, string> = {
  '1': '#fb464c',
  '2': '#e9973f',
  '3': '#e0de71',
  '4': '#44cf6e',
  '5': '#53dfdd',
  '6': '#a882ff',
};

export function canvasColor(color: unknown): string | null {
  if (typeof color !== 'string') return null;
  const c = color.trim();
  if (CANVAS_PRESET_COLORS[c]) return CANVAS_PRESET_COLORS[c];
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c)) return c;
  return null;
}

const SIDES = new Set(['top', 'right', 'bottom', 'left']);
const TYPES = new Set(['text', 'file', 'link', 'group']);

function num(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

// Lecture TOLÉRANTE : BOM retiré, nœuds sans id/position réparés ou
// écartés, champs inconnus CONSERVÉS (réécrits tels quels à la sauvegarde),
// arêtes vers un nœud absent écartées de l'affichage.
export function parseCanvas(content: string): CanvasData {
  const raw = content.replace(/^\uFEFF/, '').trim();
  if (!raw) return { nodes: [], edges: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { nodes: [], edges: [] };
  }
  const obj = (parsed && typeof parsed === 'object' ? parsed : {}) as { nodes?: unknown; edges?: unknown };
  const nodes: CanvasNode[] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(obj.nodes) ? obj.nodes : []) {
    if (!item || typeof item !== 'object') continue;
    const n = item as Record<string, unknown>;
    const id = typeof n.id === 'string' && n.id ? n.id : `n${nodes.length}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const type = (TYPES.has(n.type as string) ? n.type : 'text') as CanvasNodeType;
    nodes.push({
      ...(n as object),
      id,
      type,
      x: num(n.x, 0),
      y: num(n.y, 0),
      width: Math.max(1, num(n.width, DEFAULT_W)),
      height: Math.max(1, num(n.height, DEFAULT_H)),
    } as CanvasNode);
  }
  const edges: CanvasEdge[] = [];
  for (const item of Array.isArray(obj.edges) ? obj.edges : []) {
    if (!item || typeof item !== 'object') continue;
    const e = item as Record<string, unknown>;
    if (typeof e.fromNode !== 'string' || typeof e.toNode !== 'string') continue;
    edges.push({
      ...(e as object),
      id: typeof e.id === 'string' && e.id ? e.id : `e${edges.length}`,
      fromNode: e.fromNode,
      toNode: e.toNode,
      fromSide: SIDES.has(e.fromSide as string) ? (e.fromSide as CanvasEdgeSide) : undefined,
      toSide: SIDES.has(e.toSide as string) ? (e.toSide as CanvasEdgeSide) : undefined,
    } as CanvasEdge);
  }
  return { nodes, edges };
}

export type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

export function canvasBounds(nodes: CanvasNode[]): Bounds | null {
  if (nodes.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + n.width);
    maxY = Math.max(maxY, n.y + n.height);
  }
  return { minX, minY, maxX, maxY };
}

// Vue : écran = monde × scale + (x, y).
export type CanvasViewport = { x: number; y: number; scale: number };

export function clampScale(scale: number): number {
  if (!Number.isFinite(scale) || scale <= 0) return 1;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

// Cadrage sur le contenu : tout visible, centré, jamais agrandi au-delà de
// 100 % (un petit canvas reste à l'échelle 1).
export function fitViewport(bounds: Bounds | null, viewW: number, viewH: number, padding = 40): CanvasViewport {
  if (!bounds || viewW <= 0 || viewH <= 0) return { x: viewW > 0 ? viewW / 2 : 0, y: viewH > 0 ? viewH / 2 : 0, scale: 1 };
  const w = Math.max(1, bounds.maxX - bounds.minX);
  const h = Math.max(1, bounds.maxY - bounds.minY);
  const scale = clampScale(Math.min(1, (viewW - 2 * padding) / w, (viewH - 2 * padding) / h));
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  return { scale, x: viewW / 2 - cx * scale, y: viewH / 2 - cy * scale };
}

export function screenToWorld(v: CanvasViewport, sx: number, sy: number): { x: number; y: number } {
  return { x: (sx - v.x) / v.scale, y: (sy - v.y) / v.scale };
}

// Zoom autour d'un point de l'écran (le point sous le curseur ne bouge pas).
export function zoomAt(v: CanvasViewport, factor: number, sx: number, sy: number): CanvasViewport {
  const scale = clampScale(v.scale * factor);
  const world = screenToWorld(v, sx, sy);
  return { scale, x: sx - world.x * scale, y: sy - world.y * scale };
}

type Point = { x: number; y: number };

export function sideAnchor(n: CanvasNode, side: CanvasEdgeSide): Point {
  switch (side) {
    case 'top':
      return { x: n.x + n.width / 2, y: n.y };
    case 'bottom':
      return { x: n.x + n.width / 2, y: n.y + n.height };
    case 'left':
      return { x: n.x, y: n.y + n.height / 2 };
    case 'right':
      return { x: n.x + n.width, y: n.y + n.height / 2 };
  }
}

// Côtés absents (fichier minimal, autre outil) : ceux qui se font face.
export function inferSides(from: CanvasNode, to: CanvasNode): { fromSide: CanvasEdgeSide; toSide: CanvasEdgeSide } {
  const dx = to.x + to.width / 2 - (from.x + from.width / 2);
  const dy = to.y + to.height / 2 - (from.y + from.height / 2);
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? { fromSide: 'right', toSide: 'left' } : { fromSide: 'left', toSide: 'right' };
  return dy >= 0 ? { fromSide: 'bottom', toSide: 'top' } : { fromSide: 'top', toSide: 'bottom' };
}

const NORMALS: Record<CanvasEdgeSide, Point> = {
  top: { x: 0, y: -1 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

export type EdgeGeometry = {
  id: string;
  d: string;
  start: Point;
  end: Point;
  // Pointes de flèche (polygones) et milieu (étiquette).
  arrows: string[];
  mid: Point;
  color: string | null;
  label?: string;
};

function arrowHead(tip: Point, side: CanvasEdgeSide, size = 10): string {
  // La flèche ARRIVE sur le côté : elle pointe vers l'intérieur du nœud.
  const n = NORMALS[side];
  const back = { x: tip.x + n.x * size, y: tip.y + n.y * size };
  const px = -n.y * (size * 0.55);
  const py = n.x * (size * 0.55);
  return `${tip.x},${tip.y} ${back.x + px},${back.y + py} ${back.x - px},${back.y - py}`;
}

// Courbe de Bézier ancrée sur les côtés, comme Obsidian.
export function edgeGeometry(edge: CanvasEdge, byId: Map<string, CanvasNode>): EdgeGeometry | null {
  const from = byId.get(edge.fromNode);
  const to = byId.get(edge.toNode);
  if (!from || !to || from === to) return null;
  const inferred = inferSides(from, to);
  const fromSide = edge.fromSide ?? inferred.fromSide;
  const toSide = edge.toSide ?? inferred.toSide;
  const start = sideAnchor(from, fromSide);
  const end = sideAnchor(to, toSide);
  const dist = Math.hypot(end.x - start.x, end.y - start.y);
  const k = Math.max(40, Math.min(200, dist / 2));
  const c1 = { x: start.x + NORMALS[fromSide].x * k, y: start.y + NORMALS[fromSide].y * k };
  const c2 = { x: end.x + NORMALS[toSide].x * k, y: end.y + NORMALS[toSide].y * k };
  const r = (v: number) => Math.round(v * 10) / 10;
  const arrows: string[] = [];
  if ((edge.toEnd ?? 'arrow') === 'arrow') arrows.push(arrowHead(end, toSide));
  if (edge.fromEnd === 'arrow') arrows.push(arrowHead(start, fromSide));
  // Milieu de la cubique (t = 0,5).
  const mid = { x: (start.x + 3 * c1.x + 3 * c2.x + end.x) / 8, y: (start.y + 3 * c1.y + 3 * c2.y + end.y) / 8 };
  return {
    id: edge.id,
    d: `M ${r(start.x)} ${r(start.y)} C ${r(c1.x)} ${r(c1.y)}, ${r(c2.x)} ${r(c2.y)}, ${r(end.x)} ${r(end.y)}`,
    start,
    end,
    arrows,
    mid,
    color: canvasColor(edge.color),
    label: typeof edge.label === 'string' && edge.label ? edge.label : undefined,
  };
}

// Groupes derrière (les plus grands d'abord), puis le reste dans l'ordre
// du fichier — comme Obsidian.
export function paintOrder(nodes: CanvasNode[]): CanvasNode[] {
  const groups = nodes.filter((n) => n.type === 'group').sort((a, b) => b.width * b.height - a.width * a.height);
  return [...groups, ...nodes.filter((n) => n.type !== 'group')];
}

// Titre d'un nœud 'file' : `title` mis en cache par 123Écriture, sinon
// le nom du fichier sans extension .md (Obsidian n'écrit pas de titre).
export function fileNodeLabel(node: Pick<CanvasNode, 'file' | 'title' | 'subpath'>): string {
  if (node.title) return node.title;
  const file = node.file ?? '';
  const base = file.split('/').pop() ?? file;
  const name = base.replace(/\.md$/i, '');
  return node.subpath ? `${name} › ${node.subpath.replace(/^#/, '')}` : name || 'Fichier';
}
