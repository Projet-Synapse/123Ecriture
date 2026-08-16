import { describe, expect, it } from 'vitest';

import { createConfiguredMarkdownIt } from './markdownPlugins';

// Teste les règles markdown-it maison directement au niveau des tokens
// (pas de rendu React/RN ici, cette lib n'en a pas besoin) — vérifie que le
// parsing produit exactement les tokens attendus, condition nécessaire pour
// que react-native-markdown-display les rende ensuite correctement (voir
// le commentaire d'en-tête de markdownPlugins.ts sur la façon dont il les
// consomme).

function inlineChildren(markdown: string, knownWords?: Set<string>) {
  const md = createConfiguredMarkdownIt(knownWords);
  const tokens = md.parse(markdown, {});
  const inline = tokens.find((t) => t.type === 'inline');
  return inline?.children ?? [];
}

describe('wikilinkRule', () => {
  it('reconnaît [[Cible]] simple', () => {
    const children = inlineChildren('Voir [[Ma note]] pour plus.');
    const token = children.find((c) => c.type === 'wikilink');
    expect(token?.content).toBe('Ma note');
    expect(token?.meta).toEqual({ target: 'Ma note' });
  });

  it('utilise l’alias comme contenu affiché avec [[Cible|Alias]]', () => {
    const children = inlineChildren('[[Ma note|un alias]]');
    const token = children.find((c) => c.type === 'wikilink');
    expect(token?.content).toBe('un alias');
    expect(token?.meta).toEqual({ target: 'Ma note' });
  });

  it('ignore [[ non fermé (pas de crash, retombe en texte brut)', () => {
    const children = inlineChildren('Un [[lien cassé sans fermeture.');
    expect(children.some((c) => c.type === 'wikilink')).toBe(false);
  });
});

describe('embedRule', () => {
  it('reconnaît ![[fichier]] comme un embed, distinct d’un lien', () => {
    const children = inlineChildren('![[image.png]]');
    const token = children.find((c) => c.type === 'embed');
    expect(token?.content).toBe('image.png');
    expect(children.some((c) => c.type === 'wikilink')).toBe(false);
  });

  it('laisse ![alt](url) être traité comme une image standard', () => {
    const children = inlineChildren('![alt](image.png)');
    expect(children.some((c) => c.type === 'embed')).toBe(false);
    expect(children.some((c) => c.type === 'image')).toBe(true);
  });
});

describe('tagRule', () => {
  it('reconnaît #tag en début de ligne', () => {
    const children = inlineChildren('#projet du texte');
    const token = children.find((c) => c.type === 'tag');
    expect(token?.content).toBe('projet');
  });

  it('reconnaît #tag précédé d’un espace', () => {
    const children = inlineChildren('du texte #projet ici');
    const token = children.find((c) => c.type === 'tag');
    expect(token?.content).toBe('projet');
  });

  it('ignore un # au milieu d’un mot', () => {
    const children = inlineChildren('un identifiant xyz#123 pas un tag');
    expect(children.some((c) => c.type === 'tag')).toBe(false);
  });

  it('accepte les accents/tirets/underscores dans un tag', () => {
    const children = inlineChildren('#à-suivre_2026');
    const token = children.find((c) => c.type === 'tag');
    expect(token?.content).toBe('à-suivre_2026');
  });
});

describe('occurrenceRule', () => {
  it('reconnaît {{mot}} SEULEMENT si le mot est dans le dictionnaire connu', () => {
    const known = new Set(['mon mot']);
    const children = inlineChildren('texte {{Mon Mot}} suite', known);
    const token = children.find((c) => c.type === 'occurrence');
    expect(token?.content).toBe('Mon Mot');
    expect(token?.meta).toEqual({ target: 'Mon Mot' });
  });

  it('laisse en texte brut un {{mot}} absent du dictionnaire', () => {
    const children = inlineChildren('texte {{inconnu}} suite', new Set(['autre mot']));
    expect(children.some((c) => c.type === 'occurrence')).toBe(false);
  });

  it('laisse en texte brut un {{mot}} si aucun dictionnaire fourni', () => {
    const children = inlineChildren('texte {{mot}} suite');
    expect(children.some((c) => c.type === 'occurrence')).toBe(false);
  });
});
