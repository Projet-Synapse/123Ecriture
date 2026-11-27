import { describe, expect, it } from 'vitest';

import {
  newConversation,
  parseEllieConversations,
  serializeEllieConversations,
  titleFromUserText,
  upsertConversation,
  ELLIE_CONVERSATIONS_MAX,
} from './ellieStore';

describe('ellieStore', () => {
  it('parse un JSON invalide ou partiel sans planter', () => {
    expect(parseEllieConversations(undefined)).toEqual([]);
    expect(parseEllieConversations('nope')).toEqual([]);
    expect(parseEllieConversations('{"x":1}')).toEqual([]);
    const [c] = parseEllieConversations(JSON.stringify([{ id: 'a', title: 'T', createdAt: '1', updatedAt: '2', messages: [{ id: 'm', role: 'user', content: 'hi', at: '1' }] }]));
    expect(c).toMatchObject({ id: 'a', title: 'T', messages: [{ content: 'hi' }] });
  });

  it('crée, titre et replace une conversation en tête', () => {
    const a = newConversation(new Date('2026-01-01T00:00:00Z'));
    const b = { ...a, title: titleFromUserText('  Un très long titre qui doit être coupé clairement ici  '), updatedAt: 'later' };
    expect(b.title.endsWith('…')).toBe(true);
    const list = upsertConversation([], b);
    const again = upsertConversation(list, { ...b, messages: [{ id: 'm', role: 'assistant', content: 'ok', at: 'x' }] });
    expect(again).toHaveLength(1);
    expect(again[0].messages[0].content).toBe('ok');
    expect(serializeEllieConversations(again)).toContain('ok');
  });

  it('borne le nombre de conversations conservées', () => {
    let list: ReturnType<typeof newConversation>[] = [];
    for (let i = 0; i < ELLIE_CONVERSATIONS_MAX + 5; i += 1) {
      list = upsertConversation(list, { ...newConversation(), id: `id-${i}` });
    }
    expect(list).toHaveLength(ELLIE_CONVERSATIONS_MAX);
    expect(list[0].id).toBe(`id-${ELLIE_CONVERSATIONS_MAX + 4}`);
  });
});
