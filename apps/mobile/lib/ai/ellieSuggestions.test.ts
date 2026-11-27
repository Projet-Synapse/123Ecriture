import { describe, expect, it } from 'vitest';

import { DEFAULT_AI_GATEWAY, type AiGatewaySettings } from './aiPolicy';
import { canRequestEllieAnalysis, parseEllieSuggestions, queueEllieSuggestion, subscribeEllieSuggestion } from './ellieSuggestions';

const enabled: AiGatewaySettings = { ...DEFAULT_AI_GATEWAY, enabled: true };

describe('parseEllieSuggestions', () => {
  it('découpe une liste à puces ou numérotée', () => {
    expect(parseEllieSuggestions('')).toEqual([]);
    expect(parseEllieSuggestions('- Clarifier le titre\n- Couper le second paragraphe\n* Ajouter une transition')).toEqual([
      'Clarifier le titre',
      'Couper le second paragraphe',
      'Ajouter une transition',
    ]);
    expect(parseEllieSuggestions('1. Premier\n2. Deuxième\n3) Troisième')).toEqual(['Premier', 'Deuxième', 'Troisième']);
  });

  it('assemble les lignes de suite d’une même puce, et replie sur les paragraphes', () => {
    expect(parseEllieSuggestions('- Un point\n  qui continue\n- Autre')).toEqual(['Un point\n  qui continue', 'Autre']);
    expect(parseEllieSuggestions('D’abord ceci.\n\nEnsuite cela.')).toEqual(['D’abord ceci.', 'Ensuite cela.']);
    expect(parseEllieSuggestions('Une seule idée.')).toEqual(['Une seule idée.']);
  });
});

describe('canRequestEllieAnalysis', () => {
  it('refuse si l’IA est éteinte, s’il n’y a pas de note, ou si le fichier est verrouillé', () => {
    expect(canRequestEllieAnalysis(DEFAULT_AI_GATEWAY, [], 'A.md').ok).toBe(false);
    expect(canRequestEllieAnalysis(enabled, [], undefined).ok).toBe(false);
    expect(canRequestEllieAnalysis(enabled, ['Privé'], 'Privé/x.md').ok).toBe(false);
    expect(canRequestEllieAnalysis(enabled, ['Privé'], 'Public.md')).toEqual({ ok: true });
  });
});

describe('queueEllieSuggestion', () => {
  it('délivre tout de suite s’il y a un abonné, sinon attend l’abonnement', () => {
    const seen: string[] = [];
    queueEllieSuggestion('  plus tard  ');
    const off = subscribeEllieSuggestion((text) => seen.push(text));
    expect(seen).toEqual(['plus tard']);
    queueEllieSuggestion('maintenant');
    expect(seen).toEqual(['plus tard', 'maintenant']);
    off();
  });
});
