import { describe, expect, it } from 'vitest';

import { findLiveMatches, type HeadingMatch, type MarkMatch, type TokenMatch } from './liveDecorations';

describe('findLiveMatches — gras/italique', () => {
  it('repère un **gras**', () => {
    const matches = findLiveMatches('avant **fort** après');
    const bold = matches.find((m): m is MarkMatch => m.kind === 'mark' && m.type === 'bold');
    expect(bold).toBeDefined();
    expect('avant **fort** après'.slice(bold!.from, bold!.to)).toBe('**fort**');
  });

  it('repère un _italique_', () => {
    const matches = findLiveMatches('avant _fin_ après');
    const italic = matches.find((m): m is MarkMatch => m.kind === 'mark' && m.type === 'italic');
    expect(italic).toBeDefined();
    expect('avant _fin_ après'.slice(italic!.from, italic!.to)).toBe('_fin_');
  });

  it('ne traverse pas un saut de ligne', () => {
    const matches = findLiveMatches('**a\nb**');
    expect(matches.some((m) => m.kind === 'mark')).toBe(false);
  });
});

describe('findLiveMatches — titres', () => {
  it('repère un titre de niveau 2', () => {
    const text = '## Titre ici\nsuite';
    const matches = findLiveMatches(text);
    const heading = matches.find((m): m is HeadingMatch => m.kind === 'heading');
    expect(heading).toBeDefined();
    expect(heading!.level).toBe(2);
    expect(text.slice(heading!.contentFrom, heading!.to)).toBe('Titre ici');
  });

  it('ignore un "#" sans espace (pas un titre)', () => {
    const matches = findLiveMatches('#nope pas un titre');
    expect(matches.some((m) => m.kind === 'heading')).toBe(false);
  });
});

describe('findLiveMatches — liens/embeds/tags/occurrences', () => {
  it('distingue un [[lien]] d’un ![[embed]]', () => {
    const matches = findLiveMatches('voir [[Ma note]] et ![[image.png]]') as TokenMatch[];
    const link = matches.find((m) => m.type === 'wikilink');
    const embed = matches.find((m) => m.type === 'embed');
    expect(link?.target).toBe('Ma note');
    expect(embed?.target).toBe('image.png');
  });

  it('gère un alias [[cible|alias]]', () => {
    const matches = findLiveMatches('[[Cible|Alias affiché]]') as TokenMatch[];
    const link = matches.find((m) => m.type === 'wikilink');
    expect(link?.target).toBe('Cible');
    expect(link?.label).toBe('Alias affiché');
  });

  it('repère un #tag en début de mot seulement', () => {
    const matches = findLiveMatches('un #tag ici, pas un id#tag2') as TokenMatch[];
    const tags = matches.filter((m) => m.type === 'tag');
    expect(tags).toHaveLength(1);
    expect(tags[0].target).toBe('tag');
  });

  it('repère une {{occurrence}}', () => {
    const matches = findLiveMatches('texte {{Mon mot}} suite') as TokenMatch[];
    const occurrence = matches.find((m) => m.type === 'occurrence');
    expect(occurrence?.target).toBe('Mon mot');
  });
});

describe('findLiveMatches — tri', () => {
  it('renvoie les correspondances triées par position', () => {
    const matches = findLiveMatches('{{b}} puis **a** puis [[c]]');
    const froms = matches.map((m) => m.from);
    expect(froms).toEqual([...froms].sort((a, b) => a - b));
  });
});

describe('findLiveMatches — chevauchements', () => {
  // Garde-fou du crash "Ranges must be added sorted by `from`" (voir
  // findLiveMatches) : deux syntaxes imbriquées font replonger le
  // RangeSetBuilder en arrière → CodeMirror désactive tout le plugin.
  it('un gras contenant un wikilink : ne garde que le gras (premier trié)', () => {
    const matches = findLiveMatches('avant **voir [[Note]]** après');
    expect(matches.some((m) => m.kind === 'mark')).toBe(true);
    expect(matches.some((m) => m.kind === 'token')).toBe(false);
  });

  it('un italique englobant un gras : ne garde que l’italique', () => {
    const matches = findLiveMatches('_du **gras** dedans_');
    expect(matches.filter((m) => m.kind === 'mark')).toHaveLength(1);
    expect(matches[0]).toMatchObject({ kind: 'mark', type: 'italic' });
  });

  it('des correspondances simplement adjacentes sont toutes conservées', () => {
    const matches = findLiveMatches('**a** puis [[b]] puis #tag');
    expect(matches).toHaveLength(3);
  });
});
