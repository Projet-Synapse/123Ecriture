import { describe, expect, it } from 'vitest';

import { aiLockMenuItem, isAiLocked, isDirectlyLocked, lockingPath, normalizeLockedPaths, remapAiLocks, toggleAiLock } from './aiLock';

describe('verrouillage IA', () => {
  const locked = ['Privé', 'Journal/2026/Santé.md'];

  it('hérité par les sous-dossiers, casse et séparateurs ignorés', () => {
    expect(isAiLocked('Privé/Banque/Relevé.md', locked)).toBe(true);
    expect(isAiLocked('privé\\a.md', locked)).toBe(true);
    expect(lockingPath('Privé/x/y.md', locked)).toBe('Privé');
    expect(isAiLocked('Journal/2026/Santé.md', locked)).toBe(true);
    expect(isAiLocked('Journal/2026/Autre.md', locked)).toBe(false);
    expect(isAiLocked('Privé-bis/a.md', locked)).toBe(false);
  });

  it('chemin douteux considéré verrouillé', () => {
    expect(isAiLocked('Public/../Privé/a.md', locked)).toBe(true);
  });

  it('verrouiller / déverrouiller', () => {
    const next = toggleAiLock(locked, 'Projets/');
    expect(next).toEqual(['Privé', 'Journal/2026/Santé.md', 'Projets']);
    expect(isDirectlyLocked('Projets', next)).toBe(true);
    expect(isDirectlyLocked('Projets/a.md', next)).toBe(false);
    expect(toggleAiLock(next, 'projets')).toEqual(locked);
  });

  it('suit renommages et déplacements (élément et descendants)', () => {
    expect(remapAiLocks(locked, 'Privé', 'Archives/Privé')).toEqual(['Archives/Privé', 'Journal/2026/Santé.md']);
    expect(remapAiLocks(locked, 'Journal', 'Carnet')).toEqual(['Privé', 'Carnet/2026/Santé.md']);
    expect(remapAiLocks(locked, 'Journal/2026/Santé.md', 'Journal/2026/Santé.mdx')).toEqual([
      'Privé',
      'Journal/2026/Santé.mdx',
    ]);
    expect(remapAiLocks(locked, 'Autre', 'Ailleurs')).toBe(locked);
  });

  it('réglage tolérant', () => {
    expect(normalizeLockedPaths(['/A/', 'a', 3, '', 'B'])).toEqual(['A', 'B']);
    expect(normalizeLockedPaths(null)).toEqual([]);
  });
});

describe('menu verrouillage', () => {
  it('libellés', () => {
    expect(aiLockMenuItem('Privé', ['Privé']).label).toContain('Déverrouiller');
    expect(aiLockMenuItem('Privé/a.md', ['Privé'])).toEqual({ id: 'ai-lock-inherited', label: '🔒 Verrouillé pour l’IA (dossier « Privé »)' });
    expect(aiLockMenuItem('Public', ['Privé']).id).toBe('toggle-ai-lock');
  });
});
