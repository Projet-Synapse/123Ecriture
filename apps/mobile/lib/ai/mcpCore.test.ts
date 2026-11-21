import { describe, expect, it } from 'vitest';

import { DEFAULT_AI_GATEWAY, type AiGatewaySettings, type AiJournalEntry } from './aiPolicy';
import { bearerToken, handleMcpMessage, isAllowedOrigin, type McpDeps } from './mcpCore';

const files: Record<string, string> = {
  'Projets/Roman.md': '# Roman\nLe dragon dort sous la montagne.',
  'Privé/Banque.md': 'dragon secret',
  'Notes/Idées.md': 'Une idée de dragon bleu',
  'Notes/image.png': 'x\u0000y',
  '.123ecriture/preferences.json': '{}',
};

function deps(settings: Partial<AiGatewaySettings> = {}, locked = ['Privé']) {
  const journal: AiJournalEntry[] = [];
  const d: McpDeps = {
    load: async () => ({ settings: { ...DEFAULT_AI_GATEWAY, enabled: true, ...settings }, locked }),
    listFiles: async () => Object.keys(files),
    readFile: async (p) => {
      if (!(p in files)) throw new Error('absent');
      return files[p];
    },
    log: (e) => journal.push(e),
    now: () => new Date('2026-11-20T10:00:00Z'),
  };
  return { d, journal };
}

async function call(d: McpDeps, name: string, args: Record<string, unknown>) {
  const res = (await handleMcpMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, d)) as {
    result: { content: { text: string }[]; isError?: boolean };
  };
  return { text: res.result.content[0].text, isError: !!res.result.isError };
}

describe('serveur MCP (lecture seule)', () => {
  it('initialize, tools/list, notifications', async () => {
    const { d } = deps();
    const init = (await handleMcpMessage({ jsonrpc: '2.0', id: 0, method: 'initialize', params: {} }, d)) as {
      result: { serverInfo: { name: string } };
    };
    expect(init.result.serverInfo.name).toBe('123ecriture');
    const list = (await handleMcpMessage({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, d)) as {
      result: { tools: { name: string }[] };
    };
    expect(list.result.tools.map((t) => t.name)).toEqual(['list_files', 'read_file', 'search']);
    expect(await handleMcpMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }, d)).toBeNull();
  });

  it('list_files cache verrouillé et interne', async () => {
    const { d, journal } = deps();
    const r = await call(d, 'list_files', {});
    expect(r.text.split('\n')).toEqual(['Notes/Idées.md', 'Notes/image.png', 'Projets/Roman.md']);
    expect(journal[0]).toMatchObject({ action: 'read', decision: 'allow' });
  });

  it('read_file : autorisé, verrouillé, binaire, journalisé', async () => {
    const { d, journal } = deps();
    expect((await call(d, 'read_file', { path: 'Projets/Roman.md' })).text).toContain('dragon');
    const locked = await call(d, 'read_file', { path: 'Privé/Banque.md' });
    expect(locked.isError).toBe(true);
    expect(locked.text).toContain('verrouillé');
    expect((await call(d, 'read_file', { path: '../x' })).isError).toBe(true);
    expect((await call(d, 'read_file', { path: 'Notes/image.png' })).isError).toBe(true);
    expect(journal.map((e) => e.decision)).toEqual(['allow', 'deny', 'deny', 'deny']);
  });

  it('search ne renvoie jamais le verrouillé', async () => {
    const { d } = deps();
    const r = await call(d, 'search', { query: 'DRAGON' });
    expect(r.text).toContain('Projets/Roman.md');
    expect(r.text).toContain('Notes/Idées.md');
    expect(r.text).not.toContain('Privé');
  });

  it('désactivée ou lecture interdite / à demander : refus', async () => {
    expect((await call(deps({ enabled: false }).d, 'list_files', {})).isError).toBe(true);
    const ask = deps({ permissions: { ...DEFAULT_AI_GATEWAY.permissions, read: 'ask' } });
    expect((await call(ask.d, 'read_file', { path: 'Projets/Roman.md' })).isError).toBe(true);
    expect(ask.journal[0].decision).toBe('ask');
  });

  it('dossiers autorisés', async () => {
    const { d } = deps({ allowedFolders: ['Notes'] });
    expect((await call(d, 'list_files', {})).text).toBe('Notes/Idées.md\nNotes/image.png');
    expect((await call(d, 'read_file', { path: 'Projets/Roman.md' })).isError).toBe(true);
  });

  it('origine et jeton', () => {
    expect(isAllowedOrigin(undefined)).toBe(true);
    expect(isAllowedOrigin('http://localhost:3000')).toBe(true);
    expect(isAllowedOrigin('https://evil.example')).toBe(false);
    expect(bearerToken('Bearer ecr_abc')).toBe('ecr_abc');
    expect(bearerToken('Basic x')).toBeNull();
  });
});
