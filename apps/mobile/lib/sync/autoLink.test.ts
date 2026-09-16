import { describe, expect, it } from 'vitest';

import { pickVaultsToAutoLink } from './autoLink';

function vault(id: string, overrides: Partial<VaultRegistryEntry> = {}): VaultRegistryEntry {
  return { id, name: `Coffre ${id}`, path: `/tmp/${id}`, cloudLinked: false, remoteVaultId: null, ...overrides };
}

describe('pickVaultsToAutoLink', () => {
  it('sélectionne les coffres non liés', () => {
    const picked = pickVaultsToAutoLink([vault('a'), vault('b')], new Set());
    expect(picked.map((v) => v.id)).toEqual(['a', 'b']);
  });

  it('exclut les coffres déjà liés au cloud', () => {
    const picked = pickVaultsToAutoLink(
      [vault('a', { cloudLinked: true, remoteVaultId: 'r1' }), vault('b')],
      new Set(),
    );
    expect(picked.map((v) => v.id)).toEqual(['b']);
  });

  it('exclut les tentatives déjà en cours (garde anti-boucle)', () => {
    const picked = pickVaultsToAutoLink([vault('a'), vault('b')], new Set(['a']));
    expect(picked.map((v) => v.id)).toEqual(['b']);
  });

  it('registre vide ou tout lié → rien à faire', () => {
    expect(pickVaultsToAutoLink([], new Set())).toEqual([]);
    expect(
      pickVaultsToAutoLink([vault('a', { cloudLinked: true, remoteVaultId: 'r' })], new Set(['a'])),
    ).toEqual([]);
  });
});
