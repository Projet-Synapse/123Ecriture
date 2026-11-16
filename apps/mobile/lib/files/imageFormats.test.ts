import { describe, expect, it } from 'vitest';

import {
  fileExtension,
  IMAGE_EXTENSIONS,
  imageSupport,
  isImageFile,
  mimeTypeForFile,
  svgTextFromDataUrl,
  unsupportedImageMessage,
  withImageMime,
} from './imageFormats';

describe('imageFormats', () => {
  it('reconnaît tous les formats demandés, casse ignorée', () => {
    for (const ext of [
      'jpg',
      'jpeg',
      'jfif',
      'pjpeg',
      'pjp',
      'png',
      'apng',
      'gif',
      'webp',
      'avif',
      'bmp',
      'ico',
      'cur',
      'svg',
      'tif',
      'tiff',
      'heic',
      'heif',
    ]) {
      expect(isImageFile(`Pièces jointes/photo.${ext.toUpperCase()}`)).toBe(true);
      expect(IMAGE_EXTENSIONS).toContain(`.${ext}`);
    }
    expect(isImageFile('téléchargement.jfif')).toBe(true);
    expect(isImageFile('note.md')).toBe(false);
    expect(isImageFile('sans-extension')).toBe(false);
    expect(isImageFile('dossier.png/fichier')).toBe(false);
  });

  it('types MIME', () => {
    expect(mimeTypeForFile('a.jfif')).toBe('image/jpeg');
    expect(mimeTypeForFile('a.pjp')).toBe('image/jpeg');
    expect(mimeTypeForFile('a.svg')).toBe('image/svg+xml');
    expect(mimeTypeForFile('a.avif')).toBe('image/avif');
    expect(mimeTypeForFile('a.ico')).toBe('image/x-icon');
    expect(mimeTypeForFile('a.tif')).toBe('image/tiff');
    expect(mimeTypeForFile('a.HEIC')).toBe('image/heic');
    expect(mimeTypeForFile('a.mp3')).toBe('audio/mpeg');
    expect(mimeTypeForFile('a.xyz')).toBe('application/octet-stream');
  });

  it('fileExtension', () => {
    expect(fileExtension('a/b/c.d/photo.JPG')).toBe('.jpg');
    expect(fileExtension('a\\b\\photo.png')).toBe('.png');
    expect(fileExtension('README')).toBe('');
  });

  it('withImageMime corrige une data URL générique sans toucher aux données', () => {
    expect(withImageMime('data:application/octet-stream;base64,AAAA', 'x.jfif')).toBe('data:image/jpeg;base64,AAAA');
    expect(withImageMime('data:;base64,AAAA', 'x.webp')).toBe('data:image/webp;base64,AAAA');
    expect(withImageMime('data:image/png;base64,AAAA', 'x.jfif')).toBe('data:image/png;base64,AAAA');
    expect(withImageMime('data:application/octet-stream;base64,AAAA', 'x.pdf')).toBe('data:application/octet-stream;base64,AAAA');
  });

  it('prise en charge par moteur et message de repli', () => {
    expect(imageSupport('a.jfif', 'browser')).toBe('yes');
    expect(imageSupport('a.tiff', 'browser')).toBe('maybe');
    expect(imageSupport('a.tiff', 'native')).toBe('no');
    expect(imageSupport('a.txt', 'native')).toBe('no');
    expect(unsupportedImageMessage('scan.tif', 'browser')).toBe('Format TIFF non affichable dans ce navigateur.');
    expect(unsupportedImageMessage('IMG.HEIC', 'native')).toBe('Format HEIC non affichable sur cet appareil.');
  });
});

describe('svgTextFromDataUrl', () => {
  it('décode base64 UTF-8 et data URL en clair', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><text>été</text></svg>';
    const base64 = Buffer.from(svg, 'utf8').toString('base64');
    expect(svgTextFromDataUrl(`data:image/svg+xml;base64,${base64}`)).toBe(svg);
    expect(svgTextFromDataUrl(`data:image/svg+xml,${encodeURIComponent(svg)}`)).toBe(svg);
    expect(svgTextFromDataUrl('pas une data url')).toBeNull();
  });
});
