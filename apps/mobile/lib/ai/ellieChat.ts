// ✒️ 123ECRITURE — lib/ai/ellieChat.ts — un tour de conversation Ellie (outils + contexte)
//////////////////////////////////////////////////////////////////////////////
//
// Orchestre un tour de chat : prompt système, note courante éventuelle,
// appels d'outils list/read/search (même décision que la passerelle MCP :
// decideAiAction / isVisibleToAi, journal), ou injection du contexte si
// le modèle ne renvoie pas d'appels d'outils. Lecture seule : aucune
// écriture dans le coffre.
//
//////////////////////////////////////////////////////////////////////////////

import { decideAiAction, type AiGatewaySettings } from './aiPolicy';
import { streamEllieChat, type EllieChatMessage, type EllieHttp, type EllieToolCall, type EllieToolDef } from './ellieClient';
import type { AiChatSettings } from './ellieSettings';
import { MCP_MAX_READ_BYTES, MCP_TOOLS, runVaultAiTool, type McpDeps } from './mcpCore';

export const ELLIE_MAX_TOOL_ROUNDS = 8;
export const ELLIE_NOTE_MAX_CHARS = MCP_MAX_READ_BYTES;

export const ELLIE_TOOLS: EllieToolDef[] = MCP_TOOLS.map((tool) => ({
  name: tool.name,
  description: tool.description,
  inputSchema: tool.inputSchema,
}));

export type EllieNoteContext = { relPath: string; name: string; content: string };

export type EllieTurnResult = {
  content: string;
  messages: EllieChatMessage[];
};

export function buildEllieSystemPrompt(
  settings: AiChatSettings,
  note: EllieNoteContext | null,
  includeNote: boolean,
  noteDeniedReason?: string,
): string {
  const base = settings.systemPrompt.trim() || 'Tu es Ellie, une assistante d’écriture en lecture seule.';
  const parts = [base];
  if (noteDeniedReason) {
    parts.push(`La note ouverte n’a pas été jointe : ${noteDeniedReason}`);
  } else if (includeNote && note) {
    const body = note.content.length > ELLIE_NOTE_MAX_CHARS ? `${note.content.slice(0, ELLIE_NOTE_MAX_CHARS)}\n… (tronqué)` : note.content;
    parts.push(`Note courante jointe (lecture seule) : « ${note.name} » (${note.relPath}).\n\n${body}`);
  }
  return parts.join('\n\n');
}

export function canIncludeCurrentNote(
  gateway: AiGatewaySettings,
  locked: readonly string[],
  relPath: string | undefined,
): { ok: true } | { ok: false; reason: string } {
  if (!relPath) return { ok: false, reason: 'Aucune note ouverte.' };
  const decision = decideAiAction(gateway, locked, { action: 'read', path: relPath });
  if (decision.decision !== 'allow') return { ok: false, reason: decision.reason };
  return { ok: true };
}

function toolMessages(calls: EllieToolCall[], results: { call: EllieToolCall; text: string }[]): EllieChatMessage[] {
  return [
    { role: 'assistant', content: '', toolCalls: calls },
    ...results.map((r) => ({
      role: 'tool' as const,
      content: r.text,
      toolCallId: r.call.id,
      toolName: r.call.name,
    })),
  ];
}

export async function runEllieTurn(options: {
  settings: AiChatSettings;
  gateway: AiGatewaySettings;
  history: EllieChatMessage[];
  userText: string;
  includeNote: boolean;
  note: EllieNoteContext | null;
  http: EllieHttp;
  vault: McpDeps;
  signal?: AbortSignal;
  onDelta?: (fullText: string) => void;
  // false = ne pas envoyer les outils (repli : contexte injecté seulement).
  useTools?: boolean;
}): Promise<EllieTurnResult> {
  if (!options.gateway.enabled) {
    throw new Error('L’IA n’est pas activée. Va dans Paramètres → 🤖 IA / Passerelle et coche « Activer la passerelle IA ».');
  }
  const inclusion = options.includeNote && options.note ? canIncludeCurrentNote(options.gateway, (await options.vault.load()).locked, options.note.relPath) : null;
  const noteDenied = inclusion && !inclusion.ok ? inclusion.reason : undefined;
  const note = inclusion?.ok && options.note ? options.note : null;
  const system = buildEllieSystemPrompt(options.settings, note, options.includeNote, noteDenied);
  const messages: EllieChatMessage[] = [
    { role: 'system', content: system },
    ...options.history.filter((m) => m.role !== 'system'),
    { role: 'user', content: options.userText },
  ];

  const useTools = options.useTools !== false;
  let last = { content: '', toolCalls: [] as EllieToolCall[] };
  for (let round = 0; round < ELLIE_MAX_TOOL_ROUNDS; round += 1) {
    last = await streamEllieChat(options.settings, messages, {
      http: options.http,
      tools: useTools ? ELLIE_TOOLS : undefined,
      signal: options.signal,
      onDelta: options.onDelta,
    });
    if (!useTools || last.toolCalls.length === 0) break;
    const results = [];
    for (const call of last.toolCalls) {
      const result = await runVaultAiTool(call.name, call.arguments, options.vault);
      const text = result.content.map((c) => c.text).join('\n');
      results.push({ call, text: result.isError ? `Refusé : ${text}` : text });
    }
    messages.push(...toolMessages(last.toolCalls, results));
    options.onDelta?.('');
  }
  messages.push({ role: 'assistant', content: last.content });
  return { content: last.content, messages };
}
