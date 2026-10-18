// Logique pure du module Canvas (cartes + connexions) — séparée du rendu
// pour rester testable, comme lib/sync/diff.ts.
//
// Champs alignés sur JSON Canvas (spec ouverte publiée par Obsidian,
// https://jsoncanvas.org) : `type: 'text' | 'file'`, `file` (pas `relPath`)
// pour une carte-note, arêtes en `fromNode`/`toNode` (+ `fromSide`/`toSide`,
// fixés à une valeur par défaut en v0 — pas encore de choix du côté
// d'ancrage). Choisi puisque l'utilisatrice a explicitement nommé
// l'extension `.canvas` et que le reste de l'app suit "façon Obsidian" —
// autant s'aligner sur le vrai format plutôt qu'inventer le nôtre.

export const DEFAULT_NODE_WIDTH = 220;
export const DEFAULT_NODE_HEIGHT = 120;

// Le "monde" du canvas est grand mais BORNÉ (pas un plan littéralement
// infini — simplification assumée pour le v0, voir le plan) : les nouvelles
// cartes apparaissent près du centre de cet espace, le panoramique déplace
// juste la fenêtre visible dessus.
export const WORLD_SIZE = 4000;
export const WORLD_CENTER = WORLD_SIZE / 2;

export function createTextNode(id: string, x: number, y: number): CanvasNode {
  return { id, type: 'text', x, y, width: DEFAULT_NODE_WIDTH, height: DEFAULT_NODE_HEIGHT, text: '' };
}

export function createFileNode(id: string, x: number, y: number, file: string, title: string): CanvasNode {
  return { id, type: 'file', x, y, width: DEFAULT_NODE_WIDTH, height: DEFAULT_NODE_HEIGHT, file, title };
}

// Supprime un nœud ET toute arête qui le référence — jamais d'arête
// "pendante" vers un nœud qui n'existe plus.
export function removeNodeCascade(data: CanvasData, nodeId: string): CanvasData {
  return {
    nodes: data.nodes.filter((n) => n.id !== nodeId),
    edges: data.edges.filter((e) => e.fromNode !== nodeId && e.toNode !== nodeId),
  };
}

export function removeEdge(data: CanvasData, edgeId: string): CanvasData {
  return { ...data, edges: data.edges.filter((e) => e.id !== edgeId) };
}

// Ajoute une arête entre deux nœuds distincts, sauf si une arête existe déjà
// entre cette paire (dans un sens ou l'autre) — une connexion "double" entre
// les deux mêmes cartes n'apporte rien.
export function addEdgeIfNew(data: CanvasData, edgeId: string, fromNode: string, toNode: string): CanvasData {
  if (fromNode === toNode) return data;
  const alreadyConnected = data.edges.some(
    (e) => (e.fromNode === fromNode && e.toNode === toNode) || (e.fromNode === toNode && e.toNode === fromNode),
  );
  if (alreadyConnected) return data;
  return {
    ...data,
    edges: [...data.edges, { id: edgeId, fromNode, fromSide: 'right', toNode, toSide: 'left' }],
  };
}
