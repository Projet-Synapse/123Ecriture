import { describe, expect, it } from 'vitest';

import { applyPathChange, isPathAffected, mergeRestoredOpenTabs } from './openTabs';

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

  it('retire les onglets d’un dossier renommé (nouveau chemin inconnu ici)', () => {
    expect(applyPathChange(tabs, 'Notes/Projet', 'Archives/Projet')).toEqual([
      'Journal/2026-09-15.mdx',
      'Notes/Idée.mdx',
    ]);
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
