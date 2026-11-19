import { describe, expect, it } from 'vitest';
import { parseFrontmatter } from '../properties/frontmatter';
import { codeRanges, linkRewriteKind, relativePath, renamedPath, rewriteCanvasLinks, rewriteNoteLinks } from './linkRewrite';

const files = [
  'Ancien.md',
  'Autre.md',
  'Projets/Roman.mdx',
  'Projets/Chapitre 1.md',
  'Archives/Roman.md',
  'Images/carte.png',
  'Plan.canvas',
];

const fileRename = (from: string, to: string, filesBefore = files) => ({ filesBefore, from, to, isFolder: false });

describe('rewriteNoteLinks — wikilinks', () => {
  const ctx = fileRename('Ancien.md', 'Nouveau.md');

  it('nom seul, alias, ancre, bloc, intégration', () => {
    const src = '[[Ancien]] [[Ancien|vu ici]] [[Ancien#Titre]] [[Ancien#^bloc|x]] ![[Ancien]] [[Autre]]';
    const r = rewriteNoteLinks(src, 'Autre.md', ctx);
    expect(r.content).toBe('[[Nouveau]] [[Nouveau|vu ici]] [[Nouveau#Titre]] [[Nouveau#^bloc|x]] ![[Nouveau]] [[Autre]]');
    expect(r.count).toBe(5);
  });

  it('casse ignorée et extension écrite conservée', () => {
    const r = rewriteNoteLinks('[[ancien]] [[Ancien.md]]', 'Autre.md', ctx);
    expect(r.content).toBe('[[Nouveau]] [[Nouveau.md]]');
  });

  it('accents : NFD dans le lien, NFC sur disque (et inversement)', () => {
    const nfd = 'Scène'.normalize('NFD');
    const c = fileRename('Scène.md'.normalize('NFC'), 'Scène finale.md', ['Scène.md'.normalize('NFC'), 'Autre.md']);
    const r = rewriteNoteLinks(`[[${nfd}]] et [[${nfd}|ici]]`, 'Autre.md', c);
    expect(r.content).toBe('[[Scène finale]] et [[Scène finale|ici]]');
    expect(r.count).toBe(2);
  });

  it('pipe échappé dans un tableau', () => {
    const r = rewriteNoteLinks('| [[Ancien\\|alias]] |', 'Autre.md', ctx);
    expect(r.content).toBe('| [[Nouveau\\|alias]] |');
  });

  it('jamais dans le code', () => {
    const src = '```\n[[Ancien]]\n```\n`[[Ancien]]` [[Ancien]]';
    const r = rewriteNoteLinks(src, 'Autre.md', ctx);
    expect(r.content).toBe('```\n[[Ancien]]\n```\n`[[Ancien]]` [[Nouveau]]');
    expect(r.count).toBe(1);
  });

  it('style chemin conservé, chemin complet si le nom seul devient ambigu', () => {
    const c = fileRename('Projets/Roman.mdx', 'Projets/Saga.mdx');
    expect(rewriteNoteLinks('[[Projets/Roman]]', 'Autre.md', c).content).toBe('[[Projets/Saga]]');
    // Archives/Roman.md existe : renommer Projets/Roman en … Roman ailleurs
    const c2 = fileRename('Projets/Chapitre 1.md', 'Projets/Roman.md');
    expect(rewriteNoteLinks('[[Chapitre 1]]', 'Ancien.md', c2).content).toBe('[[Projets/Roman.md]]');
  });

  it('lien vers un homonyme non renommé : intact', () => {
    const c = fileRename('Archives/Roman.md', 'Archives/Vieux roman.md');
    // Depuis Projets/, [[Roman]] vise Projets/Roman.mdx (dossier courant)
    expect(rewriteNoteLinks('[[Roman]]', 'Projets/Chapitre 1.md', c).count).toBe(0);
    expect(rewriteNoteLinks('[[Archives/Roman]]', 'Projets/Chapitre 1.md', c).content).toBe('[[Archives/Vieux roman]]');
  });

  it('changement de format .md → .mdx : lien sans extension inchangé, avec extension mis à jour', () => {
    const c = fileRename('Ancien.md', 'Ancien.mdx');
    expect(rewriteNoteLinks('[[Ancien]]', 'Autre.md', c).count).toBe(0);
    expect(rewriteNoteLinks('[[Ancien.md]]', 'Autre.md', c).content).toBe('[[Ancien.mdx]]');
  });

  it('dossier renommé : notes de l’arbre et pièces jointes hors arbre', () => {
    const c = { filesBefore: files, from: 'Projets', to: 'Écrits', isFolder: true };
    const src = '[[Projets/Chapitre 1|ch]] ![[Projets/croquis.png]] [[Roman]]';
    const r = rewriteNoteLinks(src, 'Autre.md', c);
    expect(r.content).toBe('[[Écrits/Chapitre 1|ch]] ![[Écrits/croquis.png]] [[Roman]]');
  });

  it('relatif recalculé quand la note qui contient le lien est déplacée', () => {
    const c = fileRename('Projets/Chapitre 1.md', 'Archives/Chapitre 1.md');
    const r = rewriteNoteLinks('[[./Roman]] [[Autre]]', 'Projets/Chapitre 1.md', c);
    expect(r.content).toBe('[[../Projets/Roman]] [[Autre]]');
  });
});

describe('rewriteNoteLinks — liens markdown', () => {
  it('relatif, encodé %20, ancre et titre conservés', () => {
    const c = fileRename('Projets/Chapitre 1.md', 'Projets/Chapitre un.md');
    const src = '[ch](Chapitre%201.md#Début "titre") [abs](Projets/Chapitre%201.md) [web](https://x.fr/Chapitre%201.md)';
    const r = rewriteNoteLinks(src, 'Projets/Roman.mdx', c);
    expect(r.content).toBe('[ch](Chapitre%20un.md#Début "titre") [abs](Projets/Chapitre%20un.md) [web](https://x.fr/Chapitre%201.md)');
    expect(r.count).toBe(2);
  });

  it('chevrons et image', () => {
    const c = fileRename('Images/carte.png', 'Images/carte du monde.png');
    const r = rewriteNoteLinks('![](<Images/carte.png>) ![x](Images/carte.png)', 'Ancien.md', c);
    expect(r.content).toBe('![](<Images/carte du monde.png>) ![x](Images/carte%20du%20monde.png)');
  });

  it('aucun lien concerné : contenu identique, compteur 0', () => {
    const src = '# Titre\n[[Autre]] [a](Autre.md)';
    const r = rewriteNoteLinks(src, 'Ancien.md', fileRename('Projets/Roman.mdx', 'Projets/Saga.mdx'));
    expect(r).toEqual({ content: src, count: 0, properties: 0 });
  });
});

describe('rewriteNoteLinks — propriétés (frontmatter)', () => {
  const ctx = fileRename('Ancien.md', 'Nouveau.md');

  it('valeurs avec ou sans guillemets, alias, listes : format YAML conservé', () => {
    const src = [
      '---',
      'lien: "[[Ancien]]"',
      "source: '[[Ancien|la source]]'  # commentaire",
      'brut: [[Ancien]]',
      'voir:',
      '  - "[[Ancien#Titre]]"',
      '  - "[[Autre]]"',
      'liste: ["[[Ancien]]", "[[Autre]]"]',
      'titre: Ancien',
      '---',
      '',
      'Corps : [[Ancien]]',
    ].join('\n');
    const r = rewriteNoteLinks(src, 'Autre.md', ctx);
    expect(r.content).toBe(
      [
        '---',
        'lien: "[[Nouveau]]"',
        "source: '[[Nouveau|la source]]'  # commentaire",
        'brut: [[Nouveau]]',
        'voir:',
        '  - "[[Nouveau#Titre]]"',
        '  - "[[Autre]]"',
        'liste: ["[[Nouveau]]", "[[Autre]]"]',
        'titre: Ancien',
        '---',
        '',
        'Corps : [[Nouveau]]',
      ].join('\n'),
    );
    expect(r.count).toBe(6);
    expect(r.properties).toBe(5);
  });

  it('apostrophe et guillemet dans le nouveau nom : YAML toujours valide', () => {
    const c = fileRename('Ancien.md', 'L\'été "chaud".md');
    const src = '---\na: \'[[Ancien]]\'\nb: "[[Ancien]]"\n---\n';
    const r = rewriteNoteLinks(src, 'Autre.md', c);
    expect(r.content).toBe('---\na: \'[[L\'\'été "chaud"]]\'\nb: "[[L\'été \\"chaud\\"]]"\n---\n');
    expect(r.properties).toBe(2);
    const linkTo = '[[L\'été "chaud"]]';
    expect(parseFrontmatter(r.content).data).toEqual({ a: linkTo, b: linkTo });
  });

  it("ancien nom avec apostrophe dans une chaîne entre apostrophes ('')", () => {
    const c = fileRename("L'ancien.md", 'Nouveau.md', ["L'ancien.md", 'Autre.md']);
    const r = rewriteNoteLinks("---\nlien: '[[L''ancien]]'\n---\n", 'Autre.md', c);
    expect(r.content).toBe("---\nlien: '[[Nouveau]]'\n---\n");
  });

  it('propriété de type Chemin : valeur nue, entre guillemets, en liste, dossier renommé', () => {
    const src = [
      '---',
      'fichier: Projets/Roman.mdx',
      "autre: 'Projets/Roman.mdx'",
      'pieces:',
      '  - Projets/Chapitre 1.md',
      '  - Autre.md',
      'texte: Projets/Roman.mdx',
      '---',
      'Projets/Roman.mdx',
    ].join('\n');
    const folder = { filesBefore: files, from: 'Projets', to: 'Écrits/Projets', isFolder: true };
    const r = rewriteNoteLinks(src, 'Autre.md', folder, { pathProperties: ['Fichier', 'autre', 'pieces'] });
    expect(r.content).toBe(
      [
        '---',
        'fichier: Écrits/Projets/Roman.mdx',
        "autre: 'Écrits/Projets/Roman.mdx'",
        'pieces:',
        '  - Écrits/Projets/Chapitre 1.md',
        '  - Autre.md',
        'texte: Projets/Roman.mdx',
        '---',
        'Projets/Roman.mdx',
      ].join('\n'),
    );
    expect(r.count).toBe(3);
    expect(r.properties).toBe(3);
  });

  it('chemin qui exigerait des guillemets : guillemets ajoutés', () => {
    const c = fileRename('Ancien.md', 'Notes: # brouillon.md');
    const r = rewriteNoteLinks('---\nfichier: Ancien.md\n---\n', 'Autre.md', c, { pathProperties: ['fichier'] });
    expect(r.content).toBe('---\nfichier: "Notes: # brouillon.md"\n---\n');
  });

  it('fins de ligne CRLF et accents NFD conservés', () => {
    const c = fileRename('Été.md', 'Hiver.md', ['Été.md', 'Autre.md']);
    const src = '---\r\nlien: "[[E\u0301te\u0301]]"\r\n---\r\nTexte';
    const r = rewriteNoteLinks(src, 'Autre.md', c);
    expect(r.content).toBe('---\r\nlien: "[[Hiver]]"\r\n---\r\nTexte');
    expect(r.properties).toBe(1);
  });

  it('frontmatter invalide : liens réécrits comme du texte, aucune propriété comptée', () => {
    const r = rewriteNoteLinks('---\na: [b\nlien: "[[Ancien]]"\n---\n', 'Autre.md', ctx);
    expect(r.content).toBe('---\na: [b\nlien: "[[Nouveau]]"\n---\n');
    expect(r.properties).toBe(0);
  });
});

describe('rewriteCanvasLinks', () => {
  it('cartes fichier mises à jour, indentation tabulation conservée', () => {
    const canvas = JSON.stringify(
      { nodes: [{ id: 'a', type: 'file', file: 'Projets/Roman.mdx' }, { id: 'b', type: 'text', text: 'Projets/Roman.mdx' }], edges: [] },
      null,
      '\t',
    );
    const r = rewriteCanvasLinks(canvas, { filesBefore: files, from: 'Projets', to: 'Écrits', isFolder: true });
    expect(r.count).toBe(1);
    expect(r.content).toContain('"file": "Écrits/Roman.mdx"');
    expect(r.content).toContain('"text": "Projets/Roman.mdx"');
    expect(r.content).toContain('\n\t');
  });

  it('JSON illisible : jamais réécrit', () => {
    expect(rewriteCanvasLinks('{oops', fileRename('Ancien.md', 'N.md'))).toEqual({ content: '{oops', count: 0 });
  });
});

describe('outils', () => {
  it('renamedPath : fichier, dossier, NFC et casse', () => {
    expect(renamedPath('projets/roman.mdx', { from: 'Projets', to: 'Écrits', isFolder: true })).toBe('Écrits/roman.mdx');
    expect(renamedPath('Projetsbis/x.md', { from: 'Projets', to: 'Écrits', isFolder: true })).toBeNull();
    expect(renamedPath('Scène.md'.normalize('NFD'), { from: 'Scène.md', to: 'S.md', isFolder: false })).toBe('S.md');
  });
  it('relativePath', () => {
    expect(relativePath('Archives', 'Projets/Roman.mdx')).toBe('../Projets/Roman.mdx');
    expect(relativePath('Projets', 'Projets/Roman.mdx')).toBe('Roman.mdx');
    expect(relativePath('', 'a/b.md')).toBe('a/b.md');
  });
  it('codeRanges et linkRewriteKind', () => {
    expect(codeRanges('a `b` c')).toEqual([[2, 5]]);
    expect(linkRewriteKind('x.MD')).toBe('note');
    expect(linkRewriteKind('x.canvas')).toBe('canvas');
    expect(linkRewriteKind('x.png')).toBeNull();
  });
});
