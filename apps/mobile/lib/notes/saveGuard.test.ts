import { describe, expect, it } from 'vitest';

import { isPathChanging, shouldWriteSave } from './saveGuard';

describe('saveGuard', () => {
  it("bloque une sauvegarde de l'ancien chemin pendant / après la conversion .md → .mdx", () => {
    const changing = new Set(['Notes/Idée.md']);
    // Pendant le renommage : la note est encore « Idée.md » mais le chemin bouge.
    expect(shouldWriteSave({ targetPath: 'Notes/Idée.md', activePath: 'Notes/Idée.md', changing })).toBe(false);
    // Après : la note ouverte est « Idée.mdx » — un timer de l'ancien chemin n'écrit rien.
    expect(shouldWriteSave({ targetPath: 'Notes/Idée.md', activePath: 'Notes/Idée.mdx', changing: new Set() })).toBe(false);
    // La nouvelle note s'enregistre normalement.
    expect(shouldWriteSave({ targetPath: 'Notes/Idée.mdx', activePath: 'Notes/Idée.mdx', changing: new Set() })).toBe(true);
  });

  it('un dossier parent en cours de déplacement bloque aussi', () => {
    expect(isPathChanging('Notes/Idée.md', new Set(['Notes']))).toBe(true);
    expect(isPathChanging('Notes 2/Idée.md', new Set(['Notes']))).toBe(false);
  });
});
