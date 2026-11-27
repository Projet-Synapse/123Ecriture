import { beforeEach, describe, expect, it } from 'vitest';

import { splitMatchSegments } from '../notes/searchResults';
import { clearVaultSearchCache, findFolded, foldForSearch, searchVault, type VaultSearchSource } from './vaultSearch';

const nfd = (s: string) => s.normalize('NFD');

function note(relPath: string, modifiedAt = 1): VaultNoteNode {
  const file = relPath.split('/').pop() ?? relPath;
  return { type: 'note', relPath, name: file.replace(/\.[^.]+$/, ''), kind: 'markdown', modifiedAt };
}

// Coffre façon SAF : noms avec emoji, accents en NFD (forme renvoyée par
// certains fournisseurs Android).
const tree: VaultTreeNode[] = [
  {
    type: 'folder',
    relPath: nfd('0. ⚙️ BASE'),
    name: nfd('0. ⚙️ BASE'),
    children: [note(nfd("0. ⚙️ BASE/👋🌍 Guide d'expertise en worldbuilding.mdx")), note(nfd('0. ⚙️ BASE/Économie.md'))],
  },
  { type: 'folder', relPath: '.123ecriture', name: '.123ecriture', children: [note('.123ecriture/caché.md')] },
  note('Journal.md'),
];

const files: Record<string, string> = {
  [nfd("0. ⚙️ BASE/👋🌍 Guide d'expertise en worldbuilding.mdx")]: '# Guide\nLes dragons.',
  [nfd('0. ⚙️ BASE/Économie.md')]: '---\nstatut: brouillon\n---\nLa monnaie des elfes. #Géopolitique',
  'Journal.md': 'Aujourd’hui, j’ai écrit sur l’ÉCONOMIE du royaume.',
};

let reads = 0;
const source: VaultSearchSource = {
  listTree: async () => tree,
  readNote: async (p) => {
    reads += 1;
    if (!(p in files)) throw new Error('absent');
    return files[p];
  },
  listTasks: async () => [
    { id: 't1', text: 'Relire le guide', listId: 'l', description: '', done: false, createdAt: '', subtasks: [], attachments: [] } as Task,
  ],
  listEvents: async () => [{ id: 'e1', title: 'Atelier écriture', date: '2026-12-01' } as CalendarEvent],
};

beforeEach(() => {
  clearVaultSearchCache();
  reads = 0;
});

describe('repli de texte', () => {
  it('casse, accents, NFC/NFD, apostrophes ; emoji conservés', () => {
    expect(foldForSearch('ÉCONOMIE')).toBe('economie');
    expect(foldForSearch(nfd('Économie'))).toBe(foldForSearch('Économie'));
    expect(foldForSearch('l’ÉTÉ')).toBe("l'ete");
    expect(foldForSearch('⚙️ BASE')).toBe('⚙️ base');
    expect(findFolded(nfd('Économie'), 'eco')).toEqual({ index: 0, length: 4 });
  });
});

describe('searchVault (Android)', () => {
  it('trouve un fichier par son nom, emoji et NFD compris', async () => {
    for (const q of ['worldbuilding', "Guide d'expertise", 'guide d’expertise', '👋🌍', 'worldbuilding.mdx']) {
      const r = await searchVault(source, q);
      expect(r[0]).toMatchObject({ matchType: 'title', kind: 'markdown' });
      expect(r[0].relPath).toContain('worldbuilding');
    }
  });

  it('dossier avec emoji, accents ignorés', async () => {
    expect((await searchVault(source, '⚙️ base'))[0]).toMatchObject({ kind: 'folder' });
    expect((await searchVault(source, '0. ⚙️ BASE'))[0]).toMatchObject({ kind: 'folder' });
    const eco = await searchVault(source, 'economie');
    expect(eco[0]).toMatchObject({ matchType: 'title', name: nfd('Économie') });
    expect(eco.find((r) => r.relPath === 'Journal.md')).toMatchObject({ matchType: 'content' });
    expect(eco.find((r) => r.relPath === 'Journal.md')?.snippet).toContain('ÉCONOMIE');
  });

  it('mots-clés, tâches, évènements ; caché ignoré ; vide = rien', async () => {
    expect((await searchVault(source, 'geopolitique'))[0]).toMatchObject({ matchType: 'tag' });
    expect((await searchVault(source, 'guide')).map((r) => r.kind)).toContain('task');
    expect((await searchVault(source, 'ecriture')).map((r) => r.kind)).toContain('calendar-event');
    expect(await searchVault(source, 'caché')).toEqual([]);
    expect(await searchVault(source, '   ')).toEqual([]);
  });

  it('filtre par propriété', async () => {
    const r = await searchVault(source, '', { propertyId: 'statut', propertyValue: 'BROUILLON' });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ matchType: 'property' });
  });

  it('contenu mis en cache entre deux frappes', async () => {
    await searchVault(source, 'dragon');
    const first = reads;
    await searchVault(source, 'dragons');
    expect(reads).toBe(first);
  });
});

describe('surlignage replié', () => {
  it('surligne malgré accents et NFD', () => {
    expect(splitMatchSegments('L’Économie', 'economie')).toEqual([
      { text: 'L’', isMatch: false },
      { text: 'Économie', isMatch: true },
    ]);
    const segs = splitMatchSegments(nfd('Économie'), 'eco');
    expect(segs[0]).toEqual({ text: nfd('Éco'), isMatch: true });
  });
});
