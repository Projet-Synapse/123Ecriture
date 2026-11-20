import { describe, expect, it } from 'vitest';

import {
  BACK_PRIORITY,
  createBackStack,
  EXIT_CONFIRM_WINDOW_MS,
  popNoteHistory,
  pushNoteHistory,
  shouldExitOnBack,
} from './backStack';

describe('createBackStack', () => {
  it("respecte l'ordre : panneaux, section, fichier précédent, explorateur, sauvegarde, racine", () => {
    const stack = createBackStack();
    const calls: string[] = [];
    const add = (name: string, priority: number, consume: boolean) =>
      stack.register(priority, () => {
        calls.push(name);
        return consume;
      });
    add('root', BACK_PRIORITY.ROOT, true);
    add('save', BACK_PRIORITY.SAVE, false);
    add('explorer', BACK_PRIORITY.EXPLORER, false);
    add('history', BACK_PRIORITY.HISTORY, false);
    add('section', BACK_PRIORITY.SECTION, false);
    add('overlay', BACK_PRIORITY.OVERLAY, false);
    expect(stack.dispatch()).toBe(true);
    expect(calls).toEqual(['overlay', 'section', 'history', 'explorer', 'save', 'root']);
  });

  it("s'arrête au premier gestionnaire qui consomme", () => {
    const stack = createBackStack();
    const calls: string[] = [];
    stack.register(BACK_PRIORITY.EXPLORER, () => (calls.push('explorer'), true));
    stack.register(BACK_PRIORITY.ROOT, () => (calls.push('root'), true));
    expect(stack.dispatch()).toBe(true);
    expect(calls).toEqual(['explorer']);
  });

  it('à priorité égale, le plus récent passe en premier ; désinscription', () => {
    const stack = createBackStack();
    const calls: string[] = [];
    stack.register(BACK_PRIORITY.OVERLAY, () => (calls.push('ancien'), true));
    const off = stack.register(BACK_PRIORITY.OVERLAY, () => (calls.push('récent'), true));
    stack.dispatch();
    off();
    stack.dispatch();
    expect(calls).toEqual(['récent', 'ancien']);
  });

  it('rien d’inscrit → appui non consommé (comportement Android par défaut)', () => {
    expect(createBackStack().dispatch()).toBe(false);
  });
});

describe('shouldExitOnBack', () => {
  it('quitte seulement sur un 2e appui rapproché', () => {
    expect(shouldExitOnBack(1000, null)).toBe(false);
    expect(shouldExitOnBack(1000 + EXIT_CONFIRM_WINDOW_MS, 1000)).toBe(true);
    expect(shouldExitOnBack(1001 + EXIT_CONFIRM_WINDOW_MS, 1000)).toBe(false);
  });
});

describe('historique des fichiers', () => {
  it('empile la note quittée, sans doublon', () => {
    let h = pushNoteHistory([], null, 'a.md');
    expect(h).toEqual([]);
    h = pushNoteHistory(h, 'a.md', 'b.md');
    h = pushNoteHistory(h, 'b.md', 'a.md');
    h = pushNoteHistory(h, 'a.md', 'a.md');
    expect(h).toEqual(['b.md']);
    h = pushNoteHistory(['a.md', 'b.md'], 'a.md', 'c.md');
    expect(h).toEqual(['b.md', 'a.md']);
  });

  it('dépile en sautant les fichiers disparus et la note courante', () => {
    const exists = (p: string) => p !== 'supprime.md';
    expect(popNoteHistory(['a.md', 'supprime.md', 'c.md'], 'c.md', exists)).toEqual({ target: 'a.md', history: [] });
    expect(popNoteHistory(['a.md', 'b.md'], 'c.md', exists)).toEqual({ target: 'b.md', history: ['a.md'] });
    expect(popNoteHistory([], 'c.md', exists)).toEqual({ target: null, history: [] });
  });
});
