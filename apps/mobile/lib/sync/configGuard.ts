// ✒️ 123ECRITURE — lib/sync/configGuard.ts — garde des métadonnées JSON synchronisées
//////////////////////////////////////////////////////////////////////////////
//
// JSON.parse accepte une clé en DOUBLE (la dernière gagne) : un fichier de
// configuration abîmé par une fusion textuelle (incident du 24/10 : deux
// « dueDate » dans une tâche, texte mélangé) passait donc la garde et
// voyageait d'appareil en appareil. Ici, avant toute fusion, réception ou
// envoi d'une métadonnée synchronisée :
//   • texte JSON valide, SANS clé en double dans aucun objet ;
//   • forme attendue : tasks.json = tableau d'objets avec `id` et `listId`
//     (chaînes) ; tasklists.json = { lists: [objets avec `id`] } ;
//     preferences/appearance = objet.
// Échec → l'appelant REFUSE l'opération (rien d'écrit, rien d'envoyé) et
// journalise ; le fichier local n'est jamais écrasé.
//
//////////////////////////////////////////////////////////////////////////////

import { SYNCED_META_FILES } from './syncRules';

export type ConfigGuardResult = { ok: true; value: unknown } | { ok: false; reason: string };

export function isGuardedConfigFile(relPath: string): boolean {
  return SYNCED_META_FILES.includes(relPath);
}

// Recherche des clés en double : parcours lexical minimal (chaînes,
// échappements, imbrication). Suppose un texte déjà accepté par JSON.parse.
export function findDuplicateKey(text: string): string | null {
  const stack: { isObject: boolean; keys: Set<string>; expectKey: boolean }[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      const raw = text.slice(i, j + 1);
      const top = stack[stack.length - 1];
      if (top && top.isObject && top.expectKey) {
        const key = JSON.parse(raw) as string;
        if (top.keys.has(key)) return key;
        top.keys.add(key);
        top.expectKey = false;
      }
      i = j + 1;
      continue;
    }
    if (c === '{') stack.push({ isObject: true, keys: new Set(), expectKey: true });
    else if (c === '[') stack.push({ isObject: false, keys: new Set(), expectKey: false });
    else if (c === '}' || c === ']') stack.pop();
    else if (c === ',') {
      const top = stack[stack.length - 1];
      if (top?.isObject) top.expectKey = true;
    }
    i += 1;
  }
  return null;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export function validateConfigText(relPath: string, text: string): ConfigGuardResult {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'JSON illisible' };
  }
  const dup = findDuplicateKey(text);
  if (dup !== null) return { ok: false, reason: `clé « ${dup} » en double` };
  if (relPath === '.123ecriture/tasks.json') {
    if (!Array.isArray(value)) return { ok: false, reason: 'tasks.json doit être un tableau' };
    const bad = value.findIndex(
      (t) => !isPlainObject(t) || typeof t.id !== 'string' || !t.id || typeof t.listId !== 'string' || !t.listId,
    );
    if (bad >= 0) return { ok: false, reason: `tâche n°${bad + 1} sans id ou listId` };
  } else if (relPath === '.123ecriture/tasklists.json') {
    if (!isPlainObject(value) || !Array.isArray(value.lists)) return { ok: false, reason: 'tasklists.json sans tableau « lists »' };
    const bad = value.lists.findIndex((l) => !isPlainObject(l) || typeof l.id !== 'string' || !l.id);
    if (bad >= 0) return { ok: false, reason: `liste n°${bad + 1} sans id` };
  } else if (relPath === '.123ecriture/events.json') {
    if (!Array.isArray(value)) return { ok: false, reason: 'events.json doit être un tableau' };
    const bad = value.findIndex((e) => !isPlainObject(e) || typeof e.id !== 'string' || !e.id);
    if (bad >= 0) return { ok: false, reason: `évènement n°${bad + 1} sans id` };
  } else if (!isPlainObject(value)) {
    return { ok: false, reason: 'objet JSON attendu' };
  }
  return { ok: true, value };
}
