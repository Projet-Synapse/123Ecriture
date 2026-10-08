import { describe, expect, it } from 'vitest';

import { CODE_FILE_EXTENSIONS, isCodeFile, languageForFile, languageForExtension } from './codeLanguages';

describe('isCodeFile', () => {
  it('reconnaît les extensions de programmation (casse ignorée)', () => {
    expect(isCodeFile('script.py')).toBe(true);
    expect(isCodeFile('MAIN.TS')).toBe(true);
    expect(isCodeFile('index.mjs')).toBe(true);
    expect(isCodeFile('app.tsx')).toBe(true);
    expect(isCodeFile('Dockerfile')).toBe(true);
  });

  it('rejette notes, dessins et fichiers sans extension', () => {
    expect(isCodeFile('note.mdx')).toBe(false);
    expect(isCodeFile('dessin.excalidraw')).toBe(false);
    expect(isCodeFile('Sans nom')).toBe(false);
  });
});

describe('languageForExtension', () => {
  it('résout les langages dédiés avec parseur (soulignements possibles)', () => {
    expect(languageForExtension('.py')?.parseable).toBe(true);
    expect(languageForExtension('.ts')?.parseable).toBe(true);
    expect(languageForExtension('.tsx')?.parseable).toBe(true);
    expect(languageForExtension('.json')?.parseable).toBe(true);
    expect(languageForExtension('.html')?.parseable).toBe(true);
    expect(languageForExtension('.css')?.parseable).toBe(true);
    expect(languageForExtension('.xml')?.parseable).toBe(true);
    expect(languageForExtension('.sql')?.parseable).toBe(true);
    expect(languageForExtension('.php')?.parseable).toBe(true);
  });

  it('résout les langages legacy (coloration seule)', () => {
    expect(languageForExtension('.c')?.parseable).toBe(false);
    expect(languageForExtension('.cpp')?.parseable).toBe(false);
    expect(languageForExtension('.java')?.parseable).toBe(false);
    expect(languageForExtension('.go')?.parseable).toBe(false);
    expect(languageForExtension('.rs')?.parseable).toBe(false);
    expect(languageForExtension('.sh')?.parseable).toBe(false);
    expect(languageForExtension('.yaml')?.parseable).toBe(false);
    expect(languageForExtension('.toml')?.parseable).toBe(false);
    expect(languageForExtension('.ps1')?.parseable).toBe(false);
  });

  it('retourne null hors du code reconnu', () => {
    expect(languageForExtension('.mdx')).toBeNull();
    expect(languageForExtension('.png')).toBeNull();
    expect(languageForFile('note.mdx')).toBeNull();
  });

  it('TOUTE extension de la liste résout en un langage (jamais de trou)', () => {
    for (const extension of CODE_FILE_EXTENSIONS) {
      expect(languageForExtension(extension), extension).not.toBeNull();
    }
  });

  it('choisit le langage depuis le nom du fichier (renommage → coloration change)', () => {
    expect(languageForFile('nouveau.txt')).toBeNull();
    expect(languageForFile('Sans titre.py')?.parseable).toBe(true);
    expect(languageForFile('SCRIPT.JS')?.parseable).toBe(true);
  });
});
