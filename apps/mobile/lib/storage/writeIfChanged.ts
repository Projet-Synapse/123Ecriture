// ✒️ 123ECRITURE — lib/storage/writeIfChanged.ts — n'écrit un fichier de configuration que s'il change
//
// Réécrire un fichier de configuration synchronisé (.123ecriture/*.json) au
// contenu IDENTIQUE change son mtime : la synchro le voit « modifié » et un
// fichier pourtant inchangé peut entrer en conflit avec la version d'un
// autre appareil. Toute écriture de configuration passe donc par ce garde :
// lecture, comparaison (texte exact), écriture seulement si différent.

export type NoteReader = (relPath: string) => Promise<string>;
export type NoteWriter = (relPath: string, content: string) => Promise<unknown>;

// Retourne true si le fichier a été écrit, false s'il était déjà identique.
export async function writeNoteIfChanged(
  read: NoteReader,
  write: NoteWriter,
  relPath: string,
  content: string,
): Promise<boolean> {
  let current: string | null = null;
  try {
    current = await read(relPath);
  } catch {
    current = null; // absent ou illisible : on écrit
  }
  if (current === content) return false;
  await write(relPath, content);
  return true;
}
