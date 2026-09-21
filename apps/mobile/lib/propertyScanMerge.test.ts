import { describe, expect, it } from 'vitest';

import { createPropertyScanMerger } from './propertyScanMerge';
import { parseFrontmatter } from './frontmatter';

// Fusion du scan de propriétés en fonction pure — les deux ports
// (properties:scan-vault desktop, PropertiesBridge.scanVault web) doivent se
// comporter identiquement : création des définitions manquantes avec type
// déduit, fusion insensible à la casse, compteur d'usage par nom canonique,
// created/modified exclues (matérialisées par l'app).
function makeMerger(existingNames: string[] = []) {
  return createPropertyScanMerger(existingNames, {
    newId: (() => {
      let counter = 0;
      return () => `id-${++counter}`;
    })(),
    now: () => '2026-09-21T00:00:00.000Z',
  });
}

describe('createPropertyScanMerger', () => {
  it('crée les définitions manquantes avec le type déduit de la valeur', () => {
    const merger = makeMerger();
    merger.absorbNoteFrontmatter(parseFrontmatter('---\ntags:\n  - un\n  - deux\nscore: 3\npublié: true\nlieu: Paris\n---').data);

    expect(merger.toCreate.map((d) => [d.name, d.type])).toEqual([
      ['tags', 'list'],
      ['score', 'number'],
      ['publié', 'checkbox'],
      ['lieu', 'text'],
    ]);
    expect(merger.usage).toEqual({ tags: 1, score: 1, publié: 1, lieu: 1 });
  });

  it('fusionne insensible à la casse avec le schéma : `Tags` dans une note et `tags` enregistré ne crée rien', () => {
    const merger = makeMerger(['tags']);
    merger.absorbNoteFrontmatter({ Tags: ['un'] });
    merger.absorbNoteFrontmatter({ TAGS: ['deux'] });

    expect(merger.toCreate).toEqual([]);
    // Usage indexé par la GRAPHIE ENREGISTRÉE (nom canonique) — sinon le
    // compteur affiché (usage[def.name]) restait à 0 pour ces notes.
    expect(merger.usage).toEqual({ tags: 2 });
  });

  it('fusionne les collisions de casse ENTRE notes sur la première graphie rencontrée', () => {
    const merger = makeMerger();
    merger.absorbNoteFrontmatter({ Statut: 'brouillon' });
    merger.absorbNoteFrontmatter({ statut: 'publié' });
    merger.absorbNoteFrontmatter({ STATUT: 'archivé' });

    expect(merger.toCreate).toHaveLength(1);
    expect(merger.toCreate[0]?.name).toBe('Statut');
    expect(merger.usage).toEqual({ Statut: 3 });
  });

  it('n’accepte jamais un doublon de casse déjà présent dans le schéma (premier gagnant)', () => {
    const merger = makeMerger(['Tags', 'tags']);
    merger.absorbNoteFrontmatter({ TAGS: ['un'] });

    expect(merger.toCreate).toEqual([]);
    expect(merger.usage).toEqual({ Tags: 1 });
  });

  it('exclut created/modified : gérées par l’app, jamais enregistrées par le scan', () => {
    const merger = makeMerger();
    merger.absorbNoteFrontmatter({ created: '2026-01-01T00:00:00Z', modified: '2026-09-21T00:00:00Z', note: 'x' });

    expect(merger.toCreate.map((d) => d.name)).toEqual(['note']);
    expect(merger.usage).toEqual({ note: 1 });
  });

  it('cumule l’usage sur plusieurs notes sans dupliquer la définition', () => {
    const merger = makeMerger();
    merger.absorbNoteFrontmatter({ lieu: 'Paris' });
    merger.absorbNoteFrontmatter({ lieu: 'Lyon', theme: 'nuit' });
    merger.absorbNoteFrontmatter({ lieu: 'Nice' });

    expect(merger.toCreate.map((d) => d.name)).toEqual(['lieu', 'theme']);
    expect(merger.usage).toEqual({ lieu: 3, theme: 1 });
  });
});
