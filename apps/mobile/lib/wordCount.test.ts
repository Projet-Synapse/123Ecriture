import { describe, expect, it } from 'vitest';

import { countCharacters, countWords } from './wordCount';

describe('countWords', () => {
  it('compte zéro pour une note vide ou composée d\'espaces', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('   \n\t  ')).toBe(0);
  });

  it('compte un mot seul', () => {
    expect(countWords('bonjour')).toBe(1);
  });

  it('compte les mots séparés par espaces, tabulations et sauts de ligne', () => {
    expect(countWords('un deux trois')).toBe(3);
    expect(countWords('un\tdeux\n\ntrois  quatre')).toBe(4);
  });

  it('compte le markdown tel quel (pas de parseur)', () => {
    expect(countWords('# Titre\n\nDu **gras** et un [lien](https://exemple.fr).')).toBe(7);
  });

  it('traite la ponctuation collée comme partie du mot hôte', () => {
    expect(countWords('Fin.')).toBe(1);
  });

  it('gère les caractères accentués et les apostrophes françaises', () => {
    expect(countWords("Aujourd'hui, à côté de l'église…")).toBe(5);
  });
});

describe('countCharacters', () => {
  it('compte tous les caractères, espaces et sauts de ligne inclus', () => {
    expect(countCharacters('ab cd\ne')).toBe(7);
  });

  it('compte zéro pour une note vide', () => {
    expect(countCharacters('')).toBe(0);
  });
});
