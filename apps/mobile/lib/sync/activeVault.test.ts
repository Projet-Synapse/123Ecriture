import { describe, expect, it } from 'vitest';

import { pickActiveRemoteVault } from './activeVault';

// Résolveur du coffre actif (v0.4.28) — c'est lui qui garantit que le
// moteur synchro TOUJOURS le couple (dossier, coffre distant) du coffre
// actif : jamais un identifiant distant périmé croisé avec un autre dossier
// (le bug de contamination croisée de l'UI, vécu les 19-20/09).

const entries = (overrides: Partial<VaultRegistryEntry>[] = []): VaultRegistryEntry[] => [
  { id: 'a', name: 'A', path: '/a', cloudLinked: true, remoteVaultId: 'ra' },
  { id: 'b', name: 'B', path: '/b', cloudLinked: false },
  { id: 'c', name: 'C', path: '/c', cloudLinked: true, remoteVaultId: 'rc' },
  ...overrides,
] as VaultRegistryEntry[];

describe('pickActiveRemoteVault', () => {
  it('retourne le coffre actif lié', () => {
    expect(pickActiveRemoteVault(entries(), 'a')?.remoteVaultId).toBe('ra');
    expect(pickActiveRemoteVault(entries(), 'c')?.remoteVaultId).toBe('rc');
  });

  it('null si le coffre actif nest pas lié au cloud', () => {
    expect(pickActiveRemoteVault(entries(), 'b')).toBeNull();
  });

  it('null si pas de coffre actif ou actif inconnu du registre', () => {
    expect(pickActiveRemoteVault(entries(), null)).toBeNull();
    expect(pickActiveRemoteVault(entries(), 'zz')).toBeNull();
    expect(pickActiveRemoteVault([], 'a')).toBeNull();
  });

  it('null si marqué lié mais sans identifiant distant (etat incoherent)', () => {
    expect(pickActiveRemoteVault(entries([{ id: 'd', name: 'D', path: '/d', cloudLinked: true }]), 'd')).toBeNull();
  });
});
