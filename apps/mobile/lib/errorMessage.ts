// Message d'erreur lisible pour n'importe quelle valeur rejetée.
//
// Pourquoi ce helper existe : les erreurs Supabase (PostgrestError,
// StorageError…) sont de simples objets { message, code, hint… }, PAS des
// instances d'Error. Les catch qui faisaient
// `err instanceof Error ? err.message : String(err)` affichaient donc
// « [object Object] » à la place du vrai message — vécu sous les coffres de
// Paramètres → « Lier ce coffre au cloud » : la cause réelle de l'échec
// restait invisible. On extrait .message (+ le code Postgres quand il
// existe), avec un repli JSON.stringify lisible pour tout le reste.
export function errorMessage(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const maybe = value as { message?: unknown; code?: unknown };
    if (typeof maybe.message === 'string' && maybe.message.length > 0) {
      const code = typeof maybe.code === 'string' && maybe.code ? ` (code ${maybe.code})` : '';
      return maybe.message + code;
    }
    try {
      return JSON.stringify(value) ?? String(value);
    } catch {
      // Objet circulaire ou non sérialisable — le repli brut reste le seul recours.
    }
  }
  return String(value);
}
