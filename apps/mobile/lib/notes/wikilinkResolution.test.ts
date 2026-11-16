import { describe, expect, it } from 'vitest';

import { createWikilinkResolver, parseWikilinkTarget, resolveWikilink } from './wikilinkResolution';

const NOTES = [
  { relPath: 'Accueil.mdx', name: 'Accueil' },
  { relPath: 'Monde/Personnages/Aria.mdx', name: 'Aria' },
  { relPath: 'Monde/Lieux/Port.md', name: 'Port' },
  { relPath: 'Brouillons/Aria.mdx', name: 'Aria' },
  { relPath: 'Monde/Carte.canvas', name: 'Carte' },
];

describe('parseWikilinkTarget', () => {
  it('retire alias et ancre', () => {
    expect(parseWikilinkTarget('Aria|la héroïne')).toEqual({ path: 'Aria', anchor: null });
    expect(parseWikilinkTarget('Aria#Enfance|texte')).toEqual({ path: 'Aria', anchor: 'Enfance' });
    expect(parseWikilinkTarget('Aria#^bloc1')).toEqual({ path: 'Aria', anchor: '^bloc1' });
    expect(parseWikilinkTarget('#Titre')).toEqual({ path: '', anchor: 'Titre' });
  });

  it('normalise séparateurs et espaces', () => {
    expect(parseWikilinkTarget('  Monde\\Lieux\\Port  ').path).toBe('Monde/Lieux/Port');
    expect(parseWikilinkTarget('/Monde//Lieux/').path).toBe('Monde/Lieux');
  });
});

describe('resolveWikilink — même logique au clic et pour le style', () => {
  it('nom seul, casse ignorée', () => {
    expect(resolveWikilink('accueil', NOTES)).toEqual(NOTES[0]);
    expect(resolveWikilink('PORT', NOTES)).toEqual(NOTES[2]);
  });

  it('alias et ancre ignorés', () => {
    expect(resolveWikilink('Port#Quais|le port', NOTES)).toEqual(NOTES[2]);
  });

  it('extension écrite dans le lien (.md ↔ .mdx interchangeables)', () => {
    expect(resolveWikilink('Accueil.md', NOTES)).toEqual(NOTES[0]);
    expect(resolveWikilink('Accueil.mdx', NOTES)).toEqual(NOTES[0]);
    expect(resolveWikilink('Port.md', NOTES)).toEqual(NOTES[2]);
    expect(resolveWikilink('Carte.canvas', NOTES)).toEqual(NOTES[4]);
  });

  it('homonymes : la note du dossier courant gagne', () => {
    expect(resolveWikilink('Aria', NOTES, 'Brouillons/Idées.mdx')).toEqual(NOTES[3]);
    expect(resolveWikilink('Aria', NOTES, 'Accueil.mdx')).toEqual(NOTES[1]);
  });

  it('chemin depuis la racine, relatif, ou suffixe', () => {
    expect(resolveWikilink('Monde/Lieux/Port', NOTES)).toEqual(NOTES[2]);
    expect(resolveWikilink('monde/lieux/port.md', NOTES)).toEqual(NOTES[2]);
    expect(resolveWikilink('../Lieux/Port', NOTES, 'Monde/Personnages/Aria.mdx')).toEqual(NOTES[2]);
    expect(resolveWikilink('./Aria', NOTES, 'Brouillons/x.mdx')).toEqual(NOTES[3]);
    expect(resolveWikilink('Lieux/Port', NOTES, 'Monde/Index.mdx')).toEqual(NOTES[2]);
    expect(resolveWikilink('Personnages/Aria', NOTES)).toEqual(NOTES[1]);
  });

  it('fiche inexistante → null', () => {
    expect(resolveWikilink('Inconnue', NOTES)).toBeNull();
    expect(resolveWikilink('Monde/Inconnue', NOTES)).toBeNull();
    expect(resolveWikilink('./Port', NOTES, 'Accueil.mdx')).toBeNull();
    expect(resolveWikilink('../../Port', NOTES, 'Accueil.mdx')).toBeNull();
  });

  it('ancre seule = note courante', () => {
    expect(resolveWikilink('#Titre', NOTES, 'Accueil.mdx')).toBe('self');
  });
});

describe('createWikilinkResolver — mise à jour création/renommage/suppression', () => {
  it('un nouvel arbre change le résultat', () => {
    const before = createWikilinkResolver(NOTES);
    expect(before.isResolved('Nouvelle')).toBe(false);
    const created = createWikilinkResolver([...NOTES, { relPath: 'Nouvelle.mdx', name: 'Nouvelle' }]);
    expect(created.isResolved('Nouvelle')).toBe(true);
    const renamed = createWikilinkResolver(
      NOTES.map((note) => (note.name === 'Port' ? { relPath: 'Monde/Lieux/Havre.md', name: 'Havre' } : note)),
    );
    expect(renamed.isResolved('Port')).toBe(false);
    expect(renamed.isResolved('Havre')).toBe(true);
    const deleted = createWikilinkResolver(NOTES.filter((note) => note.name !== 'Accueil'));
    expect(deleted.isResolved('Accueil')).toBe(false);
  });
});
