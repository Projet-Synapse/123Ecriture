// ✒️ 123ECRITURE — lib/notes/wikilinkResolution.ts — résolution des liens internes [[...]]
//////////////////////////////////////////////////////////////////////////////
//
// Résolution d'un lien interne `[[cible]]` vers une note du coffre :
// fonctions PURES partagées par la navigation au clic (handleOpenWikilink,
// NotesScreen.tsx) ET par le style « lien non résolu » (atténué, façon
// Obsidian) des trois rendus — aperçu vivant CodeMirror (desktop/web et
// WebView Android, lib/editor/mdxLivePreview.ts) et Aperçu
// (NoteRenderer.tsx). Une seule logique : un lien affiché atténué est
// exactement un lien dont le clic créerait la note.
//
// Invariants du fichier :
//   • Alias (`[[cible|texte]]`) et ancres (`[[cible#Titre]]`,
//     `[[cible#^bloc]]`) sont ignorés pour la résolution ; `[[#Titre]]`
//     (ancre seule) vise la note courante → toujours résolu.
//   • Casse ignorée partout, séparateurs `\` normalisés en `/`.
//   • Une extension écrite dans le lien (`[[Note.md]]`) est tolérée : la
//     cible correspond au nom AVEC ou SANS extension, et `.md`/`.mdx` sont
//     interchangeables (`[[Note.md]]` trouve `Note.mdx`).
//   • Nom seul → recherche par nom dans tout le coffre (même règle que le
//     clic historique) ; à homonymes, la note du dossier courant gagne,
//     sinon la première de l'arbre.
//   • Chemin (`dossier/Nom`, `./Nom`, `../Nom`) → chemin depuis la racine,
//     puis relatif au dossier de la note courante, puis suffixe de chemin
//     (`dossier/Nom` trouve `Projets/dossier/Nom.mdx`, comme Obsidian).
//   • createWikilinkResolver indexe la liste UNE fois (Map) : la
//     résolution par lien est O(1) hors suffixe — appelée à chaque
//     reconstruction des décorations, donc à chaque frappe.
//
// SOMMAIRE :
//   1. Analyse de la cible — parseWikilinkTarget
//   2. Index et résolution — createWikilinkResolver, resolveWikilink
//
//////////////////////////////////////////////////////////////////////////////

export type LinkableNote = { relPath: string; name: string };

//////// 1. Analyse de la cible — parseWikilinkTarget ///////////////////////

const NOTE_EXTENSIONS = ['.mdx', '.md'];

// Retire alias et ancre, normalise les séparateurs. `path` vide = ancre
// seule (lien vers la note courante).
export function parseWikilinkTarget(raw: string): { path: string; anchor: string | null } {
  const withoutAlias = raw.split('|')[0] ?? '';
  const hashIndex = withoutAlias.indexOf('#');
  const pathPart = hashIndex === -1 ? withoutAlias : withoutAlias.slice(0, hashIndex);
  const anchor = hashIndex === -1 ? null : withoutAlias.slice(hashIndex + 1).trim() || null;
  const path = pathPart
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/{2,}/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
  return { path, anchor };
}

//////// 2. Index et résolution — createWikilinkResolver, resolveWikilink ////

function parentOf(relPath: string): string {
  const slash = relPath.lastIndexOf('/');
  return slash === -1 ? '' : relPath.slice(0, slash);
}

function stripExtension(path: string): string {
  const slash = path.lastIndexOf('/');
  const dot = path.lastIndexOf('.');
  return dot > slash + 1 ? path.slice(0, dot) : path;
}

function stripNoteExtension(path: string): string {
  const lower = path.toLowerCase();
  const ext = NOTE_EXTENSIONS.find((known) => lower.endsWith(known));
  return ext ? path.slice(0, path.length - ext.length) : path;
}

// Résout `.`/`..` d'un chemin joint ; null s'il sort du coffre.
function normalizeSegments(path: string): string | null {
  const out: string[] = [];
  for (const segment of path.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (out.length === 0) return null;
      out.pop();
      continue;
    }
    out.push(segment);
  }
  return out.join('/');
}

export type WikilinkResolver<T extends LinkableNote = LinkableNote> = {
  // Note visée, `'self'` pour une ancre seule, null si introuvable.
  resolve: (rawTarget: string) => T | 'self' | null;
  isResolved: (rawTarget: string) => boolean;
};

export function createWikilinkResolver<T extends LinkableNote>(
  notes: T[],
  currentRelPath?: string | null,
): WikilinkResolver<T> {
  const byPath = new Map<string, T>();
  const byName = new Map<string, T[]>();
  const addPath = (key: string, note: T) => {
    if (!byPath.has(key)) byPath.set(key, note);
  };
  const addName = (key: string, note: T) => {
    const list = byName.get(key);
    if (list) {
      if (!list.includes(note)) list.push(note);
    } else byName.set(key, [note]);
  };
  for (const note of notes) {
    const rel = note.relPath.replace(/\\/g, '/').toLowerCase();
    addPath(rel, note);
    addPath(stripExtension(rel), note);
    const fileName = rel.slice(rel.lastIndexOf('/') + 1);
    addName(note.name.toLowerCase(), note);
    addName(fileName, note);
    addName(stripExtension(fileName), note);
  }
  const currentFolder = currentRelPath ? parentOf(currentRelPath.replace(/\\/g, '/')).toLowerCase() : '';

  const lookupPath = (path: string): T | null =>
    byPath.get(path) ?? byPath.get(stripNoteExtension(path)) ?? null;

  const resolve = (rawTarget: string): T | 'self' | null => {
    const { path } = parseWikilinkTarget(rawTarget);
    if (!path) return currentRelPath ? 'self' : null;
    const lower = path.toLowerCase();
    const explicitRelative = lower.startsWith('./') || lower.startsWith('../');

    if (!lower.includes('/')) {
      const candidates = byName.get(lower) ?? byName.get(stripNoteExtension(lower)) ?? [];
      if (candidates.length === 0) return null;
      return (
        candidates.find((note) => parentOf(note.relPath.toLowerCase()) === currentFolder) ?? candidates[0]
      );
    }

    if (!explicitRelative) {
      const fromRoot = normalizeSegments(lower);
      const found = fromRoot !== null ? lookupPath(fromRoot) : null;
      if (found) return found;
    }
    const relative = normalizeSegments(currentFolder ? `${currentFolder}/${lower}` : lower);
    if (relative !== null) {
      const found = lookupPath(relative);
      if (found) return found;
    }
    if (explicitRelative) return null;
    // Suffixe de chemin (`dossier/Nom` → `…/dossier/Nom.mdx`).
    const suffix = `/${stripNoteExtension(normalizeSegments(lower) ?? lower)}`;
    for (const note of notes) {
      const rel = note.relPath.replace(/\\/g, '/').toLowerCase();
      if (stripExtension(rel).endsWith(suffix) || stripNoteExtension(rel).endsWith(suffix)) return note;
    }
    return null;
  };

  return { resolve, isResolved: (rawTarget) => resolve(rawTarget) !== null };
}

// Raccourci ponctuel (clic) — pour une résolution répétée, garder le
// résolveur de createWikilinkResolver.
export function resolveWikilink<T extends LinkableNote>(
  rawTarget: string,
  notes: T[],
  currentRelPath?: string | null,
): T | 'self' | null {
  return createWikilinkResolver(notes, currentRelPath).resolve(rawTarget);
}
