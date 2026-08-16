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

  it('en conflit, le local gagne si son timestamp est plus récent', () => {
    const localTime = new Date('2026-01-02T00:00:00.000Z').getTime();
    const decisions = diffVault(
      [local('a.mdx', 'local-hash', localTime)],
      [remote('a.mdx', 'remote-hash', '2026-01-01T00:00:00.000Z')],
    );
    expect(decisions).toEqual([{ kind: 'conflict-push-wins', relPath: 'a.mdx' }]);
  });

  it('en conflit, le distant gagne si son timestamp est plus récent', () => {
    const localTime = new Date('2026-01-01T00:00:00.000Z').getTime();
    const decisions = diffVault(
      [local('a.mdx', 'local-hash', localTime)],
      [remote('a.mdx', 'remote-hash', '2026-01-02T00:00:00.000Z')],
    );
    expect(decisions).toEqual([{ kind: 'conflict-pull-wins', relPath: 'a.mdx' }]);
  });

  it('en conflit à égalité stricte, le local gagne (évite un aller-retour infini)', () => {
    const sameTime = new Date('2026-01-01T00:00:00.000Z').getTime();
    const decisions = diffVault(
      [local('a.mdx', 'local-hash', sameTime)],
      [remote('a.mdx', 'remote-hash', '2026-01-01T00:00:00.000Z')],
    );
    expect(decisions).toEqual([{ kind: 'conflict-push-wins', relPath: 'a.mdx' }]);
  });

  it('traite plusieurs notes indépendamment et trie le résultat par chemin', () => {
    const decisions = diffVault(
      [local('z.mdx', 'h1', 1000), local('a.mdx', 'h2', 1000)],
      [remote('m.mdx', 'h3', '2026-01-01T00:00:00.000Z')],
    );
    expect(decisions.map((d) => d.relPath)).toEqual(['a.mdx', 'm.mdx', 'z.mdx']);
  });
});
