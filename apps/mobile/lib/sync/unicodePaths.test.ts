import { describe, expect, it } from 'vitest';

import { alignUnicodePaths, renameBaseKeys, resolveUnicodeSegments, unicodeKey } from './unicodePaths';
import { planSync } from './threeWay';

const NFC = 'Scènes/scène the eleven.md'.normalize('NFC');
const NFD = 'Scènes/scène the eleven.md'.normalize('NFD');
const EMOJI_NFC = '👋🎤 Guide des types d’éléments.md'.normalize('NFC');
const EMOJI_NFD = '👋🎤 Guide des types d’éléments.md'.normalize('NFD');

describe('unicodeKey', () => {
  it('NFC et NFD donnent la même clé (accents, emojis intacts)', () => {
    expect(NFC).not.toBe(NFD);
    expect(unicodeKey(NFD)).toBe(unicodeKey(NFC));
    expect(unicodeKey(EMOJI_NFD)).toBe(EMOJI_NFC);
  });
  it('l’apostrophe droite et typographique restent DEUX noms différents', () => {
    expect(unicodeKey("scènes l'enchanteresse.md")).not.toBe(unicodeKey('scènes l’enchanteresse.md'));
  });
});

describe('alignUnicodePaths', () => {
  it('fichier local NFD, cloud + base NFC : relu sous la graphie du cloud', () => {
    const a = alignUnicodePaths({
      localPaths: [NFD],
      remote: [{ relPath: NFC, deleted: false, updatedAt: '2026-11-10' }],
      basePaths: [NFC],
    });
    expect(a.localRename.get(NFD)).toBe(NFC);
    expect(a.baseRename.size).toBe(0);
    expect(a.shadowed).toEqual([]);
  });

  it('deux lignes cloud (NFD + NFC) : la plus récente gagne (modif de l’autre appareil jamais ignorée)', () => {
    const rowD = { relPath: NFD, deleted: false, updatedAt: '2026-11-01' };
    const rowC = { relPath: NFC, deleted: false, updatedAt: '2026-11-12' };
    const a = alignUnicodePaths({ localPaths: [NFD], remote: [rowD, rowC], basePaths: [NFD, NFC] });
    expect(a.localRename.get(NFD)).toBe(NFC);
    expect(a.shadowed).toEqual([rowD]);
    expect(a.baseRename.get(NFD)).toBe(NFC);
  });

  it('pas de local : la ligne vivante la plus récente gagne', () => {
    const rowD = { relPath: NFD, deleted: true, updatedAt: '2026-11-13' };
    const rowC = { relPath: NFC, deleted: false, updatedAt: '2026-11-12' };
    const a = alignUnicodePaths({ localPaths: [], remote: [rowD, rowC], basePaths: [NFD] });
    expect(a.shadowed).toEqual([rowD]);
    expect(a.baseRename.get(NFD)).toBe(NFC);
  });

  it('deux vrais fichiers locaux : rien n’est touché, doublon signalé', () => {
    const a = alignUnicodePaths({ localPaths: [NFC, NFD], remote: [{ relPath: NFC, deleted: false }], basePaths: [] });
    expect(a.localRename.size).toBe(0);
    expect(a.shadowed).toEqual([]);
    expect(a.localDuplicates).toEqual([[NFC, NFD].sort()]);
  });

  it('une seule graphie partout : rien à faire', () => {
    const a = alignUnicodePaths({ localPaths: [NFC, 'a.md'], remote: [{ relPath: NFC, deleted: false }], basePaths: [NFC] });
    expect(a.localRename.size + a.baseRename.size + a.shadowed.length + a.localDuplicates.length).toBe(0);
  });
});

describe('renameBaseKeys', () => {
  it('reprend la base de la variante sans écraser la canonique', () => {
    expect(renameBaseKeys({ [NFD]: 'h1', b: 'h2' }, new Map([[NFD, NFC]]))).toEqual({ [NFC]: 'h1', b: 'h2' });
    expect(renameBaseKeys({ [NFD]: 'h1', [NFC]: 'h0' }, new Map([[NFD, NFC]]))).toEqual({ [NFC]: 'h0' });
  });
});

describe('non-régression « modifié ici, vu comme supprimé »', () => {
  it('sans alignement : suppression planifiée ; avec : simple envoi de la modification', () => {
    const remote = [{ relPath: NFC, hash: 'old', deleted: false, version: 3 }];
    const base = { [NFC]: { hash: 'old' } };
    const local = [{ relPath: NFD, hash: 'new' }];

    const naive = planSync({ local, remote, base });
    expect(naive.actions.find((x) => x.relPath === NFC)?.kind).toBe('tombstone-remote');

    const a = alignUnicodePaths({
      localPaths: local.map((l) => l.relPath),
      remote: remote.map((r) => ({ ...r })),
      basePaths: Object.keys(base),
    });
    const aligned = planSync({
      local: local.map((l) => ({ ...l, relPath: a.localRename.get(l.relPath) ?? l.relPath })),
      remote,
      base,
    });
    expect(aligned.actions).toEqual([expect.objectContaining({ kind: 'push', relPath: NFC })]);
  });
});

describe('resolveUnicodeSegments (disque desktop)', () => {
  // Disque simulé : dossier « Scènes » et fichier « scène the eleven.md » en NFD.
  const dirD = 'Sce\u0300nes';
  const fileD = 'sce\u0300ne the eleven.md';
  const disk = new Map<string, string[]>([
    ['', [dirD]],
    [dirD, [fileD, 'autre.md']],
  ]);
  const exists = (segs: string[]) => {
    const parent = segs.slice(0, -1).join('/');
    return (disk.get(parent) ?? []).includes(segs[segs.length - 1]);
  };
  const list = (segs: string[]) => disk.get(segs.join('/')) ?? null;

  it('demande en NFC → retrouve le vrai nom NFD (lecture/écriture du même fichier, pas de doublon)', () => {
    expect(resolveUnicodeSegments(['Scènes', 'scène the eleven.md'], exists, list)).toEqual([dirD, fileD]);
  });
  it('nom exact présent : rien ne change', () => {
    expect(resolveUnicodeSegments([dirD, 'autre.md'], exists, list)).toBeNull();
  });
  it('nouveau fichier dans un dossier en NFD : créé DANS ce dossier', () => {
    expect(resolveUnicodeSegments(['Scènes', 'neuf.md'], exists, list)).toEqual([dirD, 'neuf.md']);
  });
  it("introuvable sous toute graphie : null ; l’apostrophe ’ n’est pas confondue avec '", () => {
    expect(resolveUnicodeSegments(['Ailleurs', 'x.md'], exists, list)).toBeNull();
    disk.set(dirD, [fileD, 'scène l\u2019enchanteresse.md']);
    expect(resolveUnicodeSegments([dirD, "scène l'enchanteresse.md"], exists, list)).toBeNull();
  });
});
