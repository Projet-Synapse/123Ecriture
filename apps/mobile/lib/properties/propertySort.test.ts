import { describe, expect, it } from 'vitest';

import { isPropertySortMode, nextPropertySortMode, sortPropertyDefinitions } from './propertySort';

const defs: { name: string; type: PropertyType }[] = [
  { name: 'statut', type: 'options' },
  { name: 'Auteur', type: 'text' },
  { name: 'échéance', type: 'date' },
  { name: 'tags', type: 'list' },
  { name: 'résumé', type: 'text' },
];

const names = (list: { name: string }[]) => list.map((d) => d.name);

describe('sortPropertyDefinitions', () => {
  it('A → Z, insensible à la casse et aux accents', () => {
    expect(names(sortPropertyDefinitions(defs, 'alpha-asc'))).toEqual(['Auteur', 'échéance', 'résumé', 'statut', 'tags']);
  });
  it('Z → A', () => {
    expect(names(sortPropertyDefinitions(defs, 'alpha-desc'))).toEqual(['tags', 'statut', 'résumé', 'échéance', 'Auteur']);
  });
  it('par type (ordre des types), puis alphabétique', () => {
    expect(names(sortPropertyDefinitions(defs, 'type'))).toEqual(['Auteur', 'résumé', 'tags', 'échéance', 'statut']);
  });
  it('par usage décroissant, égalités en A → Z', () => {
    expect(names(sortPropertyDefinitions(defs, 'usage', { tags: 12, statut: 3, résumé: 3 }))).toEqual([
      'tags',
      'résumé',
      'statut',
      'Auteur',
      'échéance',
    ]);
  });
  it('mode inconnu → A → Z, sans modifier l’entrée', () => {
    const copy = [...defs];
    expect(names(sortPropertyDefinitions(defs, 'nimporte' as PropertySortMode))[0]).toBe('Auteur');
    expect(defs).toEqual(copy);
  });
});

describe('modes', () => {
  it('cycle et validation', () => {
    expect(nextPropertySortMode('alpha-asc')).toBe('alpha-desc');
    expect(nextPropertySortMode('usage')).toBe('alpha-asc');
    expect(isPropertySortMode('type')).toBe(true);
    expect(isPropertySortMode('x')).toBe(false);
  });
});
