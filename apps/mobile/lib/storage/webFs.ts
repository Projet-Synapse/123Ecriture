// //1. 📁 PRIMITIVES FICHIERS WEB — couche commune à tous les ponts web
// ////////////////////////////////////////////////////////////////////////
//
// Équivalent navigateur des utilitaires fs/path utilisés par les modules
// Electron (apps/desktop/electron/vault.ts et suivants) : les ponts web
// (installWebBridges.ts) travaillent sur des handles File System Access API
// au lieu de chemins disque.
//
// Types volontairement « structural » (DirectoryHandleLike/FileHandleLike)
// plutôt que les types DOM : les ponts restent testables sous Vitest/Node
// avec un faux système de fichiers en mémoire (voir webVaultAdapter.test.ts),
// et les vrais objets File System Access API satisfont ces interfaces tels
// quels — même convention que les adaptateurs natifs à côté.

export interface FsaFileHandleLike {
  kind: 'file';
  name: string;
  getFile(): Promise<File>;
  createWritable(options?: { keepExistingData?: boolean }): Promise<{
    write(data: string | BufferSource | Blob): Promise<void>;
    close(): Promise<void>;
  }>;
}

export interface FsaDirectoryHandleLike {
  kind: 'directory';
  name: string;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FsaFileHandleLike>;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FsaDirectoryHandleLike>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
  // Itération des enfants — FileSystemDirectoryHandle est un async itérateur
  // (entries/values), ici représenté par une méthode listable pour rester
  // simple à mocker ET à consommer.
  values(): AsyncIterableIterator<FsaFileHandleLike | FsaDirectoryHandleLike>;
  queryPermission?(options?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>;
  requestPermission?(options?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>;
}

// Garde-fou équivalent à resolveInVault (vault.ts) : un relPath IPC est
// découpé en segments et chaque segment est validé — jamais de traversée
// ("../.."), jamais de chemin absolu, jamais de segment vide.
export function splitRelPath(relPath: string): string[] {
  if (relPath === '' ) return [];
  const segments = relPath.split('/');
  for (const segment of segments) {
    if (segment === '' || segment === '.' || segment === '..') {
      throw new Error(`Chemin hors du vault refusé : ${relPath}`);
    }
  }
  return segments;
}

// Résout un chemin relatif en handle de DOSSIER (créé au besoin avec
// `create`) — l'équivalent de path.dirname + mkdir -p. `relPath === ''`
// renvoie la racine.
export async function getDirByRelPath(
  root: FsaDirectoryHandleLike,
  relPath: string,
  create = false,
): Promise<FsaDirectoryHandleLike> {
  let dir = root;
  for (const segment of splitRelPath(relPath)) {
    dir = await dir.getDirectoryHandle(segment, { create });
  }
  return dir;
}

// Résout un chemin relatif en handle de FICHIER. `name` final peut porter
// l'extension (ex. "Ma note.mdx") — c'est un nom de fichier réel, pas un
// nom d'entrée sans extension.
export async function getFileByRelPath(
  root: FsaDirectoryHandleLike,
  relPath: string,
  create = false,
): Promise<FsaFileHandleLike> {
  const segments = splitRelPath(relPath);
  const fileName = segments.pop();
  if (!fileName) throw new Error('Chemin de fichier vide.');
  const parent = await getDirByRelPath(root, segments.join('/'), create);
  return parent.getFileHandle(fileName, { create });
}

export async function readFileText(root: FsaDirectoryHandleLike, relPath: string): Promise<string> {
  const file = await (await getFileByRelPath(root, relPath)).getFile();
  return file.text();
}

export async function writeFileText(
  root: FsaDirectoryHandleLike,
  relPath: string,
  content: string,
): Promise<void> {
  const handle = await getFileByRelPath(root, relPath, true);
  const writable = await handle.createWritable();
  await writable.write(content);
  await writable.close();
}

// Existe-t-il quelque chose (fichier OU dossier) à ce chemin ? Équivalent du
// fsSync.existsSync des modules Electron — les collisions de noms y sont
// testées avant toute écriture (findAvailableName, rename, set-path...).
export async function entryExists(root: FsaDirectoryHandleLike, relPath: string): Promise<boolean> {
  const segments = splitRelPath(relPath);
  const name = segments.pop();
  if (!name) return true;
  try {
    const parent = await getDirByRelPath(root, segments.join('/'));
    await parent.getFileHandle(name);
    return true;
  } catch {
    try {
      const parent = await getDirByRelPath(root, segments.join('/'));
      await parent.getDirectoryHandle(name);
      return true;
    } catch {
      return false;
    }
  }
}

// Trouve un nom disponible dans `dir` en suffixant " 2", " 3"... — port
// direct de findAvailableName (vault.ts), mêmes règles pour notes/dossiers.
export async function findAvailableName(
  dir: FsaDirectoryHandleLike,
  candidate: string,
  extension = '',
): Promise<string> {
  let name = candidate;
  let counter = 2;
  while (await entryExists(dir, `${name}${extension}`)) {
    name = `${candidate} ${counter}`;
    counter += 1;
  }
  return `${name}${extension}`;
}

// Suppression récursive d'un fichier OU dossier — équivalent de
// fs.rm(..., {recursive: true, force: true}). removeEntry natif supporte
// déjà {recursive: true} ; la boucle manuelle ne sert qu'aux faux handles
// de test qui n'implémentent pas ce drapeau.
export async function removeEntryRecursive(dir: FsaDirectoryHandleLike, name: string): Promise<void> {
  try {
    await dir.removeEntry(name, { recursive: true });
    return;
  } catch (error) {
    // Chromium lève si recursive n'est pas supporté pour ce type — retry
    // sans le drapeau (fichier simple), sinon on remonte.
    try {
      await dir.removeEntry(name);
      return;
    } catch {
      throw error;
    }
  }
}

// Retire, en remontant depuis `parentRelPath` vers la racine, chaque dossier
// devenu VIDE — pendant web de pruneEmptyAncestors (vault.ts), utilisé après
// une suppression de synchro pour que le dossier conteneur disparaisse avec
// ses fichiers. S'arrête au premier dossier non vide ; ne touche jamais la
// racine ni un dossier caché (.123ecriture…) ; best-effort (une erreur
// arrête la remontée sans la propager).
export async function pruneEmptyAncestors(
  root: FsaDirectoryHandleLike,
  parentRelPath: string,
): Promise<void> {
  let segments = splitRelPath(parentRelPath);
  while (segments.length > 0) {
    const name = segments[segments.length - 1];
    if (name.startsWith('.')) return;
    const parent = await getDirByRelPath(root, segments.slice(0, -1).join('/'));
    const dir = await getDirByRelPath(root, segments.join('/'));
    let first;
    try {
      first = await dir.values().next();
    } catch {
      return;
    }
    if (!first.done) return;
    try {
      await parent.removeEntry(name);
    } catch {
      return;
    }
    segments = segments.slice(0, -1);
  }
}

// //2. 🔀 TRI ET PARCOURS D'ARBRE
// ////////////////////////////////////////////////////////////////////////

// Copie conforme de la règle de tri de walkTree (vault.ts) : dossiers
// d'abord, puis notes (récentes/anciennes d'abord selon le mode, qui ne
// s'applique qu'aux notes), alphabétique 'fr' à chaque niveau. Factorisée
// ici parce que webVaultAdapter (arborescence) et webSearchAdapter
// (parcours plat) trient tous les deux des listes d'entrées.
export function sortNodes<T extends { type: 'folder' | 'note'; name: string; modifiedAt?: number }>(
  nodes: T[],
  sortMode: 'alphabetical' | 'recent' | 'oldest' | 'manual',
): T[] {
  const sorted = [...nodes].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
    if (sortMode === 'recent' && a.type === 'note' && b.type === 'note') {
      return (b.modifiedAt ?? 0) - (a.modifiedAt ?? 0);
    }
    if (sortMode === 'oldest' && a.type === 'note' && b.type === 'note') {
      return (a.modifiedAt ?? 0) - (b.modifiedAt ?? 0);
    }
    return a.name.localeCompare(b.name, 'fr');
  });
  return sorted;
}

// Rang des enfants d'un dossier selon l'ordre manuel enregistré
// (.123ecriture/order.json) — tri stable, les absents restent à la suite
// (port direct de la fin de walkTree).
export function applyManualOrder<T extends { name: string }>(nodes: T[], savedOrder?: string[]): T[] {
  if (!savedOrder || savedOrder.length === 0) return nodes;
  const rank = new Map(savedOrder.map((name, index) => [name, index]));
  return [...nodes].sort(
    (a, b) => (rank.get(a.name) ?? Infinity) - (rank.get(b.name) ?? Infinity),
  );
}

// Copie récursive d'un dossier vers un autre parent (utilisé par move/setPath
// : la File System Access API n'a PAS de rename natif — copier puis
// supprimer est le seul équivalent). Préserve les sous-arbres entiers ;
// lastModified n'est PAS préservable (File.lastModified est en lecture
// seule) — une note renommée/déplacée remontera au tri "Plus récent
// d'abord", écart documenté et assumé (voir la PR du pont web).
export async function copyDirectoryInto(
  source: FsaDirectoryHandleLike,
  destinationParent: FsaDirectoryHandleLike,
  destinationName: string,
): Promise<FsaDirectoryHandleLike> {
  const destination = await destinationParent.getDirectoryHandle(destinationName, { create: true });
  for await (const entry of source.values()) {
    if (entry.kind === 'file') {
      const file = await entry.getFile();
      const writable = await destination.getFileHandle(entry.name, { create: true }).then((h) => h.createWritable());
      await writable.write(file);
      await writable.close();
    } else {
      await copyDirectoryInto(entry, destination, entry.name);
    }
  }
  return destination;
}

// Liste les fichiers de notes (`.mdx`/`.md`) sous forme de relPaths — port
// de walkNoteFiles (properties.ts) et walkMdxFiles (occurrences.ts), unifiés
// ici : la règle de filtrage par extension est un paramètre.
export async function listNoteRelPaths(
  root: FsaDirectoryHandleLike,
  extensions: string[],
): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: FsaDirectoryHandleLike, prefix: string): Promise<void> {
    for await (const entry of dir.values()) {
      if (entry.name.startsWith('.')) continue;
      const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.kind === 'directory') {
        await walk(entry, relPath);
      } else if (extensions.some((ext) => entry.name.toLowerCase().endsWith(ext))) {
        out.push(relPath);
      }
    }
  }
  await walk(root, '');
  return out.sort((a, b) => a.localeCompare(b, 'fr'));
}
