import { sha256HexOfText } from './nativeSha256';
// ✒️ 123ECRITURE — lib/sync/configMerge.ts — fusion STRUCTURÉE des fichiers de configuration
//////////////////////////////////////////////////////////////////////////////
//
// Les métadonnées synchronisées en JSON (.123ecriture/tasks.json,
// tasklists.json, preferences.json) ne passent JAMAIS par diff-match-patch :
// une fusion par caractères avec une base vide ou ancienne produit une
// UNION (tâches supprimées qui reviennent, préférences d'un appareil qui
// écrasent celles de l'autre). Ici, fusion à trois voix sur la STRUCTURE :
//   - tableaux d'objets à `id` : par identifiant (absent d'un côté mais
//     présent dans la base = suppression) ;
//   - objets : clé par clé contre la base — un côté INCHANGÉ ne l'emporte
//     jamais sur un côté modifié ;
//   - deux côtés modifiés différemment (valeur simple) : LA PLUS RÉCENTE
//     GAGNE (décision de l'utilisatrice, 25/10/2026) — `newer` fourni par
//     l'appelant (newerSide : mtime local vs updated_at cloud) ;
// Pas de base FIABLE (absente, ou hash ≠ sync-state) : `side-wins` — le
// côté le plus récent gagne en entier, l'autre est sauvegardé par
// l'appelant en `.123ecriture/<nom>.conflict-<horodatage>.json` (local,
// jamais synchronisé). Un côté illisible : `remote-wins` (inchangé).
//
//////////////////////////////////////////////////////////////////////////////

export const STRUCTURED_CONFIG_FILES = [
  '.123ecriture/tasks.json',
  '.123ecriture/tasklists.json',
  '.123ecriture/preferences.json',
];

export function isStructuredConfigFile(relPath: string): boolean {
  return STRUCTURED_CONFIG_FILES.includes(relPath);
}

// Chemin LOCAL de la version perdante (segment `.123ecriture` → jamais
// haché ni poussé par isHashableRelPath, hors liste SYNCED_META_FILES).
// `origin` 'cloud' : copie de la version du CLOUD perdante (nom distinct,
// sinon deux sauvegardes du même cycle s'écraseraient).
export function configConflictBackupPath(relPath: string, now: Date = new Date(), origin: 'local' | 'cloud' = 'local'): string {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const slash = relPath.lastIndexOf('/');
  const dir = relPath.slice(0, slash + 1);
  const name = relPath.slice(slash + 1).replace(/\.json$/i, '');
  return `${dir}${name}.conflict-${origin === 'cloud' ? 'cloud-' : ''}${stamp}.json`;
}

export type ConfigMergeResult =
  | { kind: 'merged'; text: string; value: unknown }
  | { kind: 'side-wins'; side: Side; reason: 'no-base' }
  | { kind: 'remote-wins'; reason: 'unparseable' };

export type Side = 'local' | 'remote';

// TOLÉRANCE D'HORLOGE : deux appareils n'ont jamais exactement la même
// heure, et `updated_at` est l'heure du SERVEUR à l'envoi (quelques
// secondes après la modif). En dessous de 2 minutes d'écart, on ne sait
// pas honnêtement qui est le plus récent : le cloud (référence partagée,
// déjà vue par les autres appareils) l'emporte, le perdant est sauvegardé.
// Au-delà, le plus récent gagne. Une horloge d'appareil décalée de plus de
// 2 min peut fausser le choix — rien n'est perdu (.conflict local).
export const CLOCK_TOLERANCE_MS = 2 * 60 * 1000;

export function newerSide(localMtimeMs: number | null | undefined, remoteUpdatedAt: string | number | null | undefined, toleranceMs = CLOCK_TOLERANCE_MS): Side {
  const l = typeof localMtimeMs === 'number' && Number.isFinite(localMtimeMs) ? localMtimeMs : NaN;
  const r = typeof remoteUpdatedAt === 'number' ? remoteUpdatedAt : remoteUpdatedAt ? new Date(remoteUpdatedAt).getTime() : NaN;
  if (Number.isNaN(l)) return 'remote';
  if (Number.isNaN(r)) return 'local';
  return l > r + toleranceMs ? 'local' : 'remote';
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

function parse(text: string | null): { ok: true; value: Json } | { ok: false } {
  if (text === null) return { ok: false };
  try {
    return { ok: true, value: JSON.parse(text) as Json };
  } catch {
    return { ok: false };
  }
}

function isPlainObject(v: unknown): v is Record<string, Json> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => deepEqual(x, b[i]));
  }
  if (isPlainObject(a)) {
    if (!isPlainObject(b)) return false;
    const ka = Object.keys(a).filter((k) => a[k] !== undefined);
    const kb = Object.keys(b).filter((k) => b[k] !== undefined);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => deepEqual(a[k], b[k]));
  }
  return false;
}

function idOf(v: unknown): string | null {
  if (!isPlainObject(v)) return null;
  const id = v.id;
  return typeof id === 'string' || typeof id === 'number' ? String(id) : null;
}

// Tableau « à identifiants » : tous les éléments sont des objets à `id`
// unique. Un tableau vide compte (il peut l'être d'un seul côté).
function isIdArray(v: unknown): v is Json[] {
  if (!Array.isArray(v)) return false;
  const seen = new Set<string>();
  for (const x of v) {
    const id = idOf(x);
    if (id === null || seen.has(id)) return false;
    seen.add(id);
  }
  return true;
}

function mergeIdArrays(base: Json[] | undefined, local: Json[], remote: Json[], newer: Side): Json[] {
  const baseById = new Map((base ?? []).map((x) => [idOf(x)!, x]));
  const localById = new Map(local.map((x) => [idOf(x)!, x]));
  const remoteById = new Map(remote.map((x) => [idOf(x)!, x]));

  const resolve = (id: string): Json | undefined => {
    const b = baseById.get(id);
    const l = localById.get(id);
    const r = remoteById.get(id);
    if (l === undefined && r === undefined) return undefined;
    if (l === undefined) {
      // Supprimé localement : la suppression gagne si le cloud n'a pas
      // touché l'élément ; modifié côté cloud → on le garde (rien perdu).
      if (b !== undefined && deepEqual(r, b)) return undefined;
      return r;
    }
    if (r === undefined) {
      if (b !== undefined && deepEqual(l, b)) return undefined;
      return l;
    }
    return mergeValue(b, l, r, newer);
  };

  // Ordre : celui du cloud (référence partagée), les éléments propres au
  // local insérés après leur prédécesseur local (ou en tête).
  const order: string[] = remote.map((x) => idOf(x)!);
  local.forEach((x, i) => {
    const id = idOf(x)!;
    if (order.includes(id)) return;
    let at = 0;
    for (let j = i - 1; j >= 0; j -= 1) {
      const k = order.indexOf(idOf(local[j])!);
      if (k >= 0) { at = k + 1; break; }
    }
    order.splice(at, 0, id);
  });
  const out: Json[] = [];
  for (const id of order) {
    const v = resolve(id);
    if (v !== undefined) out.push(v);
  }
  return out;
}

// Fusion à trois voix d'une valeur. `undefined` = clé absente.
export function mergeValue(base: Json | undefined, local: Json | undefined, remote: Json | undefined, newer: Side = 'remote'): Json | undefined {
  if (deepEqual(local, remote)) return local;
  if (deepEqual(local, base)) return remote; // seul le cloud a changé
  if (deepEqual(remote, base)) return local; // seul le local a changé
  // Les deux ont changé différemment.
  if (isIdArray(local) && isIdArray(remote) && (base === undefined || isIdArray(base))) {
    return mergeIdArrays(base as Json[] | undefined, local, remote, newer);
  }
  if (isPlainObject(local) && isPlainObject(remote)) {
    const b = isPlainObject(base) ? base : {};
    const out: Record<string, Json> = {};
    const keys = [...Object.keys(remote), ...Object.keys(local).filter((k) => !(k in remote))];
    for (const key of keys) {
      const v = mergeValue(b[key], local[key], remote[key], newer);
      if (v !== undefined) out[key] = v;
    }
    return out;
  }
  // Conflit réel sur une valeur simple : la plus récente gagne.
  return newer === 'local' ? local : remote;
}

// Fusion d'un fichier de configuration. Le texte produit reprend
// l'indentation à 2 espaces des écrivains de l'app (desktop + natif).
// `baseText` : la base VÉRIFIÉE (hash = sync-state) ou null. `newer` : le
// côté le plus récent (newerSide) — défaut 'remote' pour les appelants
// qui n'ont pas de dates.
export function mergeConfigJson(baseText: string | null, localText: string, remoteText: string, newer: Side = 'remote'): ConfigMergeResult {
  const l = parse(localText);
  const r = parse(remoteText);
  if (!l.ok || !r.ok) return { kind: 'remote-wins', reason: 'unparseable' };
  const b = parse(baseText);
  // Base absente ou illisible = pas de référence : le plus récent gagne.
  if (!b.ok) return { kind: 'side-wins', side: newer, reason: 'no-base' };
  const value = mergeValue(b.value, l.value, r.value, newer) ?? null;
  // Texte identique à un côté ? On le réutilise tel quel (pas de
  // réécriture cosmétique qui changerait le hash pour rien).
  if (deepEqual(value, r.value)) return { kind: 'merged', text: remoteText, value };
  if (deepEqual(value, l.value)) return { kind: 'merged', text: localText, value };
  return { kind: 'merged', text: JSON.stringify(value, null, 2), value };
}

//////// Base vérifiée ///////////

// La base de fusion (.123ecriture/bases/) n'est fiable QUE si son hash est
// celui que le sync-state attend pour ce chemin (dernière version réellement
// synchronisée). Sinon (base périmée, autre coffre, sync-state remis à zéro)
// → « pas de référence » : jamais de fusion contre une base fausse.
export function verifiedBase(text: string | null, expectedHash: string | null | undefined): string | null {
  if (text === null || !expectedHash) return null;
  return sha256HexOfText(text) === expectedHash ? text : null;
}

//////// Plan de résolution (pur, testé) ///////////

// Ce que le moteur doit FAIRE d'un conflit de configuration :
//   - `final`   : texte final du fichier local (et du cloud après envoi) ;
//   - `push`    : le résultat diffère du cloud → il DOIT être envoyé
//                 (sinon les autres appareils ne le reçoivent jamais) ;
//   - `pull`    : le cloud gagne en entier → réception simple ;
//   - `backupLocal` / `backupCloud` : versions perdantes à sauvegarder en
//     `.conflict-*.json` local (jamais synchronisé) — rien n'est perdu.
export type ConfigResolution = {
  final: string;
  push: boolean;
  pull: boolean;
  backupLocal: boolean;
  backupCloud: boolean;
  reason: 'merged' | 'no-base' | 'unparseable';
  newer: Side;
};

export function planConfigResolution(baseText: string | null, localText: string, remoteText: string, newer: Side): ConfigResolution {
  const result = mergeConfigJson(baseText, localText, remoteText, newer);
  if (result.kind !== 'merged') {
    const winner: Side = result.kind === 'side-wins' ? result.side : 'remote';
    const reason = result.kind === 'side-wins' ? 'no-base' : 'unparseable';
    if (localText === remoteText) return { final: remoteText, push: false, pull: false, backupLocal: false, backupCloud: false, reason, newer: winner };
    return winner === 'local'
      ? { final: localText, push: true, pull: false, backupLocal: false, backupCloud: true, reason, newer: winner }
      : { final: remoteText, push: false, pull: true, backupLocal: true, backupCloud: false, reason, newer: winner };
  }
  const final = result.text;
  return {
    final,
    push: final !== remoteText,
    pull: false,
    backupLocal: final !== localText,
    backupCloud: final !== remoteText,
    reason: 'merged',
    newer,
  };
}
