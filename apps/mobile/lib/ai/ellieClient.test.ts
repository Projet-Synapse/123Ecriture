import { describe, expect, it } from 'vitest';

import {
  createFetchHttp,
  formatEllieError,
  listEllieModels,
  parseOllamaLine,
  parseOpenAiSseLine,
  streamEllieChat,
  testEllieConnection,
  type EllieHttp,
} from './ellieClient';
import { DEFAULT_AI_CHAT, normalizeAiChat, normalizeEllieBaseUrl } from './ellieSettings';

describe('ellieSettings', () => {
  it('normalise les défauts et refuse une URL invalide', () => {
    expect(normalizeAiChat(undefined).name).toBe('Ellie');
    expect(normalizeAiChat({ provider: 'openai', baseUrl: ' http://127.0.0.1:1234/v1 ', model: 'qwen' }).provider).toBe('openai');
    expect(normalizeEllieBaseUrl('http://127.0.0.1:11434/v1/')).toBe('http://127.0.0.1:11434');
    expect(() => normalizeEllieBaseUrl('not-a-url')).toThrow(/URL invalide/);
    expect(() => normalizeEllieBaseUrl('http://user:pass@localhost:11434')).toThrow(/identifiants/);
  });
});

describe('parseurs de flux', () => {
  it('parse le NDJSON Ollama (texte et appels d’outils)', () => {
    expect(parseOllamaLine('')).toBeNull();
    expect(parseOllamaLine('{"message":{"content":"Bon"}}')).toEqual({ content: 'Bon', toolCalls: [] });
    const tools = parseOllamaLine(
      '{"message":{"content":"","tool_calls":[{"function":{"name":"search","arguments":{"query":"dragon"}}}]}}',
    );
    expect(tools).toMatchObject({ content: '', toolCalls: [{ name: 'search', arguments: { query: 'dragon' } }] });
    expect(parseOllamaLine('{"error":"boom"}')).toEqual({ error: 'boom' });
  });

  it('parse le SSE OpenAI (delta, outils incrémentaux, fin)', () => {
    expect(parseOpenAiSseLine('data: [DONE]')).toBe('done');
    expect(parseOpenAiSseLine('data: {"choices":[{"delta":{"content":"He"}}]}')).toEqual({ content: 'He', toolCalls: [] });
    const first = parseOpenAiSseLine(
      'data: {"choices":[{"delta":{"tool_calls":[{"id":"c1","index":0,"function":{"name":"read_file","arguments":"{\\"path\\":"}}]}}]}',
    );
    const second = parseOpenAiSseLine(
      'data: {"choices":[{"delta":{"tool_calls":[{"id":"c1","index":0,"function":{"arguments":"\\"A.md\\"}"}}]}}]}',
    );
    expect(first).toMatchObject({ toolCalls: [{ id: 'c1', name: 'read_file' }] });
    expect(second).toMatchObject({ toolCalls: [{ id: 'c1' }] });
    expect(parseOpenAiSseLine('data: {"error":{"message":"non"}}')).toEqual({ error: 'non' });
  });
});

describe('formatEllieError', () => {
  it('explique timeout, CORS et annulation', () => {
    const timeout = new Error('timeout');
    timeout.name = 'AbortError';
    timeout.message = 'timeout';
    expect(formatEllieError(timeout)).toMatch(/Délai dépassé/);
    expect(formatEllieError(new TypeError('Failed to fetch'), DEFAULT_AI_CHAT)).toMatch(/OLLAMA_ORIGINS=\*/);
    const abort = new Error('Aborted');
    abort.name = 'AbortError';
    expect(formatEllieError(abort)).toMatch(/interrompue/);
  });
});

function httpFrom(responses: EllieHttp['request'] extends (i: infer I) => Promise<infer R> ? { input?: string; result: R }[] : never): EllieHttp {
  const queue = [...responses];
  return {
    async request() {
      const next = queue.shift();
      if (!next) throw new Error('plus de réponses mockées');
      return next.result;
    },
  };
}

describe('listEllieModels / testEllieConnection / streamEllieChat', () => {
  it('liste les modèles Ollama et OpenAI', async () => {
    const ollama = httpFrom([
      { result: { ok: true, status: 200, text: JSON.stringify({ models: [{ name: 'qwen3:8b' }, { name: 'qwen3:4b' }] }) } },
    ]);
    expect(await listEllieModels(DEFAULT_AI_CHAT, ollama)).toEqual(['qwen3:8b', 'qwen3:4b']);
    const openai = httpFrom([
      { result: { ok: true, status: 200, text: JSON.stringify({ data: [{ id: 'local-qwen' }] }) } },
    ]);
    expect(await listEllieModels({ ...DEFAULT_AI_CHAT, provider: 'openai', baseUrl: 'http://127.0.0.1:1234' }, openai)).toEqual(['local-qwen']);
  });

  it('le test réussit si le modèle est présent, échoue sinon', async () => {
    const ok = httpFrom([{ result: { ok: true, status: 200, text: JSON.stringify({ models: [{ name: 'qwen3:8b' }] }) } }]);
    await expect(testEllieConnection(DEFAULT_AI_CHAT, ok)).resolves.toEqual(['qwen3:8b']);
    const missing = httpFrom([{ result: { ok: true, status: 200, text: JSON.stringify({ models: [{ name: 'autre' }] }) } }]);
    await expect(testEllieConnection(DEFAULT_AI_CHAT, missing)).rejects.toThrow(/n’est pas installé/);
  });

  it('accumule un flux Ollama et remonte une erreur HTTP lisible', async () => {
    const streamed: string[] = [];
    const http: EllieHttp = {
      request: async () => ({ ok: true, status: 200, text: '{"message":{"content":"Bon"}}\n{"message":{"content":"jour"}}\n' }),
    };
    const result = await streamEllieChat(DEFAULT_AI_CHAT, [{ role: 'user', content: 'hi' }], {
      http,
      onDelta: (t) => streamed.push(t),
    });
    expect(result.content).toBe('Bonjour');
    expect(streamed.at(-1)).toBe('Bonjour');

    const errHttp: EllieHttp = {
      request: async () => ({ ok: false, status: 404, text: '{"error":"model not found"}' }),
    };
    await expect(streamEllieChat(DEFAULT_AI_CHAT, [{ role: 'user', content: 'hi' }], { http: errHttp })).rejects.toThrow(
      /ollama pull qwen3:8b/,
    );
  });

  it('createFetchHttp relit un flux par lignes', async () => {
    const chunks = [new TextEncoder().encode('{"message":{"content":"A"}}\n{"message":{"content":"B"}}\n')];
    const fetchFn: typeof fetch = async () =>
      ({
        ok: true,
        status: 200,
        text: async () => '',
        body: {
          getReader() {
            let i = 0;
            return {
              async read() {
                if (i >= chunks.length) return { done: true, value: undefined };
                const value = chunks[i];
                i += 1;
                return { done: false, value };
              },
              releaseLock() {},
            };
          },
        },
      }) as unknown as Response;
    const lines: string[] = [];
    const http = createFetchHttp(fetchFn);
    const res = await http.streamLines!(
      { url: 'http://x', method: 'POST', headers: {}, body: '{}', signal: new AbortController().signal },
      (line) => lines.push(line),
    );
    expect(res.ok).toBe(true);
    expect(lines.join('\n')).toContain('content');
  });
});
