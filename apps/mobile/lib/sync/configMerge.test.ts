import { describe, expect, it } from 'vitest';
import { configConflictBackupPath, isStructuredConfigFile, mergeConfigJson } from './configMerge';
import { isHashableRelPath } from './syncRules';

const j = (v: unknown) => JSON.stringify(v, null, 2);
const parsed = (r: ReturnType<typeof mergeConfigJson>) => {
  if (r.kind !== 'merged') throw new Error(r.kind);
  return JSON.parse(r.text);
};

describe('mergeConfigJson — tasks.json (par id)', () => {
  const t = (id: string, extra: Record<string, unknown> = {}) => ({ id, title: id, done: false, ...extra });

  it('une suppression locale ne revient pas si le cloud n’a pas touché la tâche', () => {
    const base = j([t('a'), t('b')]);
    const local = j([t('a')]);
    const remote = j([t('a'), t('b')]);
    expect(parsed(mergeConfigJson(base, local, remote)).map((x: { id: string }) => x.id)).toEqual(['a']);
  });

  it('une suppression côté cloud est appliquée', () => {
    const base = j([t('a'), t('b')]);
    expect(parsed(mergeConfigJson(base, base, j([t('b')]))).map((x: { id: string }) => x.id)).toEqual(['b']);
  });

  it('ajouts des deux côtés réunis, modifs de champs différents fusionnées', () => {
    const base = j([t('a')]);
    const local = j([t('n1'), t('a', { done: true })]);
    const remote = j([t('a', { title: 'A2' }), t('n2')]);
    const out = parsed(mergeConfigJson(base, local, remote));
    expect(out.map((x: { id: string }) => x.id).sort()).toEqual(['a', 'n1', 'n2']);
    expect(out.find((x: { id: string }) => x.id === 'a')).toEqual({ id: 'a', title: 'A2', done: true });
  });

  it('même champ modifié des deux côtés : le cloud gagne', () => {
    const base = j([t('a')]);
    const out = parsed(mergeConfigJson(base, j([t('a', { title: 'L' })]), j([t('a', { title: 'R' })])));
    expect(out[0].title).toBe('R');
  });

  it('suppression d’un côté + modification de l’autre : la tâche est gardée (rien perdu)', () => {
    const base = j([t('a')]);
    const out = parsed(mergeConfigJson(base, j([]), j([t('a', { done: true })])));
    expect(out).toEqual([t('a', { done: true })]);
  });
});

describe('mergeConfigJson — tasklists.json et preferences.json', () => {
  it('listes par id + activeListId par clé', () => {
    const base = j({ lists: [{ id: 'l1', name: 'Tâches' }], activeListId: 'l1' });
    const local = j({ lists: [{ id: 'l1', name: 'Tâches' }, { id: 'l2', name: 'Perso' }], activeListId: 'l2' });
    const remote = j({ lists: [{ id: 'l1', name: 'Boulot' }], activeListId: 'l1' });
    expect(parsed(mergeConfigJson(base, local, remote))).toEqual({
      lists: [{ id: 'l1', name: 'Boulot' }, { id: 'l2', name: 'Perso' }],
      activeListId: 'l2',
    });
  });

  it('un côté INCHANGÉ ne l’emporte jamais : themeMode changé sur le téléphone reste', () => {
    const base = j({ themeMode: 'light', fontSize: 16 });
    const local = j({ themeMode: 'light', fontSize: 18 }); // PC : police seulement
    const remote = j({ themeMode: 'dark', fontSize: 16 }); // téléphone : thème
    expect(parsed(mergeConfigJson(base, local, remote))).toEqual({ themeMode: 'dark', fontSize: 18 });
    // symétrique
    expect(parsed(mergeConfigJson(base, remote, local))).toEqual({ themeMode: 'dark', fontSize: 18 });
  });

  it('clé retirée d’un côté seulement : retirée', () => {
    const base = j({ a: 1, b: 2 });
    expect(parsed(mergeConfigJson(base, j({ a: 1 }), base))).toEqual({ a: 1 });
  });

  it('résultat identique au cloud : texte du cloud réutilisé tel quel', () => {
    const base = j({ a: 1 });
    const remote = '{"a":2}';
    const r = mergeConfigJson(base, base, remote);
    expect(r).toMatchObject({ kind: 'merged', text: remote });
  });
});

describe('mergeConfigJson — replis', () => {
  it('sans base : le cloud gagne', () => {
    expect(mergeConfigJson(null, j({ a: 1 }), j({ a: 2 }))).toEqual({ kind: 'remote-wins', reason: 'no-base' });
  });
  it('base, local ou distant illisible : le cloud gagne', () => {
    expect(mergeConfigJson('{', j({}), j({})).kind).toBe('remote-wins');
    expect(mergeConfigJson(j({}), '{', j({})).kind).toBe('remote-wins');
    expect(mergeConfigJson(j({}), j({}), 'xx').kind).toBe('remote-wins');
  });
});

describe('fichiers de conflit', () => {
  it('chemin .conflict local, jamais synchronisé', () => {
    const p = configConflictBackupPath('.123ecriture/preferences.json', new Date('2026-10-24T14:43:00.000Z'));
    expect(p).toBe('.123ecriture/preferences.conflict-2026-10-24T14-43-00-000Z.json');
    expect(isHashableRelPath(p)).toBe(false);
  });
  it('seuls les 3 fichiers JSON de configuration sont concernés (appearance hors périmètre)', () => {
    expect(isStructuredConfigFile('.123ecriture/tasks.json')).toBe(true);
    expect(isStructuredConfigFile('.123ecriture/tasklists.json')).toBe(true);
    expect(isStructuredConfigFile('.123ecriture/preferences.json')).toBe(true);
    expect(isStructuredConfigFile('.123ecriture/appearance.json')).toBe(false);
    expect(isStructuredConfigFile('notes/x.json')).toBe(false);
  });
});
