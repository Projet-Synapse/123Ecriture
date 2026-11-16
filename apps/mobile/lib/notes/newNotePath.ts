// ✒️ 123ECRITURE — lib/notes/newNotePath.ts — où créer une nouvelle fiche
//////////////////////////////////////////////////////////////////////////////
//
// Calcul PUR de l'emplacement d'une nouvelle fiche, partagé par le bouton
// « + Nouvelle note » (handleCreateNote) et par le clic sur un [[lien]]
// vers une fiche inexistante (NotesScreen.tsx) — un seul endroit applique
// Paramètres → Gestion des fichiers et des liens → « Emplacement par
// défaut des nouvelles notes ».
//
// Invariants du fichier :
//   • resolveNewNoteParent : 'vaultRoot' → racine (undefined) ;
//     'sameFolder' → dossier de la note ouverte (racine sans note) ;
//     'custom' → dossier saisi, normalisé (racine s'il est vide).
//   • wikilinkCreationTarget : le NOM vient du lien sans alias (`|`),
//     sans ancre (`#`) et sans extension .md/.mdx ; un chemin EXPLICITE
//     dans le lien (`dossier/Nom`, depuis la racine ; `./Nom`, `../Nom`,
//     relatifs à la note courante) est gardé tel quel et l'emporte sur le
//     réglage ; un nom seul va dans le dossier du réglage. Un chemin qui
//     sortirait du coffre (`../../x` depuis la racine) ou une cible vide
//     (ancre seule) ne crée rien (null).
//
// SOMMAIRE :
//   1. resolveNewNoteParent — le réglage « emplacement des nouvelles notes »
//   2. wikilinkCreationTarget — dossier + nom d'une fiche créée depuis un lien
//
//////////////////////////////////////////////////////////////////////////////

export type NewNoteLocationSetting = 'vaultRoot' | 'sameFolder' | 'custom';

function normalizeFolder(path: string | null | undefined): string | undefined {
  const normalized = (path ?? '')
    .replace(/\\/g, '/')
    .split('/')
    .map((segment) => segment.trim())
    .filter((segment) => segment && segment !== '.')
    .join('/');
  return normalized || undefined;
}

function parentOf(relPath: string): string | undefined {
  const normalized = relPath.replace(/\\/g, '/');
  const slash = normalized.lastIndexOf('/');
  return slash === -1 ? undefined : normalized.slice(0, slash) || undefined;
}

//////// 1. resolveNewNoteParent — le réglage ////////////////////////////////

export function resolveNewNoteParent(
  location: NewNoteLocationSetting,
  customFolder: string | null | undefined,
  activeRelPath: string | null | undefined,
): string | undefined {
  if (location === 'sameFolder') return activeRelPath ? parentOf(activeRelPath) : undefined;
  if (location === 'custom') return normalizeFolder(customFolder);
  return undefined;
}

//////// 2. wikilinkCreationTarget — dossier + nom depuis un lien ////////////

// Résout `.`/`..` ; null si le chemin sort du coffre.
function resolveSegments(segments: string[]): string[] | null {
  const out: string[] = [];
  for (const segment of segments) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (out.length === 0) return null;
      out.pop();
      continue;
    }
    out.push(segment);
  }
  return out;
}

export function wikilinkCreationTarget(
  rawTarget: string,
  defaultParent: string | undefined,
  activeRelPath?: string | null,
): { parentRelPath: string | undefined; name: string } | null {
  const withoutAlias = rawTarget.split('|')[0] ?? '';
  const withoutAnchor = withoutAlias.split('#')[0] ?? '';
  const path = withoutAnchor.trim().replace(/\\/g, '/');
  const rawSegments = path.split('/').map((segment) => segment.trim());
  const isRelative = rawSegments[0] === '.' || rawSegments[0] === '..';
  const base = isRelative && activeRelPath ? (parentOf(activeRelPath) ?? '').split('/').filter(Boolean) : [];
  const segments = resolveSegments([...base, ...rawSegments]);
  if (!segments || segments.length === 0) return null;

  const fileName = segments[segments.length - 1].replace(/\.(mdx|md)$/i, '').trim();
  if (!fileName) return null;
  const explicitFolder = segments.slice(0, -1);
  // Tout `/` dans le lien (y compris `/Nom` = racine explicite) est un
  // chemin choisi par l'autrice : il l'emporte sur le réglage.
  const hasExplicitPath = path.includes('/') || isRelative;
  return {
    parentRelPath: hasExplicitPath ? explicitFolder.join('/') || undefined : defaultParent,
    name: fileName,
  };
}
