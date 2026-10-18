import { describe, expect, it } from 'vitest';

import { isImageEmbedTarget, matchesEmbedTarget } from './embedResolution';

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
