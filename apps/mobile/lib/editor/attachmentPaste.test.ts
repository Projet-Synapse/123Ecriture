import { describe, expect, it } from 'vitest';

import { embedsText, isAttachmentPaste } from './attachmentPaste';

describe('isAttachmentPaste', () => {
  it('fichier seul (capture, image copiée) → pièce jointe', () => {
    expect(isAttachmentPaste(1, '')).toBe(true);
    expect(isAttachmentPaste(2, '  ')).toBe(true);
  });
  it('texte présent ou aucun fichier → collage de texte ordinaire', () => {
    expect(isAttachmentPaste(1, 'Bonjour')).toBe(false);
    expect(isAttachmentPaste(0, '')).toBe(false);
  });
});

describe('embedsText', () => {
  it('un embed par fichier importé, échecs ignorés', () => {
    expect(embedsText(['photo.jpg', null, 'note vocale.m4a'])).toBe('![[photo.jpg]]\n![[note vocale.m4a]]');
    expect(embedsText([null])).toBe('');
  });
});
