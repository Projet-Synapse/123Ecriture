import { describe, expect, it } from 'vitest';

import {
  ensureTimestamps,
  parseFrontmatter,
  reorderFrontmatterData,
  serializeFrontmatter,
} from './frontmatter';
import { inferPropertyType } from './propertyTypes';

// Tests des helpers de la refonte « propriétés » : réordonnancement
// (glisser-déposer du bloc), matérialisation idempotente des dates système
// created/modified, et déduction de type pour l'auto-enregistrement.

describe('reorderFrontmatterData', () => {
  it('déplace une clé et préserve les valeurs', () => {
    const data = { title: 'Note', tags: ['A'], statut: 'ok' };
    const next = reorderFrontmatterData(data, ['statut', 'title', 'tags']);
    expect(Object.keys(next)).toEqual(['statut', 'title', 'tags']);
    expect(next).toEqual(data);
  });

  it('conserve les clés absentes de la liste (liste périmée) en fin', () => {
    const data = { a: 1, b: 2, c: 3 };
    const next = reorderFrontmatterData(data, ['c']);
    expect(Object.keys(next)).toEqual(['c', 'a', 'b']);
    expect(next).toEqual(data);
  });

  it('round-trip complet : l’ordre réordonné apparaît dans le YAML sérialisé puis re-parsé', () => {
    const content = serializeFrontmatter({ title: 'N', statut: 'ok', tags: ['A'] }, 'corps');
    const { data, body } = parseFrontmatter(content);
    const next = reorderFrontmatterData(data, ['statut', 'tags', 'title']);
    const reordered = serializeFrontmatter(next, body);
    expect(reordered.indexOf('statut:')).toBeLessThan(reordered.indexOf('tags:'));
    expect(reordered.indexOf('tags:')).toBeLessThan(reordered.indexOf('title:'));
    expect(parseFrontmatter(reordered).body).toBe('corps');
  });
});

describe('ensureTimestamps', () => {
  it('ajoute created (fallback) et modified (now) sur une note sans frontmatter', () => {
    const next = ensureTimestamps({}, 1000, 2000);
    expect(next.created).toBe(new Date(1000).toISOString());
    expect(next.modified).toBe(new Date(2000).toISOString());
  });

  it('ne réécrit JAMAIS une date de création déjà écrite, quelle que soit sa valeur', () => {
    const next = ensureTimestamps({ created: '12 août 2026' }, 1000, 2000);
    expect(next.created).toBe('12 août 2026');
    expect(next.modified).toBe(new Date(2000).toISOString());
  });

  it('actualise modified mais laisse created intact (idempotence des autres clés)', () => {
    const data = { title: 'N', created: '2026-08-12T10:00:00.000Z', modified: 'ancien' };
    const next = ensureTimestamps(data, 1000, 3000);
    expect(next.created).toBe('2026-08-12T10:00:00.000Z');
    expect(next.modified).toBe(new Date(3000).toISOString());
    expect(next.title).toBe('N');
  });
});

describe('inferPropertyType', () => {
  it('déduit le type depuis la valeur de frontmatter', () => {
    expect(inferPropertyType(['A', 'B'])).toBe('list');
    expect(inferPropertyType(42)).toBe('number');
    expect(inferPropertyType(true)).toBe('checkbox');
    expect(inferPropertyType('texte libre')).toBe('text');
  });
});
