import { describe, expect, it } from 'vitest';

import {
  absorbFrontmatterValues,
  flattenPropertyValue,
  lastListSegment,
  matchRank,
  normalizeForSearch,
  openWikilinkQuery,
  suggestPropertyValues,
  type PropertyValueIndex,
} from './propertyValueSuggestions';

function indexOf(notes: Record<string, unknown>[]): PropertyValueIndex {
  const index: PropertyValueIndex = new Map();
  for (const data of notes) absorbFrontmatterValues(index, data);
  return index;
}

describe('index des valeurs', () => {
  it('compte une fois par note, clés insensibles à la casse, ignore dates système et booléens', () => {
    const index = indexOf([
      { Statut: 'En cours', tags: ['roman', 'roman', 'été'], created: '2026-01-01', fini: true },
      { statut: 'En cours', tags: ['roman'] },
      { statut: 'Terminé', note: 4 },
    ]);
    expect(index.get('statut')?.get('En cours')).toBe(2);
    expect(index.get('tags')?.get('roman')).toBe(2);
    expect(index.get('note')?.get('4')).toBe(1);
    expect(index.has('created')).toBe(false);
    expect(index.has('fini')).toBe(false);
  });

  it('flattenPropertyValue', () => {
    expect(flattenPropertyValue([' a ', '', 3, null, { x: 1 }])).toEqual(['a', '3']);
  });
});

describe('recherche', () => {
  it('normalise accents et majuscules', () => {
    expect(normalizeForSearch('  Été Ça ')).toBe('ete ca');
  });
  it('pertinence', () => {
    expect(matchRank('Élodie', 'elo')).toBe(0);
    expect(matchRank('Jean-Élodie', 'elo')).toBe(1);
    expect(matchRank('Mélodie', 'elo')).toBe(2);
    expect(matchRank('Paul', 'elo')).toBeNull();
  });
  it('lien interne ouvert', () => {
    expect(openWikilinkQuery('voir [[Chap')).toEqual({ start: 5, query: 'Chap' });
    expect(openWikilinkQuery('voir [[Chap]] ok')).toBeNull();
    expect(openWikilinkQuery('rien')).toBeNull();
  });
  it('dernier élément d’une liste', () => {
    expect(lastListSegment('a, b, ro')).toEqual({ prefix: 'a, b, ', query: 'ro' });
    expect(lastListSegment('ro')).toEqual({ prefix: '', query: 'ro' });
  });
});

describe('suggestPropertyValues', () => {
  const used = new Map([
    ['Roman', 5],
    ['Romance', 1],
    ['Nouvelle romanesque', 5],
    ['Été', 2],
  ]);

  it('fréquence puis pertinence puis alphabétique', () => {
    expect(suggestPropertyValues({ query: 'rom', used }).map((s) => s.value)).toEqual(['Roman', 'Nouvelle romanesque', 'Romance']);
  });

  it('insensible aux accents', () => {
    expect(suggestPropertyValues({ query: 'ete', used }).map((s) => s.value)).toEqual(['Été']);
  });

  it('options du schéma incluses (fréquence cumulée), exclusions et valeur exacte retirées', () => {
    const result = suggestPropertyValues({ query: '', used, schemaOptions: ['Brouillon', 'Roman'], exclude: ['Été'] });
    expect(result.map((s) => s.value)).toEqual(['Nouvelle romanesque', 'Roman', 'Romance', 'Brouillon']);
    expect(result.find((s) => s.value === 'Brouillon')?.source).toBe('option');
    expect(suggestPropertyValues({ query: 'Roman', used }).map((s) => s.value)).not.toContain('Roman');
  });

  it('noms de notes en [[…]] seulement sur demande', () => {
    const noteNames = ['Chapitre 1', 'Personnages'];
    expect(suggestPropertyValues({ query: 'chap', noteNames })).toEqual([]);
    expect(suggestPropertyValues({ query: 'chap', noteNames, includeNotes: true })).toEqual([
      { value: '[[Chapitre 1]]', label: 'Chapitre 1', source: 'note', count: 0 },
    ]);
  });

  it('limite', () => {
    const many = new Map(Array.from({ length: 20 }, (_, i) => [`v${i}`, 1] as [string, number]));
    expect(suggestPropertyValues({ query: '', used: many, limit: 5 })).toHaveLength(5);
  });
});
