import { describe, expect, it } from 'vitest';

import { parseFrontmatter, serializeFrontmatter } from './frontmatter';

describe('parseFrontmatter', () => {
  it('extrait les propriétés et le corps du gabarit par défaut', () => {
    const content = '---\ntitle: Ma note\ncreated: 2026-08-16T10:00:00.000Z\n---\n\nContenu ici.';
    const { data, body } = parseFrontmatter(content);
    expect(data).toEqual({ title: 'Ma note', created: '2026-08-16T10:00:00.000Z' });
    expect(body).toBe('Contenu ici.');
  });

  it('renvoie un objet vide et tout le contenu comme corps si pas de frontmatter', () => {
    const { data, body } = parseFrontmatter('Juste du texte, pas de propriétés.');
    expect(data).toEqual({});
    expect(body).toBe('Juste du texte, pas de propriétés.');
  });

  it('gère les types YAML courants (nombre, booléen, liste)', () => {
    const content = '---\npriorite: 3\nfait: true\ntags:\n  - a\n  - b\n---\n\nCorps.';
    const { data } = parseFrontmatter(content);
    expect(data).toEqual({ priorite: 3, fait: true, tags: ['a', 'b'] });
  });

  it('ne plante pas sur un frontmatter invalide — renvoie vide plutôt que de lever', () => {
    const content = '---\n: : mal formé : :\n---\n\nCorps.';
    const { data, body } = parseFrontmatter(content);
    expect(data).toEqual({});
    expect(body).toBe(content);
  });
});

describe('serializeFrontmatter', () => {
  it('recompose un bloc frontmatter à partir des propriétés', () => {
    const result = serializeFrontmatter({ title: 'Ma note' }, 'Corps ici.');
    expect(result).toBe('---\ntitle: Ma note\n---\n\nCorps ici.');
  });

  it("n'ajoute pas de bloc si aucune propriété", () => {
    expect(serializeFrontmatter({}, 'Corps ici.')).toBe('Corps ici.');
  });

  it('fait un aller-retour stable avec parseFrontmatter', () => {
    const original = '---\ntitle: Test\npriorite: 2\n---\n\nContenu de la note.';
    const { data, body } = parseFrontmatter(original);
    const roundTripped = serializeFrontmatter(data, body);
    const reparsed = parseFrontmatter(roundTripped);
    expect(reparsed.data).toEqual(data);
    expect(reparsed.body).toBe(body);
  });
});
