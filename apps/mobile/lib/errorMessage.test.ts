import { describe, expect, it } from 'vitest';

import { errorMessage } from './errorMessage';

// Le cas de régression qui a motivé ce helper : un PostgrestError Supabase
// (objet plat, pas une Error) rendu par String() donnait « [object Object] »
// dans l'UI à la place du vrai message.
describe('errorMessage', () => {
  it('extrait le message d’une vraie Error', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom');
  });

  it('extrait message + code d’un PostgrestError (objet plat)', () => {
    const postgrest = { message: 'duplicate key value violates unique constraint', code: '23505', details: null, hint: null };
    expect(errorMessage(postgrest)).toBe(
      'duplicate key value violates unique constraint (code 23505)',
    );
  });

  it('affiche l’objet sérialisé quand il n’a pas de message', () => {
    expect(errorMessage({ weird: 42 })).toBe('{"weird":42}');
  });

  it('laisse passer les chaînes telles quelles', () => {
    expect(errorMessage('échec réseau')).toBe('échec réseau');
  });

  it('dégrade proprement les valeurs primitives', () => {
    expect(errorMessage(42)).toBe('42');
    expect(errorMessage(null)).toBe('null');
    expect(errorMessage(undefined)).toBe('undefined');
  });

  it('survit à un objet circulaire (repli String)', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(typeof errorMessage(circular)).toBe('string');
  });
});
