import { describe, expect, it, vi } from 'vitest';
(globalThis as { __DEV__?: boolean }).__DEV__ = false;
vi.mock('react-native', () => ({ Alert: {}, Platform: { OS: 'android' }, NativeModules: {} }));
vi.mock('expo-file-system/legacy', () => ({ StorageAccessFramework: {}, EncodingType: {}, documentDirectory: 'file:///d/', cacheDirectory: 'file:///c/' }));
vi.mock('expo-file-system', () => ({}));
vi.mock('expo-document-picker', () => ({}));
vi.mock('./nativeVaultsAdapter', () => ({ getActiveVaultRootUri: vi.fn(), requestAndRegisterVault: vi.fn() }));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: { getItem: vi.fn(), setItem: vi.fn() } }));
const { buildTreeFromIndex } = await import('./nativeVaultAdapter');

type N = { type: string; relPath: string; children?: N[] };
const flat = (ns: N[]): string[] => ns.flatMap((n) => [`${n.type}:${n.relPath}`, ...flat(n.children ?? [])]);

describe('buildTreeFromIndex — dossiers vides', () => {
  it('affiche un dossier vide (feuille) et ses parents', () => {
    const idx = new Map([
      ['A', { isDirectory: true }],
      ['A/Vide', { isDirectory: true }],
      ['B/Note.md', { isDirectory: false }],
    ]);
    expect(flat(buildTreeFromIndex(idx) as N[])).toEqual(['folder:A', 'folder:A/Vide', 'folder:B', 'note:B/Note.md']);
  });
  it('ne montre ni dossiers cachés (.obsidian), ni .123ecriture/.trash, ni chemins à backslash', () => {
    const idx = new Map([
      ['.obsidian', { isDirectory: true }],
      ['.obsidian/plugins', { isDirectory: true }],
      ['.123ecriture', { isDirectory: true }],
      ['.trash/x', { isDirectory: true }],
      ['X\\Y', { isDirectory: true }],
      ['C', { isDirectory: true }],
    ]);
    expect(flat(buildTreeFromIndex(idx) as N[])).toEqual(['folder:C']);
  });
});
