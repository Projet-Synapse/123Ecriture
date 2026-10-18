import { describe, expect, it } from 'vitest';

import { findLiveMatches, findTableBlocks, type HeadingMatch, type MarkMatch, type TokenMatch } from './liveDecorations';

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

  // Garde anti-clignotement (rapporté : « l'apparition de la mise en forme
  // est très chaotique ») : un italique accolé au même délimiteur à
  // l'extérieur est un GRAS EN COURS DE FRAPPE — il ne doit PAS être stylé
  // (sinon l'affichage basculait italique → gras au dernier caractère).
  it('un gras en cours de frappe (`**fort*`) ne se déguise pas en italique', () => {
    const matches = findLiveMatches('avant **fort*');
    expect(matches.filter((m) => m.kind === 'mark')).toHaveLength(0);
  });

  it('un gras-underscore en cours de frappe (`__mot_`) ne se déguise pas en italique', () => {
    const matches = findLiveMatches('avant __mot_');
    expect(matches.filter((m) => m.kind === 'mark')).toHaveLength(0);
  });

  // 2026-10-03 : l'italique-étoile restait non décoré (cut v1), les `*`
  // restaient visibles dans les notes importées.
  it('repère un *italique* étoile', () => {
    const matches = findLiveMatches('avant *fin* après');
    const italic = matches.find((m): m is MarkMatch => m.kind === 'mark' && m.type === 'italic');
    expect(italic).toBeDefined();
    expect('avant *fin* après'.slice(italic!.from, italic!.to)).toBe('*fin*');
  });

  it('ne prend pas une multiplication pour de l’italique (espaces aux bords)', () => {
    const matches = findLiveMatches('2 * 3 * 4 = 12');
    expect(matches.some((m) => m.kind === 'mark')).toBe(false);
  });

  it('repère un __gras__ underscore', () => {
    const matches = findLiveMatches('__** Corbeaux **__');
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ kind: 'mark', type: 'bold' });
    expect('__** Corbeaux **__'.slice(matches[0].from, matches[0].to)).toBe('__** Corbeaux **__');
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
  // v2 (demande utilisateur : « les liens internes doivent TOUJOURS être
  // détectés, même s'il y a de la mise en forme autour ») : les TOKENS
  // gagnent, le mark englobant est découpé (marqueurs masqués, contenu hors
  // token stylé) — l'ancien comportement éliminait le wikilink au profit du
  // gras, et le RangeSetBuilder crashait ou cachait le lien.
  it('un gras contenant un wikilink : le LIEN gagne, le gras est découpé', () => {
    const text = 'avant **voir [[Note]]** après';
    const matches = findLiveMatches(text);
    const link = matches.find((m): m is TokenMatch => m.kind === 'token');
    const bold = matches.find((m): m is MarkMatch => m.kind === 'mark');
    expect(link?.target).toBe('Note');
    // Le gras survit en morceaux : marqueurs ** masqués, le texte hors
    // token («voir ») reste stylé gras.
    expect(bold).toBeDefined();
    expect(text.slice(bold!.from, bold!.from + bold!.markerLength)).toBe('**');
    expect(text.slice(bold!.to - bold!.markerLength, bold!.to)).toBe('**');
    expect(bold!.contentSpans.map((span) => text.slice(span.from, span.to))).toEqual(['voir ']);
  });

  it('un italique autour d’un lien : le texte hors lien reste stylé', () => {
    const text = '_avant [[Note]] après_';
    const matches = findLiveMatches(text);
    const italic = matches.find((m): m is MarkMatch => m.kind === 'mark');
    expect(italic?.type).toBe('italic');
    expect(italic?.contentSpans.map((span) => text.slice(span.from, span.to))).toEqual(['avant ', ' après']);
  });

  it('un titre contenant un wikilink : titre stylé + lien détecté', () => {
    const text = '# Bienvenue [[Accueil]] ici';
    const matches = findLiveMatches(text);
    const heading = matches.find((m): m is HeadingMatch => m.kind === 'heading');
    const link = matches.find((m): m is TokenMatch => m.kind === 'token');
    expect(link?.target).toBe('Accueil');
    expect(heading?.contentSpans.map((span) => text.slice(span.from, span.to))).toEqual([
      'Bienvenue ',
      ' ici',
    ]);
  });

  it('un italique englobant un gras : ne garde que l’italique (marks entre eux, inchangé)', () => {
    const matches = findLiveMatches('_du **gras** dedans_');
    expect(matches.filter((m) => m.kind === 'mark')).toHaveLength(1);
    expect(matches[0]).toMatchObject({ kind: 'mark', type: 'italic' });
  });

  it('des correspondances simplement adjacentes sont toutes conservées', () => {
    const matches = findLiveMatches('**a** puis [[b]] puis #tag');
    expect(matches).toHaveLength(3);
  });
});

describe('findTableBlocks — tableaux GFM (v0.4.50)', () => {
  it('détecte un tableau complet avec ses décalages absolus', () => {
    const text = 'Intro.\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\nSuite.';
    const blocks = findTableBlocks(text);
    expect(blocks).toHaveLength(1);
    expect(text.slice(blocks[0].from, blocks[0].to)).toBe('| A | B |\n| --- | --- |\n| 1 | 2 |');
    expect(blocks[0].source).toBe('| A | B |\n| --- | --- |\n| 1 | 2 |');
  });

  it('ignore une suite de barres sans ligne de séparation', () => {
    const text = '| juste | du texte |\n| avec des barres |';
    expect(findTableBlocks(text)).toHaveLength(0);
  });

  it('détecte deux tableaux séparés par du texte', () => {
    const text = '| A |\n| --- |\n| 1 |\n\nmilieu\n\n| B |\n| --- |\n| 2 |';
    const blocks = findTableBlocks(text);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].source).toContain('| A |');
    expect(blocks[1].source).toContain('| B |');
  });

  it('accepte un alignement `:---:` dans le séparateur', () => {
    const text = '| A | B |\n| :--- | ---: |\n| 1 | 2 |';
    expect(findTableBlocks(text)).toHaveLength(1);
  });
});
