// ✒️ 123ECRITURE — lib/sync/relPath.ts — LA normalisation unique des chemins relatifs
//
// Tout chemin relatif d'un coffre — produit par un pont (Electron/Windows,
// SAF, web), écrit dans le cloud (vault_files.rel_path) ou relu — passe par
// normalizeRelPath : séparateurs POSIX `/`, jamais `\`. Sur Windows,
// path.relative/path.join produisent des `\` : une ligne `A\B.md` est un
// fichier PLAT « A\B.md » pour Android (aucun dossier A visible) et un
// doublon jamais apparié pour les autres appareils.
//
// Pas de normalisation Unicode (NFC/NFD) ici : renommer silencieusement un
// fichier sur disque créerait un doublon ; un écart NFC/NFD est signalé par
// le diagnostic, pas corrigé.
//
//////////////////////////////////////////////////////////////////////////////

export function normalizeRelPath(relPath: string): string {
  return relPath
    .replace(/\\/g, '/')
    .replace(/\/{2,}/g, '/')
    .replace(/^(?:\.\/)+/, '')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
}

export function isTrashRelPath(relPath: string): boolean {
  const p = normalizeRelPath(relPath);
  return p === '.trash' || p.startsWith('.trash/');
}

// Lignes distantes vues par le moteur : `.trash/` jamais synchronisé ;
// une ligne héritée à backslash est LUE sous son chemin normalisé quand
// aucune ligne POSIX ne porte ce chemin (sinon elle est masquée par sa
// jumelle). `rawRelPath` reste la clé exacte en base pour la viser.
export type RemoteRowLike = { relPath: string; rawRelPath?: string; deleted: boolean };

export function selectRemoteRows<T extends RemoteRowLike>(rows: T[]): { rows: T[]; shadowed: T[]; legacy: T[]; trash: number } {
  const posix = new Set<string>();
  for (const row of rows) {
    const raw = row.rawRelPath ?? row.relPath;
    if (!raw.includes('\\')) posix.add(normalizeRelPath(raw));
  }
  const out: T[] = [];
  const shadowed: T[] = [];
  const legacy: T[] = [];
  const seenLegacy = new Set<string>();
  let trash = 0;
  for (const row of rows) {
    const raw = row.rawRelPath ?? row.relPath;
    const relPath = normalizeRelPath(raw);
    if (isTrashRelPath(relPath)) {
      trash += 1;
      continue;
    }
    if (raw.includes('\\')) {
      if (posix.has(relPath) || seenLegacy.has(relPath)) {
        shadowed.push(row);
        continue;
      }
      seenLegacy.add(relPath);
      legacy.push(row);
    }
    out.push({ ...row, relPath });
  }
  return { rows: out, shadowed, legacy, trash };
}
