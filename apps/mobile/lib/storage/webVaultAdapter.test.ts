import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeFs } from './fakeFsa';
import { webVaultAdapter } from './webVaultAdapter';
import { webVaultRegistry } from './webVaultRegistry';

// Le registre web persiste en IndexedDB : mock du module webIdb avec deux
// Maps en mémoire — tout le flux registre + pont vault est ainsi testé en
// passant par les API publiques (addExisting = le flux réel sans le
// sélecteur natif du navigateur).
vi.mock('./webIdb', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./webIdb')>();
  const vaults = new Map<IDBValidKey, unknown>();
  const meta = new Map<IDBValidKey, unknown>();
  return {
    ...actual,
    VAULTS_STORE: actual.VAULTS_STORE,
    META_STORE: actual.META_STORE,
    idbPut: vi.fn(async (storeName: string, value: unknown, key?: IDBValidKey) => {
      const store = storeName === actual.VAULTS_STORE ? vaults : meta;
      const entryKey = storeName === actual.VAULTS_STORE ? (value as { id: string }).id : (key as string);
      store.set(entryKey, value);
    }),
    idbGet: vi.fn(async (storeName: string, key: IDBValidKey) => {
      const store = storeName === actual.VAULTS_STORE ? vaults : meta;
      return store.get(key);
    }),
    idbGetAll: vi.fn(async (storeName: string) => {
      const store = storeName === actual.VAULTS_STORE ? vaults : meta;
      return [...store.values()];
    }),
    idbDelete: vi.fn(async (storeName: string, key: IDBValidKey) => {
      (storeName === actual.VAULTS_STORE ? vaults : meta).delete(key);
    }),
  };
});

// localStorage n'existe pas sous Node : stub minimal (les fonctions de
// lecture de préférences web tombent sinon sur les défauts via leur
// try/catch — on le fournit pour tester aussi les valeurs stockées).
const localStorageMock = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (key: string) => localStorageMock.get(key) ?? null,
  setItem: (key: string, value: string) => localStorageMock.set(key, value),
  removeItem: (key: string) => localStorageMock.delete(key),
});

// window.confirm/showDirectoryPicker n'existent que dans le navigateur —
// stub pour les chemins de suppression et de choix de dossier.
const confirmMock = vi.fn(() => true);
vi.stubGlobal('window', {
  confirm: confirmMock,
  showDirectoryPicker: vi.fn(),
  showOpenFilePicker: vi.fn(),
});

let fs: FakeFs;

async function setupVault(): Promise<void> {
  fs = new FakeFs();
  fs.addFile('déjà-là.mdx', '---\ntitle: déjà-là\n---\n\nancien');
  await webVaultRegistry.addExisting(fs.root());
}

beforeEach(async () => {
  localStorageMock.clear();
  confirmMock.mockClear();
  await setupVault();
});

describe('webVaultAdapter — sans coffre actif', () => {
  it('listTree renvoie [] et readNote lève "Aucun vault sélectionné"', async () => {
    for (const entry of webVaultRegistry.toEntries()) {
      await webVaultRegistry.remove(entry.id);
    }
    expect(await webVaultAdapter.listTree()).toEqual([]);
    await expect(webVaultAdapter.readNote('déjà-là.mdx')).rejects.toThrow('Aucun vault sélectionné');
  });
});

describe('webVaultAdapter — arborescence et lecture', () => {
  it('liste les notes reconnues par extension, ignore les cachés et les autres', async () => {
    fs.addDir('Journal');
    fs.addFile('Journal/2026-09-15.mdx', '---\ntitle: x\n---\n\n# Jour');
    fs.addFile('.123ecriture/state.json', '{}');
    fs.addFile('image.png', 'bin');

    const tree = await webVaultAdapter.listTree();
    const names = tree.map((node) => node.name);
    expect(names).toContain('déjà-là');
    expect(names).toContain('Journal');
    expect(names).not.toContain('state.json');
    expect(names).not.toContain('image.png');

    const journal = tree.find((node) => node.name === 'Journal');
    expect(journal?.type).toBe('folder');
    expect(await webVaultAdapter.readNote('Journal/2026-09-15.mdx')).toContain('# Jour');
  });

  it('writeNote puis readNote font l’aller-retour', async () => {
    await webVaultAdapter.writeNote('brouillon.mdx', '# Coucou');
    expect(await webVaultAdapter.readNote('brouillon.mdx')).toBe('# Coucou');
  });
});

describe('webVaultAdapter — création', () => {
  it('createNote applique le gabarit frontmatter et dédoublonne (" 2")', async () => {
    const first = await webVaultAdapter.createNote('Idée');
    expect(first.kind).toBe('markdown');
    expect(first.relPath).toBe('Idée.mdx');
    expect(fs.contentOf('Idée.mdx')).toContain('title: Idée');

    const second = await webVaultAdapter.createNote('Idée');
    expect(second.relPath).toBe('Idée 2.mdx');
  });

  it('createNote crée dans le dossier parent demandé (kind canvas = gabarit JSON)', async () => {
    const entry = await webVaultAdapter.createNote('Tableau', 'Journal', 'canvas');
    expect(entry.relPath).toBe('Journal/Tableau.canvas');
    expect(JSON.parse(fs.contentOf('Journal/Tableau.canvas'))).toEqual({ nodes: [], edges: [] });
  });

  it('createFolder dédoublonne', async () => {
    fs.addDir('Projets');
    const created = await webVaultAdapter.createFolder('Projets');
    expect(created.name).toBe('Projets 2');
    expect(fs.has('Projets 2')).toBe(true);
  });

  it('duplicate suffixe " (copie)" dans le même dossier', async () => {
    fs.addFile('Gabarit.mdx', 'modèle');
    const copy = await webVaultAdapter.duplicate('Gabarit.mdx');
    expect(copy.name).toBe('Gabarit (copie)');
    expect(fs.contentOf('Gabarit (copie).mdx')).toBe('modèle');
    expect(fs.contentOf('Gabarit.mdx')).toBe('modèle');
  });

  it('ensureDailyNote crée Journal/AAAA-MM-JJ.mdx une seule fois', async () => {
    const first = await webVaultAdapter.ensureDailyNote('2026-09-15');
    expect(first.relPath).toBe('Journal/2026-09-15.mdx');
    expect(fs.contentOf('Journal/2026-09-15.mdx')).toContain('title: 2026-09-15');

    await expect(webVaultAdapter.ensureDailyNote('15/09/2026')).rejects.toThrow('Date invalide');
    // Idempotent : pas d'écrasement (le contenu restera celui du premier appel).
    await webVaultAdapter.writeNote('Journal/2026-09-15.mdx', 'modifié');
    await webVaultAdapter.ensureDailyNote('2026-09-15');
    expect(fs.contentOf('Journal/2026-09-15.mdx')).toBe('modifié');
  });
});

describe('webVaultAdapter — organisation', () => {
  beforeEach(async () => {
    fs.addDir('Archives');
    fs.addFile('Archives/ancienne.mdx', 'vieille');
    fs.addDir('Journal');
  });

  it('rename préserve l’extension réelle et refuse un nom existant', async () => {
    fs.addFile('mon-canvas.canvas', '{}');
    const renamed = await webVaultAdapter.rename('mon-canvas.canvas', 'mon nouveau canvas');
    expect(renamed.relPath).toBe('mon nouveau canvas.canvas');
    expect(fs.has('mon nouveau canvas.canvas')).toBe(true);
    expect(fs.has('mon-canvas.canvas')).toBe(false);

    fs.addFile('Archives/déjà-là.mdx', 'existante');
    await expect(webVaultAdapter.rename('Archives/ancienne.mdx', 'déjà-là')).rejects.toThrow(
      'existe déjà',
    );
  });

  it('rename retire les séparateurs du nom (jamais un déplacement déguisé)', async () => {
    const renamed = await webVaultAdapter.rename('Archives/ancienne.mdx', 'a/b');
    expect(renamed.relPath).toBe('Archives/ab.mdx');
    await expect(webVaultAdapter.rename('Archives/ab.mdx', '   ')).rejects.toThrow('vide');
  });

  it('move déplace une note vers un dossier et dédoublonne à destination', async () => {
    const moved = await webVaultAdapter.move('déjà-là.mdx', 'Archives');
    expect(moved.relPath).toBe('Archives/déjà-là.mdx');
    expect(fs.has('déjà-là.mdx')).toBe(false);
    expect(fs.contentOf('Archives/déjà-là.mdx')).toContain('ancien');

    // Deuxième déplacement du même nom : dédoublonnage " 2".
    await webVaultAdapter.writeNote('déjà-là.mdx', 'nouvelle');
    const second = await webVaultAdapter.move('déjà-là.mdx', 'Archives');
    expect(second.relPath).toBe('Archives/déjà-là 2.mdx');
  });

  it('move refuse de déplacer un dossier dans lui-même ou un sous-dossier', async () => {
    fs.addDir('Archives/sous-dossier');
    await expect(webVaultAdapter.move('Archives', 'Archives/sous-dossier')).rejects.toThrow(
      'dans lui-même',
    );
  });

  it('move vers le dossier d’origine est un no-op (pas de " 2" erroné)', async () => {
    const result = await webVaultAdapter.move('Archives/ancienne.mdx', 'Archives');
    expect(result.relPath).toBe('Archives/ancienne.mdx');
    expect(fs.has('Archives/ancienne 2.mdx')).toBe(false);
  });

  it('move déplace un dossier entier (récursif)', async () => {
    fs.addFile('Journal/2026-09-15.mdx', '# jour');
    await webVaultAdapter.move('Journal', 'Archives');
    expect(fs.has('Journal')).toBe(false);
    expect(fs.contentOf('Archives/Journal/2026-09-15.mdx')).toBe('# jour');
  });

  it('setPath crée les dossiers intermédiaires et refuse une collision', async () => {
    const moved = await webVaultAdapter.setPath('déjà-là.mdx', 'Profond/Nested/nouvelle-place');
    expect(moved.relPath).toBe('Profond/Nested/nouvelle-place.mdx');
    expect(fs.contentOf('Profond/Nested/nouvelle-place.mdx')).toContain('ancien');

    fs.addFile('Profond/Nested/déjà-là.mdx', 'autre');
    await expect(webVaultAdapter.setPath('Archives/ancienne.mdx', 'Profond/Nested/déjà-là')).rejects.toThrow(
      'existe déjà',
    );
  });

  it('setPath refuse les chemins invalides et la traversée', async () => {
    await expect(webVaultAdapter.setPath('déjà-là.mdx', '')).rejects.toThrow('vide');
    await expect(webVaultAdapter.setPath('déjà-là.mdx', 'a/../b')).rejects.toThrow('Chemin invalide');
    await expect(webVaultAdapter.readNote('../../etc/passwd')).rejects.toThrow('hors du vault');
  });

  it('delete demande confirmation, supprime le dossier récursivement, annule si refus', async () => {
    fs.addFile('Archives/sous/encore.mdx', 'x');

    confirmMock.mockReturnValueOnce(false);
    const cancelled = await webVaultAdapter.delete('Archives');
    expect(cancelled).toEqual({ deleted: false });
    expect(fs.has('Archives/ancienne.mdx')).toBe(true);

    const deleted = await webVaultAdapter.delete('Archives');
    expect(deleted).toEqual({ deleted: true });
    expect(fs.has('Archives')).toBe(false);
    // v0.4.26 : le dossier part dans la corbeille locale, rien n'est détruit.
    expect(fs.has('.trash/Archives/ancienne.mdx')).toBe(true);
  });

  it('delete silent (synchro) : aucune confirmation, corbeille et élagage des dossiers vides', async () => {
    fs.addDir('BMO');
    fs.addDir('BMO/Profiles');
    fs.addFile('BMO/Profiles/BMO.mdx', 'x');

    const deleted = await webVaultAdapter.delete('BMO/Profiles/BMO.mdx', { silent: true });
    expect(deleted).toEqual({ deleted: true });
    expect(confirmMock).not.toHaveBeenCalled();
    expect(fs.has('BMO')).toBe(false);
    expect(fs.has('.trash/BMO/Profiles/BMO.mdx')).toBe(true);
  });

  it('delete silent conserve le dossier tant qu’un frère y vit', async () => {
    fs.addDir('BMO');
    fs.addDir('BMO/Profiles');
    fs.addFile('BMO/Profiles/BMO.mdx', 'x');
    fs.addFile('BMO/autre.mdx', 'y');

    await webVaultAdapter.delete('BMO/Profiles/BMO.mdx', { silent: true });
    expect(fs.has('BMO/Profiles')).toBe(false);
    expect(fs.has('BMO/autre.mdx')).toBe(true);
    expect(fs.has('BMO')).toBe(true);
    expect(fs.has('.trash/BMO/Profiles/BMO.mdx')).toBe(true);
  });

  it('delete permanent détruit réellement (pas de corbeille)', async () => {
    fs.addFile('Pour de bon.mdx', 'x');
    const deleted = await webVaultAdapter.delete('Pour de bon.mdx', { silent: true, permanent: true });
    expect(deleted).toEqual({ deleted: true });
    expect(fs.has('Pour de bon.mdx')).toBe(false);
    expect(fs.has('.trash/Pour de bon.mdx')).toBe(false);
  });
});

describe('webVaultAdapter — état par coffre (state.json)', () => {
  it('lastOpened et collapsed partagent le même fichier en read-modify-write', async () => {
    await webVaultAdapter.setLastOpened('déjà-là.mdx');
    await webVaultAdapter.setCollapsedPaths(['Journal', 'Archives']);

    expect(await webVaultAdapter.getLastOpened()).toBe('déjà-là.mdx');
    expect(await webVaultAdapter.getCollapsedPaths()).toEqual(['Journal', 'Archives']);

    const raw = JSON.parse(fs.contentOf('.123ecriture/state.json'));
    expect(raw).toEqual({
      lastOpenedRelPath: 'déjà-là.mdx',
      collapsedRelPaths: ['Journal', 'Archives'],
    });

    await webVaultAdapter.setLastOpened(null);
    // Le champ collapsed survit à l'écriture du champ lastOpened.
    expect(await webVaultAdapter.getCollapsedPaths()).toEqual(['Journal', 'Archives']);
    expect(await webVaultAdapter.getLastOpened()).toBeNull();
  });

  it('reorder persiste l’ordre manuel et renvoie l’arbre à jour', async () => {
    // Le drag n'est possible dans l'UI qu'une fois le mode "Manuel" choisi —
    // même contrat que desktop : l'ordre enregistré n'apparaît dans
    // l'arborescence qu'en mode 'manual'. Les notes absentes de l'ordre
    // (déjà-là.mdx du coffre de départ) restent à la suite.
    localStorageMock.set('123ecriture.preferences', JSON.stringify({ fileSortMode: 'manual' }));
    fs.addFile('a.mdx', '');
    fs.addFile('b.mdx', '');
    const tree = await webVaultAdapter.reorder(undefined, ['b', 'a']);
    expect(tree.map((node) => node.name)).toEqual(['b', 'a', 'déjà-là']);

    // Mode de tri autre que 'manual' : l'ordre enregistré est ignoré (mais
    // pas supprimé — re-choisir 'manual' le restaure).
    localStorageMock.set('123ecriture.preferences', JSON.stringify({ fileSortMode: 'alphabetical' }));
    const treeAlpha = await webVaultAdapter.listTree();
    expect(treeAlpha.map((node) => node.name)).toEqual(['a', 'b', 'déjà-là']);

    localStorageMock.set('123ecriture.preferences', JSON.stringify({ fileSortMode: 'manual' }));
    const treeManual = await webVaultAdapter.listTree();
    expect(treeManual.map((node) => node.name)).toEqual(['b', 'a', 'déjà-là']);
  });
});
