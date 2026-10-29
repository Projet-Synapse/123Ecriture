import { describe, expect, it } from 'vitest';
import { findDuplicateKey, validateConfigText } from './configGuard';

const T = '.123ecriture/tasks.json';
const L = '.123ecriture/tasklists.json';

describe('configGuard — clés en double', () => {
  it('détecte la clé en double de l’incident (dueDate)', () => {
    const txt = '[{"id":"a","listId":"l","dueDate":null,"text":"x","dueDate":null}]';
    expect(findDuplicateKey(txt)).toBe('dueDate');
    expect(validateConfigText(T, txt).ok).toBe(false);
  });
  it('mêmes clés dans des objets différents : OK ; clé dans une chaîne : ignorée', () => {
    expect(findDuplicateKey('[{"id":"a","t":"\\"id\\": 1, \\"id\\""},{"id":"b"}]')).toBeNull();
    expect(findDuplicateKey('{"a":{"x":1},"b":{"x":2}}')).toBeNull();
  });
  it('double au niveau imbriqué', () => {
    expect(findDuplicateKey('{"a":{"x":1,"y":[1,{"z":1}],"x":2}}')).toBe('x');
  });
});

describe('configGuard — forme', () => {
  it('tasks.json : tableau d’objets avec id et listId', () => {
    expect(validateConfigText(T, '[]').ok).toBe(true);
    expect(validateConfigText(T, JSON.stringify([{ id: 'a', listId: 'l', text: 't' }], null, 2)).ok).toBe(true);
    expect(validateConfigText(T, '{}').ok).toBe(false);
    expect(validateConfigText(T, '[{"id":"a"}]').ok).toBe(false);
    expect(validateConfigText(T, '[{"id":"a","listId":null}]').ok).toBe(false);
    expect(validateConfigText(T, '[1]').ok).toBe(false);
    expect(validateConfigText(T, 'pas du json').ok).toBe(false);
  });
  it('tasklists.json : { lists: [objets avec id] }', () => {
    expect(validateConfigText(L, '{"lists":[{"id":"l","name":"T"}],"activeListId":"l"}').ok).toBe(true);
    expect(validateConfigText(L, '{"lists":[{"name":"T"}]}').ok).toBe(false);
    expect(validateConfigText(L, '[]').ok).toBe(false);
  });
  it('preferences / appearance : objet', () => {
    expect(validateConfigText('.123ecriture/preferences.json', '{"themeMode":"dark"}').ok).toBe(true);
    expect(validateConfigText('.123ecriture/appearance.json', '[]').ok).toBe(false);
  });
});

describe('events.json (Calendrier)', () => {
  it('accepte un tableau d’évènements avec id', () => {
    expect(validateConfigText('.123ecriture/events.json', '[{"id":"e1","title":"A","date":"2026-10-28"}]').ok).toBe(true);
  });
  it('refuse un objet ou un évènement sans id', () => {
    expect(validateConfigText('.123ecriture/events.json', '{}').ok).toBe(false);
    expect(validateConfigText('.123ecriture/events.json', '[{"title":"A"}]').ok).toBe(false);
  });
});
