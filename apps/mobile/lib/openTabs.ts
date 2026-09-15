// Onglets de notes — logique PURE (testée, voir openTabs.test.ts), le reste
// (état React, pont IPC vault:get/set-open-tabs, barre d'onglets) vit dans
// NotesScreen.tsx / apps/desktop/electron/vault.ts. L'ordre du tableau EST
// l'ordre des onglets ; la persistance ne stocke que des relPaths (les
// métadonnées sont re-résolues dans l'arbre au rendu — un chemin périmé est
// simplement ignoré, comme pour collapsedRelPaths).

// Un élément renommé/déplacé affecte une entrée si c'est elle-même, ou si
// c'est un dossier qui la contient (renommage/déplacement de dossier =>
// changement de relPath en cascade). Déplacée ICI depuis NotesScreen.tsx
// pour être partagée avec applyPathChange (et testée).
export function isPathAffected(relPath: string, changedOldRelPath: string): boolean {
  return relPath === changedOldRelPath || relPath.startsWith(`${changedOldRelPath}/`);
}

// Applique un renommage/déplacement (`newRelPath` fourni) ou une suppression
// (`newRelPath` null) à la liste d'onglets :
// - l'onglet exactement concerné est réécrit sous son nouveau chemin ;
// - les onglets SITOUS DANS le dossier concerné disparaissent (leur nouveau
//   chemin exact n'est pas connu ici — même compromis que la note active
//   dans NotesScreen, qui se ferme dans ce cas ; il suffit de re-cliquer).
export function applyPathChange(openTabs: string[], oldRelPath: string, newRelPath?: string | null): string[] {
  const next = openTabs.flatMap((relPath) => {
    if (relPath === oldRelPath) return newRelPath ? [newRelPath] : [];
    return isPathAffected(relPath, oldRelPath) ? [] : [relPath];
  });
  return listsEqual(next, openTabs) ? openTabs : next;
}

// Fusionne la liste d'onglets persistée d'un coffre avec les onglets déjà
// ouverts en session (une ouverture par défaut / un pendingOpen a pu ajouter
// un onglet PENDANT le chargement asynchrone) : l'ordre persisté prime, les
// onglets de session absents de la liste sont ajoutés à la fin, doublons
// exclus — sans ça, la restauration ÉCRASAIT l'onglet de la note rouverte
// au démarrage et la barre disparaissait bien que la note fût active.
export function mergeRestoredOpenTabs(restored: string[], session: string[]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const relPath of [...restored, ...session]) {
    if (seen.has(relPath)) continue;
    seen.add(relPath);
    merged.push(relPath);
  }
  return merged;
}

function listsEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}
