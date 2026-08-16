// Logique pure du module Canvas (cartes + connexions) — séparée du rendu
// pour rester testable, comme lib/sync/diff.ts.

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

export function createNoteNode(id: string, x: number, y: number, relPath: string, title: string): CanvasNode {
  return { id, type: 'note', x, y, width: DEFAULT_NODE_WIDTH, height: DEFAULT_NODE_HEIGHT, relPath, title };
}

// Supprime un nœud ET toute arête qui le référence — jamais d'arête
// "pendante" vers un nœud qui n'existe plus.
export function removeNodeCascade(data: CanvasData, nodeId: string): CanvasData {
  return {
    nodes: data.nodes.filter((n) => n.id !== nodeId),
    edges: data.edges.filter((e) => e.from !== nodeId && e.to !== nodeId),
  };
}

export function removeEdge(data: CanvasData, edgeId: string): CanvasData {
  return { ...data, edges: data.edges.filter((e) => e.id !== edgeId) };
}

// Ajoute une arête entre deux nœuds distincts, sauf si une arête existe déjà
// entre cette paire (dans un sens ou l'autre) — une connexion "double" entre
// les deux mêmes cartes n'apporte rien.
export function addEdgeIfNew(data: CanvasData, edgeId: string, fromId: string, toId: string): CanvasData {
  if (fromId === toId) return data;
  const alreadyConnected = data.edges.some(
    (e) => (e.from === fromId && e.to === toId) || (e.from === toId && e.to === fromId),
  );
  if (alreadyConnected) return data;
  return { ...data, edges: [...data.edges, { id: edgeId, from: fromId, to: toId }] };
}
