import { describe, expect, it } from 'vitest';

import { badgeFontSize, badgeTextColor, CANVAS_COLOR, extensionOf, fileIconFor, MD_COLOR, MDX_COLOR } from './fileIcons';

describe('fileIconFor', () => {
  it('canvas : forme distincte, violet', () => {
    expect(fileIconFor('Hiérarchie des Eleven.canvas', 'canvas')).toEqual({ shape: 'canvas', color: CANVAS_COLOR });
  });
  it('md clair avec insigne md, mdx bleu avec insigne mdx', () => {
    expect(fileIconFor('Notes/a.md', 'markdown')).toMatchObject({ shape: 'document', color: MD_COLOR, badge: 'md' });
    expect(fileIconFor('Notes/a.mdx', 'markdown')).toMatchObject({ shape: 'document', color: MDX_COLOR, badge: 'mdx' });
    expect(MD_COLOR).not.toBe(MDX_COLOR);
  });
  it('code : une couleur et des initiales par langage', () => {
    const exts = [
      'py',
      'js',
      'ts',
      'tsx',
      'jsx',
      'html',
      'css',
      'json',
      'yaml',
      'yml',
      'sh',
      'java',
      'c',
      'cpp',
      'cs',
      'go',
      'rs',
      'php',
      'rb',
      'kt',
      'swift',
      'sql',
      'xml',
      'toml',
      'lua',
    ];
    const specs = exts.map((e) => fileIconFor(`src/x.${e}`, 'code'));
    for (const s of specs) {
      expect(s.badge).toBeTruthy();
      expect(s.badge!.length).toBeLessThanOrEqual(4);
    }
    expect(fileIconFor('a.py', 'code')).toMatchObject({ badge: 'py', color: '#3572a5' });
    expect(fileIconFor('a.html', 'code').badge).toBe('html');
    expect(fileIconFor('a.yaml', 'code').badge).toBe('yml');
    // Langages principaux : couleurs toutes différentes.
    const main = [
      'py',
      'js',
      'ts',
      'tsx',
      'jsx',
      'html',
      'css',
      'json',
      'yml',
      'sh',
      'java',
      'c',
      'cpp',
      'cs',
      'go',
      'rs',
      'php',
      'rb',
      'kt',
      'swift',
      'sql',
      'xml',
      'toml',
      'lua',
    ];
    const colors = main.map((e) => fileIconFor(`x.${e}`, 'code').color);
    expect(new Set(colors).size).toBe(colors.length);
  });
  it('repli générique : gris, insigne = extension tronquée', () => {
    expect(fileIconFor('a.unknownext', 'code')).toMatchObject({ shape: 'document', badge: 'unkn' });
    expect(fileIconFor('Makefile', 'code')).toEqual({ shape: 'document', color: '#8a8f98' });
  });
  it('graphique, excalidraw', () => {
    expect(fileIconFor('a.chart', 'chart').shape).toBe('chart');
    expect(fileIconFor('dessin.excalidraw.md', 'excalidraw').shape).toBe('drawing');
  });
});

describe('lisibilité de l’insigne', () => {
  it('texte noir sur fond clair, blanc sur fond sombre', () => {
    expect(badgeTextColor('#e8c400')).toBe('#111114');
    expect(badgeTextColor(MD_COLOR)).toBe('#111114');
    expect(badgeTextColor('#3178c6')).toBe('#ffffff');
  });
  it('police adaptée à la longueur', () => {
    expect(badgeFontSize('md')).toBeGreaterThan(badgeFontSize('mdx'));
    expect(badgeFontSize('mdx')).toBeGreaterThan(badgeFontSize('html'));
  });
  it('extension', () => {
    expect(extensionOf('dossier.v2/Fichier.TS')).toBe('ts');
    expect(extensionOf('.gitignore')).toBe('');
  });
});
