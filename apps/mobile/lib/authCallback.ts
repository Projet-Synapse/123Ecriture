// Décodage de l'URL de callback OAuth du protocole custom
// (app123ecriture://auth-callback?code=…&sb_flow_id=…) — voir
// lib/sync/AuthContext.tsx. Pur et testé : supabase-js >= 2.1xx exige LE
// CODE et un flowId distincts (voir AuthContext pour le pourquoi du bug
// « invalid flow state » quand on lui passait l'URL entière).
export type AuthCallbackParams = {
  code: string | null;
  flowId: string | null;
  error: string | null;
};

export function parseAuthCallbackUrl(url: string): AuthCallbackParams {
  // Schéma custom : new URL() s'y casse les dents selon les moteurs — on
  // découpe la query à la main, URLSearchParams marche sur n'importe quelle
  // chaîne « clé=valeur&… ».
  const queryIndex = url.indexOf('?');
  const query = queryIndex === -1 ? '' : url.slice(queryIndex + 1);
  const params = new URLSearchParams(query);
  return {
    code: params.get('code'),
    flowId: params.get('sb_flow_id'),
    error: params.get('error_description') || params.get('error'),
  };
}
