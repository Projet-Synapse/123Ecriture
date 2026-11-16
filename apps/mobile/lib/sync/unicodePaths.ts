// ✒️ 123ECRITURE — lib/sync/unicodePaths.ts — un même fichier, deux graphies Unicode
//////////////////////////////////////////////////////////////////////////////
//
// « è », « é », « É »… s'écrivent de DEUX façons en Unicode : composée
// (NFC, un seul caractère) ou décomposée (NFD, lettre + accent combinant).
// À l'écran c'est le même nom ; pour une comparaison de chaînes, deux
// chemins différents. Or les appareils ne produisent pas la même forme :
// le coffre cloud Android normalise en NFC (normalizeCloudRelPath), le
// desktop garde le nom du disque tel quel (NFD s'il vient d'un Mac/iPhone,
// d'une archive, d'un autre outil de synchro…).
//
// Conséquence (bug 2026-11-16, « scène the eleven ») : le moteur à trois
// états voyait le fichier local sous une graphie et la ligne cloud + la
// base sous l'autre → « absent ici mais connu de la base » = SUPPRESSION
// (garde-fou « fichiers manquants localement », en boucle), plus un
// doublon « nouveau ici » poussé à côté, et des modifications qui partent
// vers une ligne pendant que l'autre appareil lit l'autre.
//
// Règle : les chemins sont COMPARÉS par leur forme NFC, mais jamais
// renommés sur disque (un renommage silencieux créerait d'autres
// surprises). Pour chaque clé NFC, une graphie CANONIQUE est choisie —
// celle du cloud quand elle existe — et les entrées locales / de base
// d'une autre graphie sont relues sous ce nom ; les ponts de fichiers
// retrouvent le fichier réel quelle que soit la graphie demandée
// (desktop : resolveInVault ; Android : NFC). Les lignes cloud en
// double (même fichier sous deux graphies) : une seule est gardée dans le
// plan, les autres sont ignorées et signalées — jamais supprimées
// automatiquement.
//
// Module PUR (tests : unicodePaths.test.ts).
//
//////////////////////////////////////////////////////////////////////////////

export function unicodeKey(relPath: string): string {
  return relPath.normalize('NFC');
}

export type UnicodeRemoteRow = { relPath: string; deleted: boolean; updatedAt?: string };

export type UnicodeAlignment<R extends UnicodeRemoteRow> = {
  // Graphie locale → graphie canonique (seulement quand elles diffèrent).
  localRename: Map<string, string>;
  // Clé de base → graphie canonique (seulement quand elles diffèrent).
  baseRename: Map<string, string>;
  // Lignes cloud d'une graphie NON canonique : hors du plan.
  shadowed: R[];
  // Plusieurs fichiers LOCAUX distincts pour une même clé (vrais doublons
  // sur le disque) : laissés tels quels, signalés.
  localDuplicates: string[][];
};

function newer(a: string | undefined, b: string | undefined): boolean {
  return (a ?? '') > (b ?? '');
}

export function alignUnicodePaths<R extends UnicodeRemoteRow>(args: {
  localPaths: readonly string[];
  remote: readonly R[];
  basePaths: readonly string[];
}): UnicodeAlignment<R> {
  const groups = new Map<string, { local: Set<string>; remote: Map<string, R[]>; base: Set<string> }>();
  const group = (relPath: string) => {
    const key = unicodeKey(relPath);
    let g = groups.get(key);
    if (!g) {
      g = { local: new Set(), remote: new Map(), base: new Set() };
      groups.set(key, g);
    }
    return g;
  };
  for (const p of args.localPaths) group(p).local.add(p);
  for (const p of args.basePaths) group(p).base.add(p);
  for (const row of args.remote) {
    const g = group(row.relPath);
    const rows = g.remote.get(row.relPath) ?? [];
    rows.push(row);
    g.remote.set(row.relPath, rows);
  }

  const out: UnicodeAlignment<R> = { localRename: new Map(), baseRename: new Map(), shadowed: [], localDuplicates: [] };
  for (const g of groups.values()) {
    const forms = new Set<string>([...g.local, ...g.remote.keys(), ...g.base]);
    if (forms.size < 2) continue; // une seule graphie : rien à faire
    if (g.local.size > 1) {
      // Deux fichiers réels sur le disque : on ne choisit pas à leur place.
      out.localDuplicates.push([...g.local].sort());
      continue;
    }
    const localPath = [...g.local][0];
    const isActive = (form: string) => (g.remote.get(form) ?? []).some((r) => !r.deleted);
    const lastUpdate = (form: string) =>
      (g.remote.get(form) ?? []).reduce<string | undefined>((m, r) => (newer(r.updatedAt, m) ? r.updatedAt : m), undefined);

    // Graphie canonique — MÊME règle sur tous les appareils (le coffre cloud
    // Android garde aussi la ligne vivante la plus récente) : 1) la ligne
    // cloud vivante la plus récente (là où l'autre appareil vient d'écrire :
    // sa modification n'est jamais ignorée) ; 2) toute ligne cloud (la plus
    // récente) ; 3) la base ; 4) le local.
    const remoteForms = [...g.remote.keys()];
    const active = remoteForms.filter(isActive);
    const pool = active.length > 0 ? active : remoteForms;
    let canonical = pool.reduce<string | undefined>(
      (best, form) => (!best || newer(lastUpdate(form), lastUpdate(best)) ? form : best),
      undefined,
    );
    canonical ??= [...g.base].sort()[0] ?? localPath;
    if (!canonical) continue;

    if (localPath && localPath !== canonical) out.localRename.set(localPath, canonical);
    for (const b of g.base) if (b !== canonical) out.baseRename.set(b, canonical);
    for (const [form, rows] of g.remote) if (form !== canonical) out.shadowed.push(...rows);
  }
  return out;
}

// Applique baseRename à un état de base { chemin: hash } : la graphie
// canonique garde sa propre entrée si elle en a une, sinon reprend celle
// de la variante.
export function renameBaseKeys<V>(base: Record<string, V>, baseRename: ReadonlyMap<string, string>): Record<string, V> {
  if (baseRename.size === 0) return base;
  const next: Record<string, V> = {};
  for (const [relPath, value] of Object.entries(base)) {
    if (!baseRename.has(relPath)) next[relPath] = value;
  }
  for (const [from, to] of baseRename) {
    if (!(to in next) && from in base) next[to] = base[from];
  }
  return next;
}

/**
 * Retrouve sur le DISQUE un chemin demandé sous une autre graphie Unicode
 * (« scène » NFC demandé, « scène » NFD présent). Segment par segment, et
 * seulement quand le nom exact est absent : un nom qui existe tel quel
 * gagne toujours. Retourne les segments réels, ou null si rien ne change
 * (chemin introuvable sous toute graphie, ou déjà exact).
 *   exists(segs) : le chemin formé par ces segments existe-t-il ?
 *   list(segs)   : noms du dossier formé par ces segments (null = illisible).
 * Les segments manquants (fichier à créer) sont gardés tels quels derrière
 * le dernier dossier retrouvé : on n'écrit pas un doublon à côté.
 */
export function resolveUnicodeSegments(
  segments: string[],
  exists: (segs: string[]) => boolean,
  list: (segs: string[]) => string[] | null,
): string[] | null {
  const out: string[] = [];
  let changed = false;
  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i];
    if (exists([...out, segment])) {
      out.push(segment);
      continue;
    }
    const wanted = unicodeKey(segment);
    const match = (list(out) ?? []).find((name) => name !== segment && unicodeKey(name) === wanted);
    if (!match) return changed ? [...out, ...segments.slice(i)] : null;
    out.push(match);
    changed = true;
  }
  return changed ? out : null;
}
