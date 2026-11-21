import { describe, expect, it } from 'vitest';

import {
  AI_JOURNAL_MAX,
  appendAiJournal,
  decideAiAction,
  DEFAULT_AI_GATEWAY,
  generateAiToken,
  isVisibleToAi,
  normalizeAiGateway,
  parseAiJournal,
  sameTokenHash,
  type AiGatewaySettings,
} from './aiPolicy';

const on: AiGatewaySettings = { ...DEFAULT_AI_GATEWAY, enabled: true };
const locked = ['Privé', 'Journal/Santé.md'];

describe('decideAiAction', () => {
  it('désactivée par défaut : tout est refusé', () => {
    expect(decideAiAction(DEFAULT_AI_GATEWAY, [], { action: 'read', path: 'a.md' }).decision).toBe('deny');
  });

  it('lecture seule par défaut', () => {
    expect(decideAiAction(on, [], { action: 'read', path: 'a.md' }).decision).toBe('allow');
    expect(decideAiAction(on, [], { action: 'search', path: '' }).decision).toBe('allow');
    expect(decideAiAction(on, [], { action: 'edit', path: 'a.md' }).decision).toBe('deny');
  });

  it('verrouillé : toujours refusé, même tout autorisé, source ou destination', () => {
    const all: AiGatewaySettings = { ...on, permissions: { ...on.permissions, edit: 'allow', move: 'allow' } };
    expect(decideAiAction(all, locked, { action: 'read', path: 'Privé/x/y.md' })).toEqual({
      decision: 'deny',
      reason: '« Privé/x/y.md » est verrouillé pour l’IA.',
    });
    expect(decideAiAction(all, locked, { action: 'edit', path: 'journal/santé.md' }).decision).toBe('deny');
    expect(decideAiAction(all, locked, { action: 'move', path: 'a.md', destPath: 'Privé/a.md' }).decision).toBe('deny');
    expect(decideAiAction(all, locked, { action: 'move', path: 'a.md', destPath: 'B/a.md' }).decision).toBe('allow');
  });

  it('chemins invalides ou internes refusés', () => {
    for (const path of ['../x.md', 'a/../../b', '/etc/passwd', 'C:/x', '.123ecriture/preferences.json', '.trash/a.md', 'a/.git/config']) {
      expect(decideAiAction(on, [], { action: 'read', path }).decision).toBe('deny');
    }
    expect(decideAiAction(on, [], { action: 'edit', path: '' }).decision).toBe('deny');
  });

  it('dossiers autorisés', () => {
    const s: AiGatewaySettings = { ...on, allowedFolders: ['Projets'] };
    expect(decideAiAction(s, [], { action: 'read', path: 'Projets/a.md' }).decision).toBe('allow');
    expect(decideAiAction(s, [], { action: 'read', path: 'Perso/a.md' }).decision).toBe('deny');
    expect(isVisibleToAi(s, [], 'Projets/a.md')).toBe(true);
    expect(isVisibleToAi(s, ['Projets/Secret'], 'Projets/Secret/a.md')).toBe(false);
  });

  it('Demander', () => {
    const s: AiGatewaySettings = { ...on, permissions: { ...on.permissions, create: 'ask' } };
    expect(decideAiAction(s, [], { action: 'create', path: 'Nouveau.md' }).decision).toBe('ask');
  });
});

describe('réglage, jeton, journal', () => {
  it('normalisation tolérante', () => {
    const n = normalizeAiGateway({ enabled: 'oui', permissions: { edit: 'allow', read: 'n’importe' }, tokenHash: 'abc' });
    expect(n.enabled).toBe(false);
    expect(n.permissions.edit).toBe('allow');
    expect(n.permissions.read).toBe('allow');
    expect(n.tokenHash).toBeUndefined();
    expect(normalizeAiGateway(null)).toEqual(DEFAULT_AI_GATEWAY);
  });

  it('jeton aléatoire, comparaison', () => {
    const a = generateAiToken();
    const b = generateAiToken();
    expect(a).toMatch(/^ecr_[A-Za-z0-9_-]{40,}$/);
    expect(a).not.toBe(b);
    expect(sameTokenHash('ab', 'ab')).toBe(true);
    expect(sameTokenHash('ab', 'ac')).toBe(false);
  });

  it('journal borné, plus récent en premier', () => {
    let j = parseAiJournal('pas du json');
    for (let i = 0; i < AI_JOURNAL_MAX + 5; i += 1) {
      j = appendAiJournal(j, { at: String(i), action: 'read', path: 'a', decision: 'allow', reason: '' });
    }
    expect(j).toHaveLength(AI_JOURNAL_MAX);
    expect(j[0].at).toBe(String(AI_JOURNAL_MAX + 4));
    expect(parseAiJournal(JSON.stringify(j.slice(0, 2)))).toHaveLength(2);
  });
});
