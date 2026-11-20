import { describe, expect, it } from 'vitest';

import { applyPathChange, isPathAffected, mergeRestoredOpenTabs, remapPath, tabScrollOffset, visibleOpenTabs } from './openTabs';

describe('isPathAffected', () => {
  it('vrai pour l’élément lui-même', () => {
    expect(isPathAffected('Notes/Idée.mdx', 'Notes/Idée.mdx')).toBe(true);
  });

  it('vrai pour un descendant du dossier renommé/déplacé', () => {
    expect(isPathAffected('Notes/Projet/Idée.mdx', 'Notes/Projet')).toBe(true);
  });

  it('faux pour un chemin voisin ou préfixé sans frontière de dossier', () => {
    expect(isPathAffected('Notes/Autre.mdx', 'Notes/Idée.mdx')).toBe(false);
    // « Notes/ProjetX » ne commence PAS par « Notes/Projet/ » : pas concerné.
    expect(isPathAffected('Notes/ProjetX/Idée.mdx', 'Notes/Projet')).toBe(false);
  });
});

describe('applyPathChange', () => {
  const tabs = ['Journal/2026-09-15.mdx', 'Notes/Idée.mdx', 'Notes/Projet/Plan.mdx'];

  it('renomme l’onglet exactement concerné, sans toucher aux autres', () => {
    expect(applyPathChange(tabs, 'Notes/Idée.mdx', 'Notes/Nouvelle idée.mdx')).toEqual([
      'Journal/2026-09-15.mdx',
      'Notes/Nouvelle idée.mdx',
      'Notes/Projet/Plan.mdx',
    ]);
  });

  it('les onglets d’un dossier renommé/déplacé suivent', () => {
    expect(applyPathChange(tabs, 'Notes/Projet', 'Archives/Projet 2')).toEqual([
      'Journal/2026-09-15.mdx',
      'Notes/Idée.mdx',
      'Archives/Projet 2/Plan.mdx',
    ]);
  });

  it('conversion .md → .mdx : jamais de doublon md/mdx', () => {
    expect(applyPathChange(['A.mdx', 'A.md', 'B.md'], 'A.md', 'A.mdx')).toEqual(['A.mdx', 'B.md']);
    expect(applyPathChange(['A.md', 'B.md'], 'A.md', 'A.mdx')).toEqual(['A.mdx', 'B.md']);
  });

  it('supprime l’onglet concerné (et ceux du dossier supprimé)', () => {
    expect(applyPathChange(tabs, 'Notes', null)).toEqual(['Journal/2026-09-15.mdx']);
  });

  it('retourne la MÊME instance si rien ne change (évite un re-render pour rien)', () => {
    expect(applyPathChange(tabs, 'Nulle part/Ailleurs.mdx', 'Nulle part/Vue.mdx')).toBe(tabs);
  });
});

describe('mergeRestoredOpenTabs', () => {
  it('ordre restauré en premier, onglets de session ajoutés à la fin', () => {
    expect(mergeRestoredOpenTabs(['A.mdx', 'B.mdx'], ['C.mdx', 'A.mdx'])).toEqual(['A.mdx', 'B.mdx', 'C.mdx']);
  });

  it('ne duplique jamais un onglet présent des deux côtés', () => {
    expect(mergeRestoredOpenTabs(['A.mdx'], ['A.mdx'])).toEqual(['A.mdx']);
  });

  it('gère une restauration vide (premier lancement du coffre)', () => {
    expect(mergeRestoredOpenTabs([], ['A.mdx', 'B.mdx'])).toEqual(['A.mdx', 'B.mdx']);
  });
});

describe('visibleOpenTabs', () => {
  it('écarte les fichiers disparus et les doublons', () => {
    const exists = (p: string) => p !== 'Supprimé.md';
    expect(visibleOpenTabs(['A.md', 'Supprimé.md', 'A.md', 'B.mdx'], exists)).toEqual(['A.md', 'B.mdx']);
  });
});

describe('remapPath', () => {
  it('fichier, contenu de dossier, suppression, non concerné', () => {
    expect(remapPath('N/a.md', 'N/a.md', 'N/b.md')).toBe('N/b.md');
    expect(remapPath('N/x/a.md', 'N/x', 'M/x')).toBe('M/x/a.md');
    expect(remapPath('N/x/a.md', 'N', null)).toBeNull();
    expect(remapPath('Nx/a.md', 'N', 'M')).toBe('Nx/a.md');
  });
});

describe('tabScrollOffset', () => {
  it('amène l’onglet actif dans la vue', () => {
    expect(tabScrollOffset({ x: 500, width: 120 }, 0, 360)).toBe(500 + 120 + 24 - 360);
    expect(tabScrollOffset({ x: 10, width: 100 }, 200, 360)).toBe(0);
    expect(tabScrollOffset({ x: 100, width: 100 }, 0, 360)).toBeNull();
  });
});
