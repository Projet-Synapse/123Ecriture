import { describe, expect, it, vi } from 'vitest';
import { createPropertiesBridge, PROPERTIES_PATH, type PropertiesIo } from './propertiesBridgeCore';

function memoryIo(files: Record<string, string>) {
  let n = 0;
  const writes: string[] = [];
  const io: PropertiesIo = {
    readText: async (p) => {
      if (!(p in files)) throw new Error(`absent: ${p}`);
      return files[p];
    },
    writeText: async (p, c) => {
      writes.push(p);
      files[p] = c;
    },
    listNotes: async () => Object.keys(files).filter((p) => /\.mdx?$/.test(p) && !p.startsWith('.trash/')),
    newId: () => `p-${++n}`,
    now: () => '2026-11-16T10:00:00.000Z',
  };
  return { io, files, writes };
}

describe('createPropertiesBridge', () => {
  it('liste vide sans schéma, puis crée une propriété persistée', async () => {
    const { io, files } = memoryIo({});
    const bridge = createPropertiesBridge(io);
    expect(await bridge.list()).toEqual([]);
    const props = await bridge.create(' statut ', 'options', ['brouillon', ' ', ' fini ']);
    expect(props).toEqual([
      { id: 'p-1', name: 'statut', type: 'options', createdAt: '2026-11-16T10:00:00.000Z', options: ['brouillon', 'fini'] },
    ]);
    expect(JSON.parse(files[PROPERTIES_PATH])).toEqual(props);
  });

  it('refuse un nom vide, un doublon (casse ignorée) et un type inconnu', async () => {
    const bridge = createPropertiesBridge(memoryIo({}).io);
    await bridge.create('Auteur', 'text');
    await expect(bridge.create('  ', 'text')).rejects.toThrow(/vide/);
    await expect(bridge.create('auteur', 'text')).rejects.toThrow(/déjà/);
    await expect(bridge.create('x', 'nimporte' as PropertyType)).rejects.toThrow(/invalide/);
  });

  it('accepte les types multi-options et bulles ; lit tags en « list » comme bulles', async () => {
    const { io } = memoryIo({
      [PROPERTIES_PATH]: JSON.stringify([{ id: 'a', name: 'Tags', type: 'list', createdAt: 'x' }]),
    });
    const bridge = createPropertiesBridge(io);
    expect((await bridge.list())[0].type).toBe('bubbles');
    const props = await bridge.create('genres', 'multi-options', []);
    expect(props.map((p) => p.type)).toEqual(['bubbles', 'multi-options']);
  });

  it('renommage : schéma mis à jour puis clé migrée dans les notes concernées', async () => {
    const { io, files } = memoryIo({
      [PROPERTIES_PATH]: JSON.stringify([{ id: 'a', name: 'auteur', type: 'text', createdAt: 'x' }]),
      'a.md': '---\nauteur: Marianne\n---\nCorps',
      'b.mdx': '---\ntitre: x\n---\n',
      '.trash/c.md': '---\nauteur: Vieux\n---\n',
    });
    const bridge = createPropertiesBridge(io);
    const result = await bridge.update('a', { name: 'Autrice' });
    expect(result.properties[0].name).toBe('Autrice');
    expect(result.migration?.migratedCount).toBe(1);
    expect(files['a.md']).toContain('Autrice: Marianne');
    expect(files['a.md']).toContain('Corps');
    expect(files['.trash/c.md']).toContain('auteur: Vieux');
  });

  it('changement de type sans renommage : aucune migration', async () => {
    const { io, writes } = memoryIo({
      [PROPERTIES_PATH]: JSON.stringify([{ id: 'a', name: 'note', type: 'text', createdAt: 'x' }]),
      'a.md': '---\nnote: 3\n---\n',
    });
    const result = await createPropertiesBridge(io).update('a', { type: 'number' });
    expect(result.properties[0].type).toBe('number');
    expect(result.migration).toBeUndefined();
    expect(writes).toEqual([PROPERTIES_PATH]);
  });

  it('supprime une définition sans toucher aux notes', async () => {
    const { io, files } = memoryIo({
      [PROPERTIES_PATH]: JSON.stringify([
        { id: 'a', name: 'x', type: 'text', createdAt: 'x' },
        { id: 'b', name: 'y', type: 'text', createdAt: 'x' },
      ]),
      'n.md': '---\nx: 1\n---\n',
    });
    const props = await createPropertiesBridge(io).remove('a');
    expect(props.map((p) => p.id)).toEqual(['b']);
    expect(files['n.md']).toBe('---\nx: 1\n---\n');
  });

  it('scan du coffre : crée les clés inconnues et compte les usages', async () => {
    const { io } = memoryIo({
      [PROPERTIES_PATH]: JSON.stringify([{ id: 'a', name: 'Auteur', type: 'text', createdAt: 'x' }]),
      'a.md': '---\nauteur: M\ntags: [a, b]\ncreated: 2026-01-01\n---\n',
      'b.md': '---\nAuteur: N\npages: 12\n---\n',
    });
    const result = await createPropertiesBridge(io).scanVault();
    expect(result.createdCount).toBe(2);
    expect(result.usage).toEqual({ Auteur: 2, tags: 1, pages: 1 });
    expect(result.properties.map((p) => [p.name, p.type])).toEqual([
      ['Auteur', 'text'],
      ['tags', 'bubbles'],
      ['pages', 'number'],
    ]);
  });

  it('JSON cassé : sauvegarde .corrupt-* avant de repartir à vide', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { io, files } = memoryIo({ [PROPERTIES_PATH]: '[{"id":' });
    expect(await createPropertiesBridge(io).list()).toEqual([]);
    const backups = Object.keys(files).filter((p) => p.startsWith(`${PROPERTIES_PATH}.corrupt-`));
    expect(backups).toHaveLength(1);
    expect(files[backups[0]]).toBe('[{"id":');
    spy.mockRestore();
  });
});
