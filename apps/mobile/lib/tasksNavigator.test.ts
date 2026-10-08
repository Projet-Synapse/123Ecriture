import { describe, expect, it } from 'vitest';

import { orderAfterDrop, pendingTaskCount, sortNavigatorItems } from './tasksNavigator';
import { makeTaskList } from './tasksNavigator.test-helpers';
describe('sortNavigatorItems', () => {
  it('trie par order croissant, les items sans ordre en fin puis par nom', () => {
    const items = [
      makeTaskList('c', { name: 'Zéro' }),
      makeTaskList('a', { order: 1, name: 'Première' }),
      makeTaskList('b', { order: 0, name: 'Avant' }),
      makeTaskList('d', { name: 'Alpha' }),
    ];
    expect(sortNavigatorItems(items).map((item) => item.id)).toEqual(['b', 'a', 'd', 'c']);
  });

  it('ne mute pas la liste reçue', () => {
    const items = [makeTaskList('b', { order: 1 }), makeTaskList('a', { order: 0 })];
    sortNavigatorItems(items);
    expect(items.map((item) => item.id)).toEqual(['b', 'a']);
  });
});

describe('orderAfterDrop', () => {
  const scope = [
    makeTaskList('a', { order: 0 }),
    makeTaskList('b', { order: 1 }),
    makeTaskList('c', { order: 2 }),
  ];

  it('insère l’item déplacé AVANT l’item cible et renumérote 0..n', () => {
    const entries = orderAfterDrop(scope, 'c', 'a');
    expect(entries).toEqual([
      { id: 'c', order: 0 },
      { id: 'a', order: 1 },
      { id: 'b', order: 2 },
    ]);
  });

  it('déplace à la fin quand beforeId est null', () => {
    const entries = orderAfterDrop(scope, 'a', null);
    expect(entries.map((entry) => entry.id)).toEqual(['b', 'c', 'a']);
  });

  it('déplace vers le bas sans doublon', () => {
    const entries = orderAfterDrop(scope, 'a', 'c');
    expect(entries.map((entry) => entry.id)).toEqual(['b', 'a', 'c']);
  });

  it('retourne vide si l’item déplacé n’appartient pas au scope', () => {
    expect(orderAfterDrop(scope, 'inconnu', 'a')).toEqual([]);
  });
});

describe('pendingTaskCount', () => {
  it('compte les tâches non cochées', () => {
    expect(pendingTaskCount([{ done: false }, { done: true }, { done: false }])).toBe(2);
  });
});
