import { describe, expect, it } from 'vitest';

import { resolveNewNoteParent, wikilinkCreationTarget } from './newNotePath';

describe('resolveNewNoteParent — réglage « emplacement des nouvelles notes »', () => {
  it('racine du coffre', () => {
    expect(resolveNewNoteParent('vaultRoot', 'Inbox', 'Monde/Aria.mdx')).toBeUndefined();
  });

  it('dossier de la note courante', () => {
    expect(resolveNewNoteParent('sameFolder', '', 'Monde/Lieux/Port.mdx')).toBe('Monde/Lieux');
    expect(resolveNewNoteParent('sameFolder', '', 'Accueil.mdx')).toBeUndefined();
    expect(resolveNewNoteParent('sameFolder', '', null)).toBeUndefined();
  });

  it('dossier fixe, normalisé', () => {
    expect(resolveNewNoteParent('custom', 'Inbox', null)).toBe('Inbox');
    expect(resolveNewNoteParent('custom', ' /Notes\\Nouvelles/ ', null)).toBe('Notes/Nouvelles');
    expect(resolveNewNoteParent('custom', '', null)).toBeUndefined();
  });
});

describe('wikilinkCreationTarget — fiche créée au clic sur un lien', () => {
  it('nom seul → dossier du réglage', () => {
    expect(wikilinkCreationTarget('Nouvelle fiche', 'Inbox')).toEqual({ parentRelPath: 'Inbox', name: 'Nouvelle fiche' });
    expect(wikilinkCreationTarget('Nouvelle fiche', undefined)).toEqual({ parentRelPath: undefined, name: 'Nouvelle fiche' });
  });

  it('sans alias, ancre ni extension', () => {
    expect(wikilinkCreationTarget('Aria#Enfance|la héroïne', 'Inbox')).toEqual({ parentRelPath: 'Inbox', name: 'Aria' });
    expect(wikilinkCreationTarget('Aria#^bloc', undefined)).toEqual({ parentRelPath: undefined, name: 'Aria' });
    expect(wikilinkCreationTarget('Aria.md', 'Inbox')).toEqual({ parentRelPath: 'Inbox', name: 'Aria' });
    expect(wikilinkCreationTarget('  Aria.MDX  ', 'Inbox')).toEqual({ parentRelPath: 'Inbox', name: 'Aria' });
  });

  it('chemin explicite gardé (prioritaire sur le réglage)', () => {
    expect(wikilinkCreationTarget('Monde/Lieux/Port', 'Inbox')).toEqual({ parentRelPath: 'Monde/Lieux', name: 'Port' });
    expect(wikilinkCreationTarget('Monde\\Port#Quais|le port', 'Inbox')).toEqual({ parentRelPath: 'Monde', name: 'Port' });
    expect(wikilinkCreationTarget('/Port', 'Inbox')).toEqual({ parentRelPath: undefined, name: 'Port' });
  });

  it('chemins relatifs à la note courante', () => {
    expect(wikilinkCreationTarget('./Port', 'Inbox', 'Monde/Aria.mdx')).toEqual({ parentRelPath: 'Monde', name: 'Port' });
    expect(wikilinkCreationTarget('../Port', 'Inbox', 'Monde/Lieux/Aria.mdx')).toEqual({ parentRelPath: 'Monde', name: 'Port' });
    expect(wikilinkCreationTarget('./Port', 'Inbox', 'Aria.mdx')).toEqual({ parentRelPath: undefined, name: 'Port' });
  });

  it('cible vide ou hors du coffre → rien', () => {
    expect(wikilinkCreationTarget('#Titre', 'Inbox')).toBeNull();
    expect(wikilinkCreationTarget('  ', 'Inbox')).toBeNull();
    expect(wikilinkCreationTarget('../Port', 'Inbox', 'Aria.mdx')).toBeNull();
    expect(wikilinkCreationTarget('Dossier/', 'Inbox')).toEqual({ parentRelPath: undefined, name: 'Dossier' });
  });
});
