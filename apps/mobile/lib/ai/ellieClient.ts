// ✒️ 123ECRITURE — lib/ai/ellieClient.ts — client Ollama / OpenAI-compatible (Ellie)
//////////////////////////////////////////////////////////////////////////////
//
// Client HTTP de l'IA locale : Ollama (`/api/chat`, `/api/tags`) ou
// OpenAI-compatible / LM Studio (`/v1/chat/completions`, `/v1/models`).
// Le transport (`EllieHttp`) est injecté — fetch du navigateur, ou proxy
// Electron (évite le CORS de l'origine `app://`). Testable sans réseau
// (ellieClient.test.ts).
//
// Invariants :
//   • Timeouts : 15 s pour la liste / le test, 5 min pour un tour de chat
//     (chargement d'un modèle). Annulation via AbortSignal (bouton Stop).
//   • Erreurs LISIBLES : timeout, CORS (conseil OLLAMA_ORIGINS=*),
//     modèle introuvable, serveur injoignable.
//   • Le flux est parsé comme NDJSON (Ollama) ou SSE (OpenAI).
//
//////////////////////////////////////////////////////////////////////////////

import { normalizeEllieBaseUrl, type AiChatSettings } from './ellieSettings';

export const ELLIE_LIST_TIMEOUT_MS = 15_000;
export const ELLIE_CHAT_TIMEOUT_MS = 300_000;

export type EllieRole = 'system' | 'user' | 'assistant' | 'tool';

export type EllieToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type EllieChatMessage = {
  role: EllieRole;
  content: string;
  toolCalls?: EllieToolCall[];
  toolCallId?: string;
  toolName?: string;
};

export type EllieToolDef = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type EllieHttpResult = {
  ok: boolean;
  status: number;
  text: string;
};

export type EllieHttp = {
  // Réponse complète (liste de modèles, test, chat non streamé).
  request: (input: { url: string; method: string; headers: Record<string, string>; body?: string; signal: AbortSignal }) => Promise<EllieHttpResult>;
  // Stream par lignes (NDJSON ou SSE). Si absent, `request` est utilisé.
  streamLines?: (
    input: { url: string; method: string; headers: Record<string, string>; body: string; signal: AbortSignal },
    onLine: (line: string) => void,
  ) => Promise<EllieHttpResult>;
};

export type EllieChatDelta = {
  content: string;
  toolCalls: EllieToolCall[];
};

function headersOf(settings: AiChatSettings): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (settings.provider === 'openai' && settings.apiKey) {
    headers.Authorization = `Bearer ${settings.apiKey}`;
  }
  return headers;
}

export function formatEllieError(error: unknown, settings?: AiChatSettings): string {
  if (!error) return 'Erreur inconnue.';
  if (typeof error === 'object' && error !== null && (error as { name?: string }).name === 'AbortError') {
    const reason = (error as { message?: string }).message ?? '';
    if (/timeout/i.test(reason) || reason === 'timeout') {
      return 'Délai dépassé : le serveur IA ne répond pas. Vérifie qu’Ollama (ou LM Studio) est lancé, et que l’URL est la bonne (sur un téléphone, ce n’est pas 127.0.0.1 — utilise l’IP du PC).';
    }
    return 'Requête interrompue.';
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/Failed to fetch|NetworkError|Load failed|CORS|TypeError/i.test(message) || error instanceof TypeError) {
    return (
      'Impossible de joindre le serveur IA (réseau ou CORS). Si tu utilises Ollama, relance-le avec OLLAMA_ORIGINS=* ' +
      (settings?.provider === 'ollama' ? '(et OLLAMA_HOST=0.0.0.0 si Ellie est sur un autre appareil). ' : '') +
      'Vérifie aussi que le serveur écoute bien sur l’URL indiquée.'
    );
  }
  return message;
}

function withTimeout(signal: AbortSignal | undefined, ms: number): { signal: AbortSignal; cancel: () => void } {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new DOMException('timeout', 'AbortError')), ms);
  const onAbort = () => ctrl.abort(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
  if (signal) {
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }
  return {
    signal: ctrl.signal,
    cancel: () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    },
  };
}

// fetch standard → EllieHttp (navigateur, tests, Node 18+).
export function createFetchHttp(fetchFn: typeof fetch = fetch): EllieHttp {
  return {
    async request(input) {
      const res = await fetchFn(input.url, {
        method: input.method,
        headers: input.headers,
        body: input.body,
        signal: input.signal,
      });
      const text = await res.text();
      return { ok: res.ok, status: res.status, text };
    },
    async streamLines(input, onLine) {
      const res = await fetchFn(input.url, {
        method: input.method,
        headers: input.headers,
        body: input.body,
        signal: input.signal,
      });
      if (!res.ok || !res.body || typeof res.body.getReader !== 'function') {
        const text = await res.text();
        if (res.ok) {
          for (const line of text.split('\n')) if (line.trim()) onLine(line);
        }
        return { ok: res.ok, status: res.status, text };
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) onLine(line);
        }
        buffer += decoder.decode();
        if (buffer.trim()) onLine(buffer);
      } finally {
        reader.releaseLock();
      }
      return { ok: true, status: res.status, text: '' };
    },
  };
}

export async function listEllieModels(settings: AiChatSettings, http: EllieHttp, signal?: AbortSignal): Promise<string[]> {
  const base = normalizeEllieBaseUrl(settings.baseUrl);
  const url = settings.provider === 'openai' ? `${base}/v1/models` : `${base}/api/tags`;
  const timed = withTimeout(signal, ELLIE_LIST_TIMEOUT_MS);
  try {
    const res = await http.request({ url, method: 'GET', headers: headersOf(settings), signal: timed.signal });
    if (!res.ok) throw new Error(httpErrorMessage(res, settings));
    const data = JSON.parse(res.text) as { data?: unknown; models?: unknown };
    const items = settings.provider === 'openai' ? data.data : data.models;
    if (!Array.isArray(items)) throw new Error('Liste de modèles non reconnue.');
    return items
      .map((item) => {
        if (!item || typeof item !== 'object') return '';
        const rec = item as { id?: unknown; name?: unknown; model?: unknown };
        return String(settings.provider === 'openai' ? rec.id ?? '' : rec.name ?? rec.model ?? '');
      })
      .filter(Boolean);
  } catch (error) {
    throw new Error(formatEllieError(error, settings));
  } finally {
    timed.cancel();
  }
}

export async function testEllieConnection(settings: AiChatSettings, http: EllieHttp, signal?: AbortSignal): Promise<string[]> {
  const models = await listEllieModels(settings, http, signal);
  if (settings.model && !models.includes(settings.model)) {
    throw new Error(
      `Connexion réussie, mais le modèle « ${settings.model} » n’est pas installé. Modèles disponibles : ${models.slice(0, 12).join(', ') || '(aucun)'}.` +
        (settings.provider === 'ollama' ? ` Installe-le avec : ollama pull ${settings.model}` : ''),
    );
  }
  return models;
}

function httpErrorMessage(res: EllieHttpResult, settings: AiChatSettings): string {
  let msg = res.text.slice(0, 240);
  try {
    const parsed = JSON.parse(res.text) as { error?: unknown };
    if (typeof parsed.error === 'string') msg = parsed.error;
    else if (parsed.error && typeof parsed.error === 'object' && 'message' in parsed.error) {
      msg = String((parsed.error as { message: unknown }).message);
    }
  } catch {
    /* texte brut */
  }
  if (res.status === 404 && settings.model) {
    return settings.provider === 'ollama'
      ? `Modèle « ${settings.model} » introuvable. Installe-le avec : ollama pull ${settings.model}`
      : `Modèle « ${settings.model} » introuvable sur ce serveur.`;
  }
  return `Serveur IA HTTP ${res.status} : ${msg || 'erreur'}`;
}

export function parseOllamaLine(line: string): EllieChatDelta | { error: string } | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (json.error) return { error: typeof json.error === 'string' ? json.error : JSON.stringify(json.error) };
  const message = (json.message && typeof json.message === 'object' ? json.message : {}) as {
    content?: unknown;
    tool_calls?: unknown;
  };
  return {
    content: typeof message.content === 'string' ? message.content : '',
    toolCalls: parseToolCalls(message.tool_calls),
  };
}

export function parseOpenAiSseLine(line: string): EllieChatDelta | { error: string } | 'done' | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith(':')) return null;
  if (trimmed === 'data: [DONE]') return 'done';
  if (!trimmed.startsWith('data:')) return null;
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(trimmed.slice(5).trim()) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (json.error) {
    const err = json.error;
    return { error: typeof err === 'string' ? err : String((err as { message?: unknown })?.message ?? JSON.stringify(err)) };
  }
  const choice = Array.isArray(json.choices) ? (json.choices[0] as Record<string, unknown> | undefined) : undefined;
  const delta = (choice?.delta && typeof choice.delta === 'object' ? choice.delta : {}) as {
    content?: unknown;
    tool_calls?: unknown;
  };
  return {
    content: typeof delta.content === 'string' ? delta.content : '',
    toolCalls: parseToolCalls(delta.tool_calls, true),
  };
}

function parseToolCalls(raw: unknown, incremental = false): EllieToolCall[] {
  if (!Array.isArray(raw)) return [];
  const out: EllieToolCall[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as { id?: unknown; index?: unknown; function?: { name?: unknown; arguments?: unknown } };
    const fn = rec.function ?? {};
    let args: Record<string, unknown> = {};
    if (typeof fn.arguments === 'string') {
      try {
        args = JSON.parse(fn.arguments || '{}') as Record<string, unknown>;
      } catch {
        if (incremental) args = { __raw: fn.arguments };
        else args = {};
      }
    } else if (fn.arguments && typeof fn.arguments === 'object') {
      args = fn.arguments as Record<string, unknown>;
    }
    const name = typeof fn.name === 'string' ? fn.name : '';
    if (!name && !incremental) continue;
    out.push({
      id: typeof rec.id === 'string' ? rec.id : `call_${rec.index ?? out.length}`,
      name,
      arguments: args,
    });
  }
  return out;
}

function mergeToolCalls(into: EllieToolCall[], add: EllieToolCall[]): EllieToolCall[] {
  const next = [...into];
  for (const call of add) {
    const existing = next.find((c) => c.id === call.id);
    if (!existing) {
      next.push({ ...call, arguments: { ...call.arguments } });
      continue;
    }
    if (call.name) existing.name = call.name;
    if (typeof call.arguments.__raw === 'string' || typeof existing.arguments.__raw === 'string') {
      const raw = `${existing.arguments.__raw ?? ''}${call.arguments.__raw ?? ''}`;
      try {
        existing.arguments = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        existing.arguments = { __raw: raw };
      }
    } else {
      existing.arguments = { ...existing.arguments, ...call.arguments };
    }
  }
  return next;
}

function toolsPayload(tools: EllieToolDef[] | undefined): unknown[] | undefined {
  if (!tools?.length) return undefined;
  return tools.map((tool) => ({
    type: 'function',
    function: { name: tool.name, description: tool.description, parameters: tool.inputSchema },
  }));
}

function toProviderMessages(messages: EllieChatMessage[], provider: AiChatSettings['provider']): unknown[] {
  return messages.map((m) => {
    if (provider === 'openai') {
      if (m.role === 'tool') return { role: 'tool', content: m.content, tool_call_id: m.toolCallId ?? '' };
      if (m.role === 'assistant' && m.toolCalls?.length) {
        return {
          role: 'assistant',
          content: m.content || null,
          tool_calls: m.toolCalls.map((c) => ({
            id: c.id,
            type: 'function',
            function: { name: c.name, arguments: JSON.stringify(c.arguments) },
          })),
        };
      }
      return { role: m.role, content: m.content };
    }
    if (m.role === 'tool') return { role: 'tool', content: m.content, tool_name: m.toolName ?? '' };
    if (m.role === 'assistant' && m.toolCalls?.length) {
      return {
        role: 'assistant',
        content: m.content,
        tool_calls: m.toolCalls.map((c) => ({ function: { name: c.name, arguments: c.arguments } })),
      };
    }
    return { role: m.role, content: m.content };
  });
}

export async function streamEllieChat(
  settings: AiChatSettings,
  messages: EllieChatMessage[],
  options: {
    http: EllieHttp;
    tools?: EllieToolDef[];
    signal?: AbortSignal;
    onDelta?: (fullText: string) => void;
  },
): Promise<EllieChatDelta> {
  if (!settings.model.trim()) throw new Error('Choisis un modèle dans Paramètres → 🤖 IA / Passerelle.');
  const base = normalizeEllieBaseUrl(settings.baseUrl);
  const openai = settings.provider === 'openai';
  const url = openai ? `${base}/v1/chat/completions` : `${base}/api/chat`;
  const body = openai
    ? {
        model: settings.model,
        messages: toProviderMessages(messages, 'openai'),
        stream: true,
        tools: toolsPayload(options.tools),
      }
    : {
        model: settings.model,
        messages: toProviderMessages(messages, 'ollama'),
        stream: true,
        think: false,
        keep_alive: '30m',
        tools: toolsPayload(options.tools),
      };
  const timed = withTimeout(options.signal, ELLIE_CHAT_TIMEOUT_MS);
  let full = '';
  let toolCalls: EllieToolCall[] = [];
  const onLine = (line: string) => {
    const parsed = openai ? parseOpenAiSseLine(line) : parseOllamaLine(line);
    if (!parsed || parsed === 'done') return;
    if ('error' in parsed) throw new Error(parsed.error);
    if (parsed.content) {
      full += parsed.content;
      options.onDelta?.(full);
    }
    if (parsed.toolCalls.length) toolCalls = mergeToolCalls(toolCalls, parsed.toolCalls);
  };
  try {
    const input = {
      url,
      method: 'POST',
      headers: headersOf(settings),
      body: JSON.stringify(body),
      signal: timed.signal,
    };
    const res = options.http.streamLines
      ? await options.http.streamLines(input, onLine)
      : await (async () => {
          const r = await options.http.request(input);
          if (r.ok) for (const line of r.text.split('\n')) onLine(line);
          return r;
        })();
    if (!res.ok) throw new Error(httpErrorMessage(res, settings));
    return { content: full, toolCalls: toolCalls.filter((c) => c.name) };
  } catch (error) {
    throw new Error(formatEllieError(error, settings));
  } finally {
    timed.cancel();
  }
}


// Transport du renderer : proxy Electron s'il existe (app packagée),
// sinon fetch direct (web, mobile, tests).
export function resolveEllieHttp(): EllieHttp {
  if (typeof window !== 'undefined' && window.ellie?.request) {
    return { request: window.ellie.request, streamLines: window.ellie.streamLines };
  }
  return createFetchHttp();
}
