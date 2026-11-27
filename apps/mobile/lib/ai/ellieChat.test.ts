import { describe, expect, it } from 'vitest';

import { DEFAULT_AI_GATEWAY, type AiGatewaySettings, type AiJournalEntry } from './aiPolicy';
import { buildEllieSystemPrompt, canIncludeCurrentNote, runEllieTurn } from './ellieChat';
import { DEFAULT_AI_CHAT } from './ellieSettings';
import type { EllieHttp } from './ellieClient';
import type { McpDeps } from './mcpCore';

const enabled: AiGatewaySettings = { ...DEFAULT_AI_GATEWAY, enabled: true };

function vault(locked: string[] = [], files: Record<string, string> = {}): { deps: McpDeps; journal: AiJournalEntry[] } {
  const journal: AiJournalEntry[] = [];
  return {
    journal,
    deps: {
      load: async () => ({ settings: enabled, locked }),
      listFiles: async () => Object.keys(files),
      readFile: async (p) => {
        if (!(p in files)) throw new Error('missing');
        return files[p];
      },
      log: (e) => journal.push(e),
    },
  };
}

describe('contexte note courante', () => {
  it('refuse une note verrouillée ou la passerelle éteinte', () => {
    expect(canIncludeCurrentNote(DEFAULT_AI_GATEWAY, [], 'A.md').ok).toBe(false);
    expect(canIncludeCurrentNote(enabled, ['Privé'], 'Privé/secret.md').ok).toBe(false);
    expect(canIncludeCurrentNote(enabled, [], 'Public.md')).toEqual({ ok: true });
  });

  it('joint la note au prompt seulement si autorisée', () => {
    const prompt = buildEllieSystemPrompt(DEFAULT_AI_CHAT, { relPath: 'A.md', name: 'A', content: 'hello' }, true);
    expect(prompt).toContain('hello');
    expect(prompt).toContain('A.md');
    const denied = buildEllieSystemPrompt(DEFAULT_AI_CHAT, null, true, '« Privé/x.md » est verrouillé pour l’IA.');
    expect(denied).toContain('verrouillé');
    expect(denied).not.toContain('secret');
  });
});

describe('runEllieTurn', () => {
  it('refuse si l’IA n’est pas activée', async () => {
    const { deps } = vault();
    await expect(
      runEllieTurn({
        settings: DEFAULT_AI_CHAT,
        gateway: DEFAULT_AI_GATEWAY,
        history: [],
        userText: 'salut',
        includeNote: false,
        note: null,
        http: { request: async () => ({ ok: true, status: 200, text: '' }) },
        vault: deps,
      }),
    ).rejects.toThrow(/n’est pas activée/);
  });

  it('renvoie le texte streamé sans outil', async () => {
    const { deps } = vault();
    const http: EllieHttp = {
      request: async () => ({ ok: true, status: 200, text: '{"message":{"content":"Idée"}}\n{"message":{"content":" claire"}}\n' }),
    };
    const result = await runEllieTurn({
      settings: DEFAULT_AI_CHAT,
      gateway: enabled,
      history: [],
      userText: 'aide-moi',
      includeNote: false,
      note: null,
      http,
      vault: deps,
    });
    expect(result.content).toBe('Idée claire');
    expect(result.messages.at(-1)).toMatchObject({ role: 'assistant', content: 'Idée claire' });
  });

  it('exécute un outil puis un second tour, en respectant un verrou', async () => {
    const { deps, journal } = vault(['Privé'], { 'Public.md': 'dragon visible', 'Privé/x.md': 'secret' });
    let turn = 0;
    const http: EllieHttp = {
      request: async ({ body }) => {
        turn += 1;
        const parsed = JSON.parse(body ?? '{}') as { messages?: unknown[] };
        if (turn === 1) {
          return {
            ok: true,
            status: 200,
            text: JSON.stringify({
              message: { content: '', tool_calls: [{ function: { name: 'read_file', arguments: { path: 'Privé/x.md' } } }] },
            }),
          };
        }
        const last = JSON.stringify(parsed.messages ?? []);
        expect(last).toMatch(/verrouillé|Refusé/);
        return { ok: true, status: 200, text: '{"message":{"content":"Je ne peux pas lire ce fichier."}}\n' };
      },
    };
    const result = await runEllieTurn({
      settings: DEFAULT_AI_CHAT,
      gateway: enabled,
      history: [],
      userText: 'lis Privé/x.md',
      includeNote: false,
      note: null,
      http,
      vault: deps,
    });
    expect(result.content).toMatch(/ne peux pas/);
    expect(journal.some((e) => e.decision === 'deny')).toBe(true);
  });

  it('un search autorisé passe par la même logique que la passerelle', async () => {
    const { deps, journal } = vault([], { 'Roman.md': 'un dragon rouge' });
    let turn = 0;
    const http: EllieHttp = {
      request: async () => {
        turn += 1;
        if (turn === 1) {
          return {
            ok: true,
            status: 200,
            text: JSON.stringify({
              message: { content: '', tool_calls: [{ function: { name: 'search', arguments: { query: 'dragon' } } }] },
            }),
          };
        }
        return { ok: true, status: 200, text: '{"message":{"content":"Trouvé dans Roman.md"}}\n' };
      },
    };
    const result = await runEllieTurn({
      settings: DEFAULT_AI_CHAT,
      gateway: enabled,
      history: [],
      userText: 'cherche dragon',
      includeNote: false,
      note: null,
      http,
      vault: deps,
    });
    expect(result.content).toMatch(/Roman/);
    expect(journal.some((e) => e.action === 'search' && e.decision === 'allow')).toBe(true);
  });
});
