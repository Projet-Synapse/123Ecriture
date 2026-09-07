import { describe, expect, it } from 'vitest';

import { applyHeading, insertLink, insertTable, toggleLinePrefix, toggleNumberedList, wrapSelection } from './mdxFormatting';

// Ce fichier n'avait aucun test jusqu'ici malgré des fonctions pures faciles
// à couvrir (voir lib/notesToolbarActions.ts, qui les branche toutes sur la
// barre de formatage) — couverture ajoutée en même temps que le nouveau
// bouton "Barré" (voir notesToolbarActions.ts) pour éviter d'ajouter un
// nouvel appelant à une fonction non testée sans combler le manque.

describe('wrapSelection', () => {
  it('entoure le texte sélectionné du marqueur', () => {
    const result = wrapSelection('texte gras ici', { start: 6, end: 10 }, '**');
    expect(result.text).toBe('texte **gras** ici');
    expect(result.selection).toEqual({ start: 8, end: 12 });
  });

  it('sans sélection, insère une paire de marqueurs avec le curseur au milieu', () => {
    const result = wrapSelection('', { start: 0, end: 0 }, '~~');
    expect(result.text).toBe('~~~~');
    expect(result.selection).toEqual({ start: 2, end: 2 });
  });

  it('gère le barré comme le gras/italique (même mécanisme, marqueur différent)', () => {
    const result = wrapSelection('mot barré', { start: 4, end: 9 }, '~~');
    expect(result.text).toBe('mot ~~barré~~');
    expect(result.selection).toEqual({ start: 6, end: 11 });
  });
});

describe('applyHeading', () => {
  it("applique un titre sur la ligne courante", () => {
    const result = applyHeading('Titre', { start: 0, end: 0 }, 2);
    expect(result.text).toBe('## Titre');
  });

  it('remplace un titre déjà présent plutôt que de l’empiler', () => {
    const result = applyHeading('### Ancien', { start: 0, end: 0 }, 1);
    expect(result.text).toBe('# Ancien');
  });
});

describe('toggleLinePrefix', () => {
  it('ajoute le préfixe sur chaque ligne non vide de la sélection', () => {
    const text = 'un\ndeux\ntrois';
    const result = toggleLinePrefix(text, { start: 0, end: text.length }, '- ');
    expect(result.text).toBe('- un\n- deux\n- trois');
  });

  it('retire le préfixe si toutes les lignes sont déjà préfixées (bascule)', () => {
    const text = '- un\n- deux';
    const result = toggleLinePrefix(text, { start: 0, end: text.length }, '- ');
    expect(result.text).toBe('un\ndeux');
  });

  it('ignore les lignes vides du bloc', () => {
    const text = 'un\n\ndeux';
    const result = toggleLinePrefix(text, { start: 0, end: text.length }, '> ');
    expect(result.text).toBe('> un\n\n> deux');
  });
});

describe('toggleNumberedList', () => {
  it('numérote chaque ligne de façon incrémentale', () => {
    const text = 'un\ndeux\ntrois';
    const result = toggleNumberedList(text, { start: 0, end: text.length });
    expect(result.text).toBe('1. un\n2. deux\n3. trois');
  });

  it('retire la numérotation si déjà présente (bascule)', () => {
    const text = '1. un\n2. deux';
    const result = toggleNumberedList(text, { start: 0, end: text.length });
    expect(result.text).toBe('un\ndeux');
  });
});

describe('insertLink', () => {
  it('utilise la sélection comme libellé du lien', () => {
    const result = insertLink('voir mon site', { start: 5, end: 13 });
    expect(result.text).toBe('voir [mon site](url)');
  });

  it('insère un libellé par défaut sans sélection', () => {
    const result = insertLink('', { start: 0, end: 0 });
    expect(result.text).toBe('[texte du lien](url)');
  });
});

describe('insertTable', () => {
  it('insère le gabarit de tableau tel quel en début de ligne', () => {
    const result = insertTable('', { start: 0, end: 0 });
    expect(result.text).toContain('| Colonne 1 | Colonne 2 |');
  });

  it('ajoute un saut de ligne devant si on n’est pas en début de ligne', () => {
    const result = insertTable('texte', { start: 5, end: 5 });
    expect(result.text.startsWith('texte\n|')).toBe(true);
  });
});
