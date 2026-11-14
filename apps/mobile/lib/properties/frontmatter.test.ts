import { describe, expect, it } from 'vitest';

import {
  joinFrontmatter,
  newNoteFrontmatter,
  parseFrontmatter,
  replaceFrontmatterData,
  serializeFrontmatter,
  splitFrontmatter,
} from './frontmatter';

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

// Doublon « carte Propriétés + YAML brut » en mode Intermédiaire (Android,
// 2026-11-14) : le corps donné à l'éditeur ne doit JAMAIS contenir le bloc,
// et la recomposition bloc + corps doit rendre le fichier à l'identique.
describe('splitFrontmatter — masquage du bloc en mode Intermédiaire', () => {
  const NOTE = '---\ntitle: Sans titre 2\ncreated: 2026-11-14T00:29:33.111Z\n---\n\nCorps de la note.';

  it('cas rapporté : le corps ne contient ni --- ni les clés', () => {
    const { block, body, data } = splitFrontmatter(NOTE);
    expect(body).toBe('Corps de la note.');
    expect(body).not.toContain('---');
    expect(body).not.toContain('created:');
    expect(Object.keys(data)).toEqual(['title', 'created']);
    expect(block + body).toBe(NOTE);
  });

  it('fins de ligne CRLF', () => {
    const crlf = '---\r\ncreated: 2026-11-14T00:29:33.111Z\r\n---\r\n\r\nCorps\r\nligne 2';
    const { block, body, data, eol } = splitFrontmatter(crlf);
    expect(body).toBe('Corps\r\nligne 2');
    expect(eol).toBe('\r\n');
    expect(Object.keys(data)).toEqual(['created']);
    expect(block + body).toBe(crlf);
  });

  it('BOM UTF-8 en tête', () => {
    const withBom = '\uFEFF---\nstatut: brouillon\n---\n\nCorps';
    const { block, body, data, bom } = splitFrontmatter(withBom);
    expect(bom).toBe('\uFEFF');
    expect(body).toBe('Corps');
    expect(data).toEqual({ statut: 'brouillon' });
    expect(block + body).toBe(withBom);
  });

  it('espaces et tabulations après les ---', () => {
    const spaced = '---  \nstatut: ok\n--- \t\n\nCorps';
    const { body, data } = splitFrontmatter(spaced);
    expect(body).toBe('Corps');
    expect(data).toEqual({ statut: 'ok' });
  });

  it('bloc vide et fichier qui s\'arrête sur le --- fermant', () => {
    expect(splitFrontmatter('---\n---\n\nCorps').body).toBe('Corps');
    const bare = splitFrontmatter('---\nstatut: ok\n---');
    expect(bare.body).toBe('');
    expect(bare.data).toEqual({ statut: 'ok' });
  });

  it('un bloc vide ne s\'étend pas jusqu\'au --- suivant', () => {
    const { body, data } = splitFrontmatter('---\n---\nTexte\n---\nsuite');
    expect(data).toEqual({});
    expect(body).toBe('Texte\n---\nsuite');
  });

  it('YAML invalide, scalaire ou délimiteur suivi de texte : rien n\'est caché', () => {
    for (const content of ['---\n: : mal formé : :\n---\n\nCorps', '---\njuste une phrase\n---\nCorps', '---\na: 1\n---suite']) {
      const { block, body, data } = splitFrontmatter(content);
      expect(block).toBe('');
      expect(body).toBe(content);
      expect(data).toEqual({});
    }
  });

  it('frontmatter ajouté après l\'ouverture : le corps suit', () => {
    const before = 'Corps tapé';
    expect(splitFrontmatter(before).body).toBe('Corps tapé');
    const after = replaceFrontmatterData(before, { statut: 'ok' });
    expect(after).toBe('---\nstatut: ok\n---\n\nCorps tapé');
    expect(splitFrontmatter(after).body).toBe('Corps tapé');
  });

  it('nouvelle note : gabarit sans title, corps vide', () => {
    const template = newNoteFrontmatter(new Date('2026-11-14T00:29:33.111Z'));
    expect(template).toBe('---\ncreated: 2026-11-14T00:29:33.111Z\n---\n\n');
    const { body, data } = splitFrontmatter(template);
    expect(body).toBe('');
    expect(Object.keys(data)).toEqual(['created']);
  });
});

describe('joinFrontmatter — écriture du corps sans toucher au bloc', () => {
  it('garde le bloc brut à l\'identique (pas de re-dump YAML)', () => {
    // Guillemets, commentaire et CRLF : un re-dump js-yaml les perdrait.
    const block = '\uFEFF---\r\ntitle: "Ma note"  # commentaire\r\ncreated: 2026-11-14T00:29:33.111Z\r\n---\r\n\r\n';
    const original = `${block}ancien`;
    const { block: parsed } = splitFrontmatter(original);
    expect(parsed).toBe(block);
    expect(joinFrontmatter(parsed, 'nouveau corps')).toBe(`${block}nouveau corps`);
  });

  it('ajoute une fin de ligne si le bloc finit sur --- sans saut de ligne', () => {
    const { block } = splitFrontmatter('---\na: 1\n---');
    expect(joinFrontmatter(block, 'Bonjour')).toBe('---\na: 1\n---\nBonjour');
    expect(splitFrontmatter(joinFrontmatter(block, 'Bonjour')).body).toBe('Bonjour');
    expect(joinFrontmatter(block, '')).toBe('---\na: 1\n---');
  });

  it('sans frontmatter, le corps est le contenu', () => {
    expect(joinFrontmatter('', 'Texte')).toBe('Texte');
  });
});

describe('replaceFrontmatterData — édition depuis la carte Propriétés', () => {
  it('retirer title (✕) garde created et le corps', () => {
    const note = '---\ntitle: Sans titre 2\ncreated: 2026-11-14T00:29:33.111Z\n---\n\nCorps';
    const { data } = splitFrontmatter(note);
    const next = { ...data };
    delete next.title;
    const result = replaceFrontmatterData(note, next);
    // (js-yaml met la date entre guillemets au re-dump — comportement
    // inchangé, la valeur relue est la même.)
    expect(result).not.toContain('title');
    expect(splitFrontmatter(result).data).toEqual({ created: '2026-11-14T00:29:33.111Z' });
    expect(splitFrontmatter(result).body).toBe('Corps');
  });

  it('conserve BOM, CRLF et corps exact', () => {
    const note = '\uFEFF---\r\nstatut: a\r\n---\r\n\r\nCorps\r\n\r\nfin';
    const result = replaceFrontmatterData(note, { statut: 'b' });
    expect(result).toBe('\uFEFF---\r\nstatut: b\r\n---\r\n\r\nCorps\r\n\r\nfin');
  });

  it('plus aucune propriété : bloc retiré, corps intact', () => {
    expect(replaceFrontmatterData('---\na: 1\n---\n\nCorps', {})).toBe('Corps');
  });

  it('YAML invalide : le texte d\'origine reste intact derrière le nouveau bloc', () => {
    const broken = '---\n: : mal formé : :\n---\n\nCorps';
    expect(replaceFrontmatterData(broken, { a: 1 })).toBe(`---\na: 1\n---\n\n${broken}`);
  });
});
