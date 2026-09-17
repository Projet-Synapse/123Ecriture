import { describe, expect, it } from 'vitest';

import { decodeVaultStorageObjectKey, vaultStorageObjectKey } from './storageKeys';

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
