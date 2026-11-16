import { describe, expect, it } from 'vitest';

import { noteTitlePlacement } from './noteTitle';

describe('noteTitlePlacement', () => {
  it('note markdown : titre dans l’éditeur', () => {
    expect(noteTitlePlacement('markdown')).toBe('content');
  });

  it('autres fichiers : titre dans l’en-tête', () => {
    for (const kind of ['canvas', 'chart', 'excalidraw', 'code'] as const) {
      expect(noteTitlePlacement(kind)).toBe('header');
    }
  });
});
