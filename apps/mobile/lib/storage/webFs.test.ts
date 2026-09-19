import { describe, expect, it } from 'vitest';

import {
  applyManualOrder,
  copyDirectoryInto,
  entryExists,
  findAvailableName,
  getDirByRelPath,
  listNoteRelPaths,
  pruneEmptyAncestors,
  readFileText,
  removeEntryRecursive,
  sortNodes,
  splitRelPath,
} from './webFs';
import { FakeFs } from './fakeFsa';

// Tests de la couche fichiers web (webFs.ts) — garde-fous de chemins,
// dédoublonnage de noms, tris et copie récursive. Le système de fichiers
// est le faux FSA en mémoire (fakeFsa.ts).

describe('splitRelPath', () => {
  it('accepte un chemin simple et un chemin imbriqué', () => {
    expect(splitRelPath('note.mdx')).toEqual(['note.mdx']);
    expect(splitRelPath('Journal/2026-09-15.mdx')).toEqual(['Journal', '2026-09-15.mdx']);
  });

  it('refuse la traversée hors du vault et les chemins absolus, accepte la racine', () => {
    expect(() => splitRelPath('../etc/passwd')).toThrow('hors du vault');
    expect(() => splitRelPath('notes/../secret.mdx')).toThrow('hors du vault');
    expect(() => splitRelPath('/absolu.mdx')).toThrow('hors du vault');
    expect(splitRelPath('')).toEqual([]);
  });
});

describe('entryExists / findAvailableName', () => {
  it('détecte fichiers et dossiers existants', async () => {
    const fs = new FakeFs();
    fs.addFile('note.mdx', 'coucou');
    fs.addDir('Journal');
    const root = fs.root();
    expect(await entryExists(root, 'note.mdx')).toBe(true);
    expect(await entryExists(root, 'Journal')).toBe(true);
    expect(await entryExists(root, 'absente.mdx')).toBe(false);
  });

  it('suffixe " 2", " 3"... en cas de collision (fichiers et dossiers)', async () => {
    const fs = new FakeFs();
    fs.addFile('note.mdx', 'a');
    fs.addFile('note 2.mdx', 'b');
    fs.addDir('Journal');
    fs.addDir('Journal 2');
    const root = fs.root();

    const dir = await getDirByRelPath(root, '');
    expect(await findAvailableName(dir, 'note', '.mdx')).toBe('note 3.mdx');
    expect(await findAvailableName(dir, 'Journal')).toBe('Journal 3');
    expect(await findAvailableName(dir, 'libre', '.mdx')).toBe('libre.mdx');
  });
});

describe('getDirByRelPath / readFileText', () => {
  it('lit un fichier imbriqué', async () => {
    const fs = new FakeFs();
    fs.addDir('A');
    fs.addFile('A/note.mdx', 'contenu');
    const root = fs.root();
    expect(await readFileText(root, 'A/note.mdx')).toBe('contenu');
  });

  it('crée les dossiers intermédiaires avec create=true', async () => {
    const fs = new FakeFs();
    const root = fs.root();
    await getDirByRelPath(root, 'X/Y/Z', true);
    expect(fs.has('X/Y/Z')).toBe(true);
  });
});

describe('sortNodes / applyManualOrder', () => {
  const nodes = [
    { type: 'note' as const, name: 'zèbre', modifiedAt: 900 },
    { type: 'folder' as const, name: 'Aa' },
    { type: 'note' as const, name: 'Anna', modifiedAt: 300 },
    { type: 'note' as const, name: 'Bulles', modifiedAt: 200 },
  ];

  it('met les dossiers d’abord puis tri alphabétique fr', () => {
    const sorted = sortNodes(nodes, 'alphabetical');
    expect(sorted.map((node) => node.name)).toEqual(['Aa', 'Anna', 'Bulles', 'zèbre']);
  });

  it('trie les notes du plus récent au plus ancien en mode recent', () => {
    const sorted = sortNodes(nodes, 'recent');
    expect(sorted.map((node) => node.name)).toEqual(['Aa', 'zèbre', 'Anna', 'Bulles']);
  });

  it('trie les notes du plus ancien au plus récent en mode oldest', () => {
    const sorted = sortNodes(nodes, 'oldest');
    expect(sorted.map((node) => node.name)).toEqual(['Aa', 'Bulles', 'Anna', 'zèbre']);
  });

  it('applique l’ordre manuel en gardant les absents à la suite (tri stable)', () => {
    const ordered = applyManualOrder(sortNodes(nodes, 'manual'), ['Bulles', 'Anna']);
    expect(ordered.map((node) => node.name)).toEqual(['Bulles', 'Anna', 'Aa', 'zèbre']);
  });
});

describe('listNoteRelPaths', () => {
  it('liste .mdx/.md mais ni les cachés ni les autres extensions', async () => {
    const fs = new FakeFs();
    fs.addFile('racine.mdx', '');
    fs.addDir('Journal');
    fs.addFile('Journal/2026-09-15.md', '');
    fs.addFile('.123ecriture/state.json', '{}');
    fs.addFile('image.png', '');
    const paths = await listNoteRelPaths(fs.root(), ['.mdx', '.md']);
    expect(paths).toEqual(['Journal/2026-09-15.md', 'racine.mdx']);
  });
});

describe('pruneEmptyAncestors', () => {
  it('remonte la chaîne de dossiers vides jusqu’à la racine sans la supprimer', async () => {
    const fs = new FakeFs();
    fs.addDir('BMO');
    fs.addDir('BMO/Profiles');
    fs.addFile('BMO/Profiles/x.md', 'x');
    const root = fs.root();
    const profiles = await getDirByRelPath(root, 'BMO/Profiles');
    await removeEntryRecursive(profiles, 'x.md');

    await pruneEmptyAncestors(root, 'BMO/Profiles');
    expect(fs.has('BMO/Profiles')).toBe(false);
    expect(fs.has('BMO')).toBe(false);
  });

  it('s’arrête au premier dossier non vide (frère conservé)', async () => {
    const fs = new FakeFs();
    fs.addDir('BMO');
    fs.addDir('BMO/Profiles');
    fs.addFile('BMO/Profiles/x.md', 'x');
    fs.addFile('BMO/autre.md', 'y');
    const root = fs.root();
    const profiles = await getDirByRelPath(root, 'BMO/Profiles');
    await removeEntryRecursive(profiles, 'x.md');

    await pruneEmptyAncestors(root, 'BMO/Profiles');
    expect(fs.has('BMO/Profiles')).toBe(false);
    expect(fs.has('BMO/autre.md')).toBe(true);
    expect(fs.has('BMO')).toBe(true);
  });

  it('ne touche jamais un dossier caché', async () => {
    const fs = new FakeFs();
    fs.addDir('.123ecriture');
    fs.addDir('.123ecriture/sous');
    fs.addFile('.123ecriture/sous/x.json', '{}');
    const root = fs.root();
    const sous = await getDirByRelPath(root, '.123ecriture/sous');
    await removeEntryRecursive(sous, 'x.json');

    await pruneEmptyAncestors(root, '.123ecriture/sous');
    expect(fs.has('.123ecriture/sous')).toBe(false);
    expect(fs.has('.123ecriture')).toBe(true);
  });
});

describe('copyDirectoryInto', () => {
  it('copie l’arbre entier (fichiers + sous-dossiers) sans toucher la source', async () => {
    const fs = new FakeFs();
    fs.addDir('Source');
    fs.addDir('Source/sous');
    fs.addFile('Source/note.mdx', 'texte');
    fs.addFile('Source/sous/autre.mdx', 'autre');

    const root = fs.root();
    const source = await getDirByRelPath(root, 'Source');
    await copyDirectoryInto(source, root, 'Copie');

    expect(fs.has('Copie/note.mdx')).toBe(true);
    expect(fs.has('Copie/sous/autre.mdx')).toBe(true);
    expect(fs.contentOf('Copie/note.mdx')).toBe('texte');
    // La source reste intacte (le déplacement web = copie puis suppression).
    expect(fs.has('Source/note.mdx')).toBe(true);
  });
});
