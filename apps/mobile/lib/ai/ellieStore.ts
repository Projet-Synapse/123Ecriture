// ✒️ 123ECRITURE — lib/ai/ellieStore.ts — conversations Ellie sauvegardées localement
//////////////////////////////////////////////////////////////////////////////
//
// Historique des conversations Ellie, fichier LOCAL du coffre
// (`.123ecriture/ellie-conversations.json`, jamais synchronisé — comme le
// journal IA). Module PUR : lecture / écriture injectées par l'appelant.
//
//////////////////////////////////////////////////////////////////////////////

export const ELLIE_CONVERSATIONS_PATH = '.123ecriture/ellie-conversations.json';
export const ELLIE_CONVERSATIONS_MAX = 50;
export const ELLIE_MESSAGES_MAX = 200;

export type EllieStoredMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  at: string;
};

export type EllieConversation = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: EllieStoredMessage[];
};

export function parseEllieConversations(text: string | null | undefined): EllieConversation[] {
  if (!text) return [];
  try {
    const data = JSON.parse(text) as unknown;
    if (!Array.isArray(data)) return [];
    return data
      .filter((c): c is EllieConversation => !!c && typeof c === 'object' && typeof (c as EllieConversation).id === 'string')
      .map((c) => ({
        id: c.id,
        title: typeof c.title === 'string' && c.title.trim() ? c.title : 'Sans titre',
        createdAt: typeof c.createdAt === 'string' ? c.createdAt : '',
        updatedAt: typeof c.updatedAt === 'string' ? c.updatedAt : '',
        messages: Array.isArray(c.messages)
          ? c.messages.filter(
              (m): m is EllieStoredMessage =>
                !!m && typeof m === 'object' && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string',
            )
          : [],
      }));
  } catch {
    return [];
  }
}

export function serializeEllieConversations(conversations: readonly EllieConversation[]): string {
  return `${JSON.stringify(conversations.slice(0, ELLIE_CONVERSATIONS_MAX), null, 2)}\n`;
}

export function titleFromUserText(text: string): string {
  const line = text.trim().split(/\s+/).join(' ');
  if (!line) return 'Nouvelle conversation';
  return line.length > 48 ? `${line.slice(0, 45)}…` : line;
}

export function upsertConversation(
  conversations: readonly EllieConversation[],
  conversation: EllieConversation,
): EllieConversation[] {
  const trimmed: EllieConversation = {
    ...conversation,
    messages: conversation.messages.slice(-ELLIE_MESSAGES_MAX),
    updatedAt: conversation.updatedAt,
  };
  const without = conversations.filter((c) => c.id !== trimmed.id);
  return [trimmed, ...without].slice(0, ELLIE_CONVERSATIONS_MAX);
}

export function newConversation(now = new Date()): EllieConversation {
  const at = now.toISOString();
  return { id: `ellie_${now.getTime().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`, title: 'Nouvelle conversation', createdAt: at, updatedAt: at, messages: [] };
}
