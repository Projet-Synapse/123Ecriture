// ✒️ 123ECRITURE — lib/editor/canvas.ts — logique du module Canvas (cartes + connexions)
//////////////////////////////////////////////////////////////////////////////
//
// Logique PURE du module Canvas (cartes + connexions) — séparée du rendu
// pour rester testable, comme lib/sync/diff.ts.
//
// Invariants du fichier :
//   • Champs alignés sur JSON Canvas (spec ouverte publiée par Obsidian,
//     https://jsoncanvas.org) : `type: 'text' | 'file'`, `file` (pas
//     `relPath`) pour une carte-note, arêtes en `fromNode`/`toNode` avec
//     `fromSide`/`toSide` fixés à une valeur par défaut (pas encore de
//     choix du côté d'ancrage).
//   • Le "monde" du canvas est grand mais BORNÉ : les nouvelles cartes
//     apparaissent près du centre de cet espace, le panoramique ne
//     déplace que la fenêtre visible dessus.
//   • Jamais d'arête "pendante" : supprimer un nœud supprime toute arête
//     qui le référence, et une paire de nœuds reste connectée au plus une
//     fois, dans un sens comme dans l'autre.
//
//////////////////////////////////////////////////////////////////////////////

//////// 1. Constantes du monde ///////////////////////////////////////////////

export const DEFAULT_NODE_WIDTH = 220;
export const DEFAULT_NODE_HEIGHT = 120;

// Le "monde" du canvas est grand mais BORNÉ : les nouvelles cartes
// apparaissent près du centre de cet espace, le panoramique ne déplace
// que la fenêtre visible dessus.
export const WORLD_SIZE = 4000;
export const WORLD_CENTER = WORLD_SIZE / 2;

//////// 2. Création des nœuds ////////////////////////////////////////////////

export function createTextNode(id: string, x: number, y: number): CanvasNode {
  return { id, type: 'text', x, y, width: DEFAULT_NODE_WIDTH, height: DEFAULT_NODE_HEIGHT, text: '' };
}

export function createFileNode(id: string, x: number, y: number, file: string, title: string): CanvasNode {
  return { id, type: 'file', x, y, width: DEFAULT_NODE_WIDTH, height: DEFAULT_NODE_HEIGHT, file, title };
}

//////// 3. Suppression en cascade et arêtes ///////////////////////////////////

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
