// ✒️ 123ECRITURE — lib/properties/propertySort.ts — tri de la liste des propriétés
//////////////////////////////////////////////////////////////////////////////
//
// Paramètres › Gestion des propriétés : bouton de tri à côté de
// « Revérifier le coffre ». Modes (persistés dans les préférences,
// `propertiesSortMode`) :
//   • 'alpha-asc'  — A → Z (insensible à la casse et aux accents) ;
//   • 'alpha-desc' — Z → A ;
//   • 'type'       — groupé par type (ordre TYPE_ORDER), puis A → Z ;
//   • 'usage'      — nombre de notes décroissant, puis A → Z.
// Fonctions PURES, testées (propertySort.test.ts).
//
//////////////////////////////////////////////////////////////////////////////

import { TYPE_ORDER } from './propertyTypes';

export const PROPERTY_SORT_MODES: PropertySortMode[] = ['alpha-asc', 'alpha-desc', 'type', 'usage'];

export const PROPERTY_SORT_LABELS: Record<PropertySortMode, string> = {
  'alpha-asc': 'A → Z',
  'alpha-desc': 'Z → A',
  type: 'Par type',
  usage: 'Par usage',
};

export function isPropertySortMode(value: unknown): value is PropertySortMode {
  return typeof value === 'string' && (PROPERTY_SORT_MODES as string[]).includes(value);
}

// Mode suivant au clic sur le bouton (cycle).
export function nextPropertySortMode(mode: PropertySortMode): PropertySortMode {
  const index = PROPERTY_SORT_MODES.indexOf(mode);
  return PROPERTY_SORT_MODES[(index + 1) % PROPERTY_SORT_MODES.length] ?? 'alpha-asc';
}

const collator = new Intl.Collator('fr', { sensitivity: 'base', numeric: true });

const byName = (a: { name: string }, b: { name: string }) => collator.compare(a.name, b.name) || a.name.localeCompare(b.name);

// Renvoie une NOUVELLE liste triée (l'entrée n'est pas modifiée). Un mode
// inconnu (préférence corrompue) retombe sur A → Z.
export function sortPropertyDefinitions<T extends { name: string; type: PropertyType }>(
  definitions: readonly T[],
  mode: PropertySortMode | undefined,
  usage: Readonly<Record<string, number>> = {},
): T[] {
  const list = [...definitions];
  switch (isPropertySortMode(mode) ? mode : 'alpha-asc') {
    case 'alpha-asc':
      return list.sort(byName);
    case 'alpha-desc':
      return list.sort((a, b) => byName(b, a));
    case 'type': {
      const rank = (type: PropertyType) => {
        const index = TYPE_ORDER.indexOf(type);
        return index < 0 ? TYPE_ORDER.length : index;
      };
      return list.sort((a, b) => rank(a.type) - rank(b.type) || byName(a, b));
    }
    case 'usage':
      return list.sort((a, b) => (usage[b.name] ?? 0) - (usage[a.name] ?? 0) || byName(a, b));
  }
}
