import { describe, expect, it } from 'vitest';

import { collectFolderRelPaths } from './treeExpansion';

// VaultTreeNode est un type ambiant (declare global dans types/global.d.ts) —
// les arbres minimes ci-dessous sont fabriqués à la main.

describe('collectFolderRelPaths', () => {
  it('renvoie tous les dossiers, imbriqués compris, dans l’ordre de parcours', () => {
    const tree: VaultTreeNode[] = [
      {
        type: 'folder',
        relPath: 'Notes',
        name: 'Notes',
        children: [
          { type: 'note', relPath: 'Notes/a.md', name: 'a', kind: 'markdown', modifiedAt: 1 },
          {
            type: 'folder',
            relPath: 'Notes/Sous-dossier',
            name: 'Sous-dossier',
            children: [],
          },
        ],
      },
      { type: 'note', relPath: 'racine.md', name: 'racine', kind: 'markdown', modifiedAt: 2 },
    ];
    expect(collectFolderRelPaths(tree)).toEqual(['Notes', 'Notes/Sous-dossier']);
  });

  it('renvoie un tableau vide pour un arbre sans dossier', () => {
    const tree: VaultTreeNode[] = [
      { type: 'note', relPath: 'seule.md', name: 'seule', kind: 'markdown', modifiedAt: 1 },
    ];
    expect(collectFolderRelPaths(tree)).toEqual([]);
  });

  it('renvoie un tableau vide pour un arbre vide', () => {
    expect(collectFolderRelPaths([])).toEqual([]);
  });
});
