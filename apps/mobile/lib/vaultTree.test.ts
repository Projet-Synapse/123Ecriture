import { describe, expect, it } from 'vitest';

import { getAncestorRelPaths, getParentRelPath } from './vaultTree';

describe('getParentRelPath', () => {
  it('renvoie undefined à la racine', () => {
    expect(getParentRelPath('Note.mdx')).toBeUndefined();
  });

  it('renvoie le dossier parent direct', () => {
    expect(getParentRelPath('Dossier/SousDossier/Note.mdx')).toBe('Dossier/SousDossier');
  });
});

describe('getAncestorRelPaths', () => {
  it('vide à la racine', () => {
    expect(getAncestorRelPaths('Note.mdx')).toEqual([]);
  });

  it('liste tous les ancêtres, du plus proche au plus éloigné', () => {
    expect(getAncestorRelPaths('Dossier/SousDossier/Note.mdx')).toEqual(['Dossier/SousDossier', 'Dossier']);
  });
});
