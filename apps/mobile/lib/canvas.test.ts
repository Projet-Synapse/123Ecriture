import { describe, expect, it } from 'vitest';

import { addEdgeIfNew, createTextNode, removeEdge, removeNodeCascade } from './canvas';

function makeData(): CanvasData {
  return {
    nodes: [createTextNode('a', 0, 0), createTextNode('b', 100, 100), createTextNode('c', 200, 200)],
    edges: [
      { id: 'e1', from: 'a', to: 'b' },
      { id: 'e2', from: 'b', to: 'c' },
    ],
  };
}

describe('removeNodeCascade', () => {
  it('retire le nœud et toute arête qui le référence', () => {
    const result = removeNodeCascade(makeData(), 'b');
    expect(result.nodes.map((n) => n.id)).toEqual(['a', 'c']);
    expect(result.edges).toEqual([]);
  });

  it('ne touche pas les arêtes sans lien avec le nœud retiré', () => {
    const data: CanvasData = {
      nodes: [createTextNode('a', 0, 0), createTextNode('b', 0, 0), createTextNode('c', 0, 0)],
      edges: [{ id: 'e1', from: 'a', to: 'b' }],
    };
    const result = removeNodeCascade(data, 'c');
    expect(result.edges).toEqual([{ id: 'e1', from: 'a', to: 'b' }]);
  });
});

describe('removeEdge', () => {
  it('retire seulement l’arête ciblée', () => {
    const result = removeEdge(makeData(), 'e1');
    expect(result.edges).toEqual([{ id: 'e2', from: 'b', to: 'c' }]);
  });
});

describe('addEdgeIfNew', () => {
  it('ajoute une arête entre deux nœuds distincts', () => {
    const data = makeData();
    const result = addEdgeIfNew(data, 'e3', 'a', 'c');
    expect(result.edges).toHaveLength(3);
    expect(result.edges[2]).toEqual({ id: 'e3', from: 'a', to: 'c' });
  });

  it('refuse une arête vers soi-même', () => {
    const result = addEdgeIfNew(makeData(), 'e3', 'a', 'a');
    expect(result.edges).toHaveLength(2);
  });

  it('ne duplique pas une connexion déjà existante, dans un sens ou l’autre', () => {
    const data = makeData();
    expect(addEdgeIfNew(data, 'e3', 'a', 'b').edges).toHaveLength(2);
    expect(addEdgeIfNew(data, 'e3', 'b', 'a').edges).toHaveLength(2);
  });
});
