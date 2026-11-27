// ✒️ 123ECRITURE — lib/ai/ellieSuggestions.ts — analyse d'une note par Ellie (ampoule)
//////////////////////////////////////////////////////////////////////////////
//
// Demande d'analyse de la note ouverte (bouton 💡) : prompt, découpage
// de la réponse en suggestions, et règle d'accès (IA activée, fichier
// non verrouillé). Module PUR, testé (ellieSuggestions.test.ts).
//
//////////////////////////////////////////////////////////////////////////////

import { decideAiAction, type AiGatewaySettings } from './aiPolicy';

export const ELLIE_ANALYZE_PROMPT =
  'Analyse la note jointe et propose des améliorations concrètes (structure, clarté, style, trous, enchaînements). Réponds UNIQUEMENT par une liste à puces Markdown, une suggestion par puce, courte et actionnable. Pas d’introduction ni de conclusion.';

const ITEM_START = /^\s*(?:[-*•+]|\d+[.)])\s+/;

export function parseEllieSuggestions(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const items: string[] = [];
  let current = '';
  for (const line of trimmed.split(/\n/)) {
    if (ITEM_START.test(line)) {
      if (current.trim()) items.push(current.trim());
      current = line.replace(ITEM_START, '');
    } else if (current) {
      current = `${current}\n${line.trimEnd()}`;
    }
  }
  if (current.trim()) items.push(current.trim());
  if (items.length > 0) return items.map((item) => item.trim()).filter(Boolean);
  return trimmed
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

export function canRequestEllieAnalysis(
  gateway: AiGatewaySettings,
  lockedPaths: readonly string[],
  relPath: string | undefined,
): { ok: true } | { ok: false; reason: string } {
  if (!gateway.enabled) {
    return { ok: false, reason: 'L’IA n’est pas activée. Va dans Paramètres → 🤖 IA / Passerelle.' };
  }
  if (!relPath) return { ok: false, reason: 'Aucune note ouverte.' };
  const decision = decideAiAction(gateway, lockedPaths, { action: 'read', path: relPath });
  if (decision.decision !== 'allow') return { ok: false, reason: decision.reason };
  return { ok: true };
}

// File d'attente d'une suggestion à montrer dans le panneau Ellie : si le
// panneau n'est pas encore monté (onglet fermé), le texte est conservé et
// consommé à l'abonnement.
const suggestionListeners = new Set<(text: string) => void>();
let pendingSuggestion: string | null = null;

export function queueEllieSuggestion(text: string): void {
  const body = text.trim();
  if (!body) return;
  if (suggestionListeners.size === 0) {
    pendingSuggestion = body;
    return;
  }
  pendingSuggestion = null;
  // Un seul destinataire : éviter d'ajouter deux fois le même message si
  // le panneau sidebar et la feuille mobile sont montés ensemble.
  const listener = [...suggestionListeners].at(-1);
  listener?.(body);
}

export function subscribeEllieSuggestion(listener: (text: string) => void): () => void {
  suggestionListeners.add(listener);
  if (pendingSuggestion) {
    const queued = pendingSuggestion;
    pendingSuggestion = null;
    listener(queued);
  }
  return () => {
    suggestionListeners.delete(listener);
  };
}
