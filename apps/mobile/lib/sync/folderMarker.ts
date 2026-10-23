// ✒️ 123ECRITURE — lib/sync/folderMarker.ts — les dossiers, citoyens de première classe
//////////////////////////////////////////////////////////////////////////////
//
// Le cloud (vault_files + Storage) ne connaît que des LIGNES de fichiers.
// Pour qu'un dossier — même vide — voyage entre appareils SANS migration
// de schéma et sans casser les anciens clients, chaque dossier est
// représenté dans le cloud par un MARQUEUR : une ligne vault_files de
// rel_path `<dossier>/.123ecriture-dossier`, contenu vide (hash = SHA-256
// de la chaîne vide), poussée par la RPC push_file comme n'importe quel
// fichier.
//
// Pourquoi ce choix (le plus propre ET compatible) :
//   • aucune colonne `kind` à ajouter (zéro migration prod) ;
//   • les anciens clients ignorent les noms cachés (segment `.`) : le
//     marqueur leur est invisible, ils ne le recopient ni ne le suppriment ;
//   • suppression / restauration / verrou optimiste passent par les MÊMES
//     RPC (tombstone_file / restore_file / push_file) que les fichiers.
//   • Sur disque, le marqueur n'est JAMAIS écrit : un dossier local est un
//     vrai dossier ; le moteur fait la correspondance dossier ↔ marqueur.
//
//////////////////////////////////////////////////////////////////////////////

export const FOLDER_MARKER_NAME = '.123ecriture-dossier';

// SHA-256('') — le contenu d'un marqueur est toujours vide.
export const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

export function isFolderMarker(relPath: string): boolean {
  return relPath === FOLDER_MARKER_NAME || relPath.endsWith(`/${FOLDER_MARKER_NAME}`);
}

export function folderToMarker(folderRelPath: string): string {
  const clean = folderRelPath.replace(/\/+$/, '');
  return clean ? `${clean}/${FOLDER_MARKER_NAME}` : FOLDER_MARKER_NAME;
}

export function markerToFolder(markerRelPath: string): string {
  return markerRelPath.slice(0, Math.max(0, markerRelPath.length - FOLDER_MARKER_NAME.length - 1));
}
