import { describe, expect, it } from 'vitest';

import { decodeVaultStorageObjectKey, vaultStorageObjectKey, vaultVersionedObjectPath, vaultVersionObjectPath } from './storageKeys';

// Le point critique : Supabase Storage n'accepte que A-Za-z0-9 et quelques
// symboles — jamais les émojis/accents des noms de fichiers réels.
describe('vaultStorageObjectKey', () => {
  it('n’utilise que des caractères sûrs pour Supabase Storage', () => {
    const key = vaultStorageObjectKey('0. 📜✒️ GUIDES/🤫 Éléments narratifs dissimulés.mdx');
    expect(key).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('encode sans perte (roundtrip) chemins exotiques', () => {
    const chemins = [
      '🤫 Éléments narratifs dissimulés.md',
      '0. 📜✒️ GUIDES DU WORLDBUILDING/Références.md',
      'sous-dossier/через/prüfen.mdx',
      'simple.md',
    ];
    for (const p of chemins) {
      expect(decodeVaultStorageObjectKey(vaultStorageObjectKey(p))).toBe(p);
    }
  });

  it('est déterministe — même chemin, même clé', () => {
    expect(vaultStorageObjectKey('a/b 🌙.md')).toBe(vaultStorageObjectKey('a/b 🌙.md'));
  });

  it('distingue des chemins proches (pas de collision de préfixe)', () => {
    expect(vaultStorageObjectKey('a/b')).not.toBe(vaultStorageObjectKey('a-b'));
  });
});

describe('vaultVersionObjectPath', () => {
  it('garde le coffre en premier segment et ajoute le hash', () => {
    const p = vaultVersionObjectPath('v-1', 'a/b 🌙.md', 'abc123');
    expect(p).toBe(`v-1/.versions/${vaultStorageObjectKey('a/b 🌙.md')}@abc123`);
  });
  it('nettoie un hash exotique', () => {
    expect(vaultVersionObjectPath('v', 'x.md', 'sha256:ab/cd')).toMatch(/@sha256abcd$/);
  });
});

describe('vaultVersionedObjectPath', () => {
  it('produit une clé unique par hash, sous le dossier du coffre', () => {
    const a = vaultVersionedObjectPath('v1', 'notes/a.md', 'sha:ab/c');
    expect(a).toBe(`v1/${vaultStorageObjectKey('notes/a.md')}@shaabc`);
    expect(a).not.toBe(vaultVersionedObjectPath('v1', 'notes/a.md', 'other'));
  });
});
