import { describe, expect, it } from 'vitest';

import { parseAuthCallbackUrl } from './authCallback';

// Cas réels du flux desktop : l'URL arrive via le protocole custom
// app123ecriture:// (relais 'second-instance' ou démarrage à froid argv).
describe('parseAuthCallbackUrl', () => {
  it('extrait code + sb_flow_id du callback nominal', () => {
    expect(
      parseAuthCallbackUrl(
        'app123ecriture://auth-callback?code=abc-123&sb_flow_id=bc73cd48cd73af9fa20a3abed37efc73',
      ),
    ).toEqual({
      code: 'abc-123',
      flowId: 'bc73cd48cd73af9fa20a3abed37efc73',
      error: null,
    });
  });

  it('tolère l’ordre inverse des paramètres', () => {
    expect(
      parseAuthCallbackUrl('app123ecriture://auth-callback?sb_flow_id=flow1&code=xyz'),
    ).toEqual({ code: 'xyz', flowId: 'flow1', error: null });
  });

  it('renvoie code null sans query — rien à échanger, pas d’exception', () => {
    expect(parseAuthCallbackUrl('app123ecriture://auth-callback')).toEqual({
      code: null,
      flowId: null,
      error: null,
    });
  });

  it('surfaces l’erreur OAuth (error + description) en priorité', () => {
    expect(
      parseAuthCallbackUrl(
        'app123ecriture://auth-callback?error=access_denied&error_description=L%27utilisateur+a+refus%C3%A9',
      ),
    ).toEqual({ code: null, flowId: null, error: "L'utilisateur a refusé" });
  });

  it('error sans description renvoie le code d’erreur brut', () => {
    expect(parseAuthCallbackUrl('app123ecriture://auth-callback?error=server_error')).toEqual({
      code: null,
      flowId: null,
      error: 'server_error',
    });
  });

  it('les valeurs encodées (redirect_to imbriqué, etc.) sont décodées', () => {
    expect(parseAuthCallbackUrl('app123ecriture://cb?code=a%2Bb%3Dc')).toMatchObject({
      code: 'a+b=c',
    });
  });
});
