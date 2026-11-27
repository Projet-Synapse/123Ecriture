// ✒️ 123ECRITURE — lib/ai/ellieSettings.ts — réglages du chat Ellie (IA locale)
//////////////////////////////////////////////////////////////////////////////
//
// Réglages du panneau « Ellie » (chat dans l'app) : fournisseur Ollama ou
// OpenAI-compatible / LM Studio, URL, modèle, nom et prompt système.
// Module PUR, partagé renderer / Electron. L'activation du chat suit
// `aiGateway.enabled` (Paramètres → 🤖 IA / Passerelle) : sans ça, le
// panneau reste inerte et decideAiAction refuse toute lecture du coffre.
//
//////////////////////////////////////////////////////////////////////////////

import { assertLocalHttpAllowed } from './localHttpGuard';

export type AiChatProvider = 'ollama' | 'openai';

export type AiChatSettings = {
  provider: AiChatProvider;
  // Sans slash final, avec ou sans `/v1` (normalisé).
  baseUrl: string;
  model: string;
  // Nom affiché (défaut « Ellie »).
  name: string;
  systemPrompt: string;
  // Option par défaut du panneau : joindre la note ouverte au message.
  includeCurrentNote: boolean;
  // Clé optionnelle (API compatible OpenAI). Vide pour LM Studio local.
  apiKey?: string;
};

export const DEFAULT_ELLIE_URL = 'http://127.0.0.1:11434';
export const DEFAULT_ELLIE_MODEL = 'qwen3:8b';
export const DEFAULT_ELLIE_NAME = 'Ellie';

export const DEFAULT_ELLIE_SYSTEM_PROMPT = `Tu es Ellie, l'assistante d'écriture de cette utilisatrice dans 123Écriture. Tu l'aides à penser, structurer, relire et explorer ses notes. Tu as accès en lecture seule au coffre (outils list_files, read_file, search). Tu n'écris jamais directement dans les fichiers : tu proposes des passages, qu'elle pourra copier ou insérer d'un clic. Réponds en français, clairement et sans pathos. Si une information est dans le coffre, cherche-la plutôt que d'inventer.`;

export const DEFAULT_AI_CHAT: AiChatSettings = {
  provider: 'ollama',
  baseUrl: DEFAULT_ELLIE_URL,
  model: DEFAULT_ELLIE_MODEL,
  name: DEFAULT_ELLIE_NAME,
  systemPrompt: DEFAULT_ELLIE_SYSTEM_PROMPT,
  includeCurrentNote: true,
};

const PROVIDERS: AiChatProvider[] = ['ollama', 'openai'];

export function normalizeAiChat(raw: unknown): AiChatSettings {
  const r = raw && typeof raw === 'object' ? (raw as Partial<AiChatSettings>) : {};
  const out: AiChatSettings = {
    provider: PROVIDERS.includes(r.provider as AiChatProvider) ? (r.provider as AiChatProvider) : DEFAULT_AI_CHAT.provider,
    baseUrl: typeof r.baseUrl === 'string' && r.baseUrl.trim() ? r.baseUrl.trim() : DEFAULT_AI_CHAT.baseUrl,
    model: typeof r.model === 'string' ? r.model.trim() : DEFAULT_AI_CHAT.model,
    name: typeof r.name === 'string' && r.name.trim() ? r.name.trim() : DEFAULT_AI_CHAT.name,
    systemPrompt: typeof r.systemPrompt === 'string' ? r.systemPrompt : DEFAULT_AI_CHAT.systemPrompt,
    includeCurrentNote: r.includeCurrentNote !== false,
  };
  if (typeof r.apiKey === 'string' && r.apiKey.trim()) out.apiKey = r.apiKey.trim();
  return out;
}

// URL HTTP(S) sans identifiants. Le suffixe `/v1` est retiré (il est
// rajouté pour l'API OpenAI). Lève une erreur lisible si l'URL est invalide.
export function normalizeEllieBaseUrl(url: string): string {
  const trimmed = url.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`URL invalide : « ${trimmed || '(vide)'} ». Exemple : ${DEFAULT_ELLIE_URL}`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('URL HTTP(S) requise, sans identifiants, paramètres ni fragment.');
  }
  // http:// seulement vers le réseau local (Android autorise le HTTP non
  // chiffré pour tous les hôtes : le filtre est ici — localHttpGuard.ts).
  assertLocalHttpAllowed(trimmed);
  return parsed.toString().replace(/\/$/, '').replace(/\/v1$/, '');
}
