import { describe, expect, it } from 'vitest';

import {
  GRAPH_GROUP_COLORS,
  compileGroupQuery,
  computeGroupMatches,
  createGraphDocResolver,
  createGraphGroup,
  moveGraphGroup,
  normalizeGraphGroups,
  resolveGroupColors,
  resolveGroupIndex,
  type GraphGroup,
  type GraphGroupEntry,
} from './graphGroups';

const entry = (relPath: string, kind: GraphGroupEntry['kind'] = 'markdown'): GraphGroupEntry => {
  const fileName = relPath.split('/').pop() ?? relPath;
  return { relPath, name: fileName.replace(/\.[^.]+$/, ''), fileName, kind };
};

const entries = [
  entry("L'ENCHANTERESSE/Personnages/Kyani.md"),
  entry("L'ENCHANTERESSE/Lieux/Luméville.md"),
  entry('Journal/2026-11-28.md'),
  entry('Divers/Idée.md'),
];

const contents: Record<string, string> = {
  "L'ENCHANTERESSE/Personnages/Kyani.md": '---\nstatut: brouillon\n---\nKyani parle aux dragons. #perso',
  "L'ENCHANTERESSE/Lieux/Luméville.md": 'Une ville. #lieu',
  'Journal/2026-11-28.md': 'Journée calme.',
  // Divers/Idée.md absent : au-delà de la limite de lecture du graphe.
};

const g = (id: string, query: string, color: string): GraphGroup => ({ id, query, color });

function matches(queries: string[]) {
  return computeGroupMatches(entries, queries, createGraphDocResolver(contents));
}

describe('computeGroupMatches', () => {
  it('path: et file: se résolvent sans lire le contenu', () => {
    let reads = 0;
    const m = computeGroupMatches(entries, ["path:L'ENCHANTERESSE", 'file:Idée'], () => {
      reads += 1;
      throw new Error('contenu lu');
    });
    expect(reads).toBe(0);
    expect([...(m[0] ?? [])].sort()).toEqual([
      "L'ENCHANTERESSE/Lieux/Luméville.md",
      "L'ENCHANTERESSE/Personnages/Kyani.md",
    ]);
    expect([...(m[1] ?? [])]).toEqual(['Divers/Idée.md']);
  });

  it('tag: et [propriété] lisent le contenu', () => {
    const m = matches(['tag:#perso', '[statut]', '[statut:brouillon]', '[statut:fini]']);
    expect([...(m[0] ?? [])]).toEqual(["L'ENCHANTERESSE/Personnages/Kyani.md"]);
    expect([...(m[1] ?? [])]).toEqual(["L'ENCHANTERESSE/Personnages/Kyani.md"]);
    expect([...(m[2] ?? [])]).toEqual(["L'ENCHANTERESSE/Personnages/Kyani.md"]);
    expect(m[3]?.size).toBe(0);
  });

  it('ET, OR, exclusion et accents ignorés', () => {
    const m = matches(['path:Journal OR tag:#lieu', 'path:enchanteresse -tag:#lieu', 'luméville', 'lumeville']);
    expect([...(m[0] ?? [])].sort()).toEqual(['Journal/2026-11-28.md', "L'ENCHANTERESSE/Lieux/Luméville.md"]);
    expect([...(m[1] ?? [])]).toEqual(["L'ENCHANTERESSE/Personnages/Kyani.md"]);
    expect(m[2]?.size).toBe(1);
    expect(m[3]?.size).toBe(1);
  });

  it('une note non lue ne correspond jamais à un critère de contenu', () => {
    const m = matches(['tag:#perso OR [statut]', 'dragons']);
    expect(m[0]?.has('Divers/Idée.md')).toBe(false);
    expect(m[1]?.has('Divers/Idée.md')).toBe(false);
  });

  it('requête vide ou incomplète : aucun nœud, aucune exception', () => {
    const queries = ['', '   ', 'path:', 'tag:', '[', '"ouvert', '(', ')', 'OR', '-', 'line:(', 'section:"'];
    const m = matches(queries);
    expect(m).toHaveLength(queries.length);
    expect(m[0]).toBeNull();
    expect(m[1]).toBeNull();
    for (const set of m) expect(set === null || set instanceof Set).toBe(true);
  });
});

describe('compileGroupQuery', () => {
  it('signale les requêtes qui ont besoin du contenu', () => {
    expect(compileGroupQuery('path:Journal')?.needsContent).toBe(false);
    expect(compileGroupQuery('file:Idée')?.needsContent).toBe(false);
    expect(compileGroupQuery('tag:#a')?.needsContent).toBe(true);
    expect(compileGroupQuery('[statut]')?.needsContent).toBe(true);
    expect(compileGroupQuery('')).toBeNull();
  });
});

describe('priorité : le premier groupe qui correspond gagne', () => {
  const groups = [g('1', 'tag:#perso', '#ff0000'), g('2', "path:L'ENCHANTERESSE", '#00ff00'), g('3', 'path:Journal', '#0000ff')];

  it('résout le rang et la couleur', () => {
    const m = matches(groups.map((x) => x.query));
    expect(resolveGroupIndex("L'ENCHANTERESSE/Personnages/Kyani.md", m)).toBe(0);
    expect(resolveGroupIndex("L'ENCHANTERESSE/Lieux/Luméville.md", m)).toBe(1);
    expect(resolveGroupIndex('Journal/2026-11-28.md', m)).toBe(2);
    expect(resolveGroupIndex('Divers/Idée.md', m)).toBe(-1);
    const { colorByPath, counts } = resolveGroupColors(
      entries.map((e) => e.relPath),
      groups,
      m,
    );
    expect(colorByPath.get("L'ENCHANTERESSE/Personnages/Kyani.md")).toBe('#ff0000');
    expect(colorByPath.get("L'ENCHANTERESSE/Lieux/Luméville.md")).toBe('#00ff00');
    expect(colorByPath.get('Journal/2026-11-28.md')).toBe('#0000ff');
    expect(colorByPath.has('Divers/Idée.md')).toBe(false);
    expect(counts).toEqual([1, 1, 1]);
  });

  it('réordonner change le gagnant sans ré-évaluer les requêtes', () => {
    const m = matches(groups.map((x) => x.query));
    const reordered = moveGraphGroup(groups, 1, -1); // « path:L'ENCHANTERESSE » passe devant « tag:#perso »
    const mm = reordered.map((r) => m[groups.findIndex((x) => x.id === r.id)]);
    const { colorByPath, counts } = resolveGroupColors(
      entries.map((e) => e.relPath),
      reordered,
      mm,
    );
    expect(colorByPath.get("L'ENCHANTERESSE/Personnages/Kyani.md")).toBe('#00ff00');
    expect(counts).toEqual([2, 0, 1]);
  });

  it('une requête vide ne masque pas les suivantes', () => {
    const m = matches(['', 'path:Journal']);
    expect(resolveGroupIndex('Journal/2026-11-28.md', m)).toBe(1);
  });
});

describe('moveGraphGroup / createGraphGroup / normalizeGraphGroups', () => {
  const list = [g('a', 'x', '#111111'), g('b', 'y', '#222222'), g('c', 'z', '#333333')];

  it('déplace dans les bornes, sinon renvoie une copie inchangée', () => {
    expect(moveGraphGroup(list, 2, -1).map((x) => x.id)).toEqual(['a', 'c', 'b']);
    expect(moveGraphGroup(list, 0, 1).map((x) => x.id)).toEqual(['b', 'a', 'c']);
    expect(moveGraphGroup(list, 0, -1).map((x) => x.id)).toEqual(['a', 'b', 'c']);
    expect(moveGraphGroup(list, 2, 1).map((x) => x.id)).toEqual(['a', 'b', 'c']);
    expect(moveGraphGroup(list, 5, -1)).toEqual(list);
  });

  it('un nouveau groupe est vide, a un id unique et la couleur suivante du cycle', () => {
    const created = createGraphGroup(list);
    expect(created.query).toBe('');
    expect(list.some((x) => x.id === created.id)).toBe(false);
    expect(created.color).toBe(GRAPH_GROUP_COLORS[3]);
  });

  it('normalise les préférences tolérantes', () => {
    expect(normalizeGraphGroups(undefined)).toEqual([]);
    expect(normalizeGraphGroups('x')).toEqual([]);
    const out = normalizeGraphGroups([
      { id: 'a', query: 'path:A', color: '#abc' },
      { id: 'a', query: 'path:B', color: 'rouge' },
      null,
      42,
      { query: 7, color: '#00ff00' },
    ]);
    expect(out).toHaveLength(3);
    expect(new Set(out.map((x) => x.id)).size).toBe(3);
    expect(out[0]).toEqual({ id: 'a', query: 'path:A', color: '#abc' });
    expect(out[1].color).toBe(GRAPH_GROUP_COLORS[1]);
    expect(out[2].query).toBe('');
    expect(normalizeGraphGroups(Array.from({ length: 80 }, () => ({ query: 'a', color: '#fff' })))).toHaveLength(30);
  });
});

describe('createGraphDocResolver', () => {
  it('analyse le frontmatter une seule fois par note', () => {
    const resolve = createGraphDocResolver(contents);
    const e = entries[0];
    const first = resolve(e);
    expect(first.properties).toEqual({ statut: 'brouillon' });
    expect(first.body).toContain('Kyani parle');
    expect(resolve(e)).toBe(first);
    expect(resolve(entries[3]).body).toBeUndefined();
  });
});
