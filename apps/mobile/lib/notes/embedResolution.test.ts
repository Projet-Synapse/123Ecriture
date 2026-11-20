import { describe, expect, it } from 'vitest';

import {
  availableAttachmentName,
  isImageEmbedTarget,
  matchesEmbedTarget,
  normalizeAttachmentsFolder,
  resolveAttachmentTarget,
  safeAttachmentName,
} from './embedResolution';

describe('isImageEmbedTarget', () => {
  it('reconnaît les extensions image (casse ignorée)', () => {
    expect(isImageEmbedTarget('photo.png')).toBe(true);
    expect(isImageEmbedTarget('Photo.JPG')).toBe(true);
    expect(isImageEmbedTarget('a/b/webp.webp')).toBe(true);
    expect(isImageEmbedTarget('dessin.svg')).toBe(true);
  });

  it('rejette ce qui n’est pas une image', () => {
    expect(isImageEmbedTarget('note.mdx')).toBe(false);
    expect(isImageEmbedTarget('son.mp3')).toBe(false);
    expect(isImageEmbedTarget('sans-extension')).toBe(false);
  });
});

describe('matchesEmbedTarget', () => {
  it('matche un chemin exact, casse et séparateurs ignorés', () => {
    expect(matchesEmbedTarget('Pièces jointes/photo.png', 'pieces jointes/Photo.PNG')).toBe(true);
    expect(matchesEmbedTarget('a/b/img.png', 'a\\b\\img.png')).toBe(true);
  });

  it('matche un suffixe de chemin (cible avec dossier → fichier plus profond)', () => {
    expect(matchesEmbedTarget('monde/cartes/plan.png', 'cartes/plan.png')).toBe(true);
  });

  it('retombe sur le nom seul si le dossier de la cible n’existe pas (façon Obsidian : mieux vaut l’homonyme que « introuvable »)', () => {
    expect(matchesEmbedTarget('monde/cartes/plan.png', 'autres/plan.png')).toBe(true);
  });

  it('matche un nom de fichier seul (cible Obsidian `![[image.png]]`)', () => {
    expect(matchesEmbedTarget('importants/divers/image.png', 'image.png')).toBe(true);
  });

  it('ne matche pas un nom différent ni une chaîne vide', () => {
    expect(matchesEmbedTarget('image.png', 'autre.png')).toBe(false);
    expect(matchesEmbedTarget('image.png', '')).toBe(false);
    expect(matchesEmbedTarget('', 'image.png')).toBe(false);
  });
});

describe('pièces jointes importées (v0.4.99)', () => {
  const files = ['Notes/A.md', 'attachments/photo.jpg', 'Médias/img/schéma.png', 'Autre/photo.jpg', 'att/doc.pdf'];

  it('![[nom]] se résout dans le dossier des pièces jointes avant tout homonyme', () => {
    expect(resolveAttachmentTarget('photo.jpg', files)).toBe('attachments/photo.jpg');
    expect(resolveAttachmentTarget('PHOTO.JPG', files, '/attachments/')).toBe('attachments/photo.jpg');
    expect(resolveAttachmentTarget('doc.pdf', files, 'att')).toBe('att/doc.pdf');
  });

  it('chemin exact, ./, %20, suffixe, nom seul ; null si absent', () => {
    expect(resolveAttachmentTarget('Autre/photo.jpg', files)).toBe('Autre/photo.jpg');
    expect(resolveAttachmentTarget('./img/sch%C3%A9ma.png', files)).toBe('Médias/img/schéma.png');
    expect(resolveAttachmentTarget('schéma.png', files)).toBe('Médias/img/schéma.png');
    expect(resolveAttachmentTarget('absent.png', files)).toBeNull();
  });

  it('nom sûr pour ![[...]] et nom de collage horodaté', () => {
    expect(safeAttachmentName('a#b[1]|c^.png')).toBe('a-b-1--c-.png');
    expect(safeAttachmentName('', 'image/jpeg', new Date(2026, 10, 20, 8, 5, 3))).toBe('Collé 20261120-080503.jpg');
  });

  it('collision → suffixe « 2 », « 3 » (casse ignorée)', () => {
    expect(availableAttachmentName('photo.jpg', ['Photo.JPG', 'photo 2.jpg'])).toBe('photo 3.jpg');
    expect(availableAttachmentName('photo.jpg', [])).toBe('photo.jpg');
    expect(normalizeAttachmentsFolder('  ')).toBe('attachments');
  });
});
