import { describe, expect, it } from 'vitest';

import { diffVault, type LocalHashedNote, type RemoteVaultFile } from './diff';

// Tests de la logique de décision de synchro — voir diff.ts pour pourquoi
// cette fonction en particulier est celle qui mérite le plus de couverture
// (CLAUDE.md : "sauvegarde et gestion des données" est une zone critique).

function local(relPath: string, contentHash: string, modifiedAt: number): LocalHashedNote {
  return { relPath, contentHash, sizeBytes: contentHash.length, modifiedAt };
}

function remote(
  relPath: string,
  contentHash: string,
  updatedAt: string,
  deleted = false,
): RemoteVaultFile {
  return { relPath, contentHash, sizeBytes: contentHash.length, updatedAt, deleted };
}

describe('diffVault', () => {
  it('pousse une note qui n’existe que localement', () => {
    const decisions = diffVault([local('a.mdx', 'h1', 1000)], []);
    expect(decisions).toEqual([{ kind: 'push', relPath: 'a.mdx' }]);
  });

  it('tire une note qui n’existe que côté distant', () => {
    const decisions = diffVault([], [remote('a.mdx', 'h1', '2026-01-01T00:00:00.000Z')]);
    expect(decisions).toEqual([{ kind: 'pull', relPath: 'a.mdx' }]);
  });

  it('ne fait rien si le hash est identique des deux côtés', () => {
    const decisions = diffVault(
      [local('a.mdx', 'same-hash', 1000)],
      [remote('a.mdx', 'same-hash', '2026-01-01T00:00:00.000Z')],
    );
    expect(decisions).toEqual([{ kind: 'noop', relPath: 'a.mdx' }]);
  });

  it('ignore une ligne distante marquée supprimée (repull pas une note "supprimée")', () => {
    const decisions = diffVault([], [remote('a.mdx', 'h1', '2026-01-01T00:00:00.000Z', true)]);
    expect(decisions).toEqual([]);
  });

  it('en conflit sans référence, le cloud est conservé même si le local est plus récent (plus de mtime)', () => {
    const localTime = new Date('2026-01-02T00:00:00.000Z').getTime();
    const decisions = diffVault(
      [local('a.mdx', 'local-hash', localTime)],
      [remote('a.mdx', 'remote-hash', '2026-01-01T00:00:00.000Z')],
    );
    expect(decisions).toEqual([{ kind: 'conflict-pull-wins', relPath: 'a.mdx' }]);
  });

  it('en conflit, le distant gagne si son timestamp est plus récent', () => {
    const localTime = new Date('2026-01-01T00:00:00.000Z').getTime();
    const decisions = diffVault(
      [local('a.mdx', 'local-hash', localTime)],
      [remote('a.mdx', 'remote-hash', '2026-01-02T00:00:00.000Z')],
    );
    expect(decisions).toEqual([{ kind: 'conflict-pull-wins', relPath: 'a.mdx' }]);
  });

  it('en conflit à égalité stricte, conflit prudent (cloud conservé)', () => {
    const sameTime = new Date('2026-01-01T00:00:00.000Z').getTime();
    const decisions = diffVault(
      [local('a.mdx', 'local-hash', sameTime)],
      [remote('a.mdx', 'remote-hash', '2026-01-01T00:00:00.000Z')],
    );
    expect(decisions).toEqual([{ kind: 'conflict-pull-wins', relPath: 'a.mdx' }]);
  });

  it('traite plusieurs notes indépendamment et trie le résultat par chemin', () => {
    const decisions = diffVault(
      [local('z.mdx', 'h1', 1000), local('a.mdx', 'h2', 1000)],
      [remote('m.mdx', 'h3', '2026-01-01T00:00:00.000Z')],
    );
    expect(decisions.map((d) => d.relPath)).toEqual(['a.mdx', 'm.mdx', 'z.mdx']);
  });

  // v0.4.81 — le sync-state comme RÉFÉRENCE (diff à trois voies) : une
  // modification d'un fichier dont le cloud porte encore le hash connu est
  // un PUSH, jamais un conflit (M.4 de la spec ; §12 du journal
  // d'incidents : le classement mtime seul re-déclarait un conflit à
  // chaque modification dès que le mtime du fichier passait devant
  // l'horodatage du dernier push).
  describe('avec la référence du dernier cycle (lastSynced)', () => {
    it('pousse une modification locale pure (le cloud porte encore la référence)', () => {
      const decisions = diffVault(
        [local('a.mdx', 'local-modifie', 2000)],
        [remote('a.mdx', 'reference', '2026-01-01T00:00:00.000Z')],
        { 'a.mdx': 'reference' },
      );
      expect(decisions).toEqual([{ kind: 'push', relPath: 'a.mdx' }]);
    });

    it('tire une modification distante pure (le local porte encore la référence)', () => {
      const decisions = diffVault(
        [local('a.mdx', 'reference', 1000)],
        [remote('a.mdx', 'distant-modifie', '2026-01-02T00:00:00.000Z')],
        { 'a.mdx': 'reference' },
      );
      expect(decisions).toEqual([{ kind: 'pull', relPath: 'a.mdx' }]);
    });

    it('reste un conflit quand local ET distant ont divergé depuis la référence', () => {
      const decisions = diffVault(
        [local('a.mdx', 'local-modifie', 1000)],
        [remote('a.mdx', 'distant-modifie', '2026-01-02T00:00:00.000Z')],
        { 'a.mdx': 'reference' },
      );
      expect(decisions).toEqual([{ kind: 'conflict-pull-wins', relPath: 'a.mdx' }]);
    });

    it('ne fait rien quand local == distant même si la référence est périmée (elle est réparée ailleurs)', () => {
      const decisions = diffVault(
        [local('a.mdx', 'converge', 3000)],
        [remote('a.mdx', 'converge', '2026-01-01T00:00:00.000Z')],
        { 'a.mdx': 'reference-perimee' },
      );
      expect(decisions).toEqual([{ kind: 'noop', relPath: 'a.mdx' }]);
    });

    it('sans référence pour ce fichier (premier cycle), conflit prudent — jamais d’arbitrage mtime', () => {
      const localTime = new Date('2026-01-02T00:00:00.000Z').getTime();
      const decisions = diffVault(
        [local('a.mdx', 'local-hash', localTime)],
        [remote('a.mdx', 'remote-hash', '2026-01-01T00:00:00.000Z')],
        {},
      );
      expect(decisions).toEqual([{ kind: 'conflict-pull-wins', relPath: 'a.mdx' }]);
    });

    it('une référence inconnue du cloud ne classe plus en push : le fichier est traité comme divergent (conflit prudent)', () => {
      // C'est le cas « clé inconnue du state » (fichier déplacé/renommé) :
      // sans référence fiable, le mtime départage — un fichier fraîchement
      // modifié gagne, mais le verdict est bien celui d'un conflit réel et
      // non d'une divergence inventée par un mtime seul quand la référence
      // existe.
      const localTime = new Date('2026-01-02T00:00:00.000Z').getTime();
      const decisions = diffVault(
        [local('a.mdx', 'local-hash', localTime)],
        [remote('a.mdx', 'remote-hash', '2026-01-01T00:00:00.000Z')],
        { 'autre.mdx': 'reference' },
      );
      expect(decisions).toEqual([{ kind: 'conflict-pull-wins', relPath: 'a.mdx' }]);
    });
  });

  describe('verrou optimiste : version serveur', () => {
    it('version distante == version de référence → push, même si la référence hash manque', () => {
      const decisions = diffVault(
        [local('a.mdx', 'local-new', 1)],
        [{ ...remote('a.mdx', 'cloud', '2026-01-01T00:00:00.000Z'), version: 4 }],
        {},
        { 'a.mdx': 4 },
      );
      expect(decisions).toEqual([{ kind: 'push', relPath: 'a.mdx' }]);
    });
    it('version distante avancée → jamais push, même si le hash cloud égale la référence', () => {
      const decisions = diffVault(
        [local('a.mdx', 'local-new', 9e12)],
        [{ ...remote('a.mdx', 'ref', '2026-01-01T00:00:00.000Z'), version: 5 }],
        { 'a.mdx': 'ref' },
        { 'a.mdx': 4 },
      );
      expect(decisions).toEqual([{ kind: 'conflict-pull-wins', relPath: 'a.mdx' }]);
    });
    it('version avancée et local inchangé → pull', () => {
      const decisions = diffVault(
        [local('a.mdx', 'ref', 1)],
        [{ ...remote('a.mdx', 'cloud2', '2026-01-01T00:00:00.000Z'), version: 5 }],
        { 'a.mdx': 'ref' },
        { 'a.mdx': 4 },
      );
      expect(decisions).toEqual([{ kind: 'pull', relPath: 'a.mdx' }]);
    });
  });
});
