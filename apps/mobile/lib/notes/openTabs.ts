// ✒️ 123ECRITURE — lib/notes/openTabs.ts — onglets de notes (logique pure)
//////////////////////////////////////////////////////////////////////////////
//
// Logique PURE des onglets de notes (testée, voir openTabs.test.ts) — le
// reste (état React, pont IPC vault:get/set-open-tabs, barre d'onglets)
// vit dans NotesScreen.tsx / apps/desktop/electron/vault.ts. L'ordre du
// tableau EST l'ordre des onglets ; la persistance ne stocke que des
// relPaths (les métadonnées sont re-résolues dans l'arbre au rendu — un
// chemin périmé est simplement ignoré, comme pour collapsedRelPaths).
//
// Invariants du fichier :
//   • Un renommage/déplacement affecte une entrée si c'est elle-même ou un
//     dossier qui la contient (changement de relPath en cascade) ; une
//     SUPPRESSION fait disparaître les onglets situés dans le dossier
//     concerné (leur nouveau chemin exact n'est pas connu ici).
//   • La fusion restauration/session ne perd jamais d'onglet : l'ordre
//     persisté prime, les onglets de session absents de la liste sont
//     ajoutés à la fin, doublons exclus.
//   • applyPathChange renvoie la MÊME liste si rien n'a changé (stabilité
//     de référence pour le rendu React).
//
// SOMMAIRE :
//   1. Renommage/déplacement/suppression — isPathAffected, applyPathChange
//   2. Fusion restauration/session — mergeRestoredOpenTabs
//
//////////////////////////////////////////////////////////////////////////////

//////// 1. Renommage/déplacement/suppression — isPathAffected, applyPathChange ///

// Un élément renommé/déplacé affecte une entrée si c'est elle-même, ou si
// c'est un dossier qui la contient (renommage/déplacement de dossier =>
// changement de relPath en cascade).
export function isPathAffected(relPath: string, changedOldRelPath: string): boolean {
  return relPath === changedOldRelPath || relPath.startsWith(`${changedOldRelPath}/`);
}

// Applique un renommage/déplacement (`newRelPath` fourni) ou une suppression
// (`newRelPath` null) à la liste d'onglets :
// - l'onglet exactement concerné est réécrit sous son nouveau chemin ;
// - les onglets SITUÉS DANS un dossier renommé/déplacé suivent (préfixe
//   remplacé — `newRelPath` est le nouveau chemin RÉEL du dossier) ;
// - suppression : l'onglet et ceux du dossier supprimé disparaissent ;
// - jamais de doublon (conversion .md → .mdx alors que le .mdx était déjà
//   ouvert, déplacement sur un onglet existant) : la 1re occurrence reste.
export function applyPathChange(openTabs: string[], oldRelPath: string, newRelPath?: string | null): string[] {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const relPath of openTabs) {
    const mapped = remapPath(relPath, oldRelPath, newRelPath ?? null);
    if (mapped === null || seen.has(mapped)) continue;
    seen.add(mapped);
    next.push(mapped);
  }
  return listsEqual(next, openTabs) ? openTabs : next;
}

// Nouveau chemin d'une entrée après le renommage/déplacement (ou la
// suppression, `newRelPath` null → null) de `oldRelPath` ; inchangée si
// non concernée.
export function remapPath(relPath: string, oldRelPath: string, newRelPath: string | null): string | null {
  if (!isPathAffected(relPath, oldRelPath)) return relPath;
  if (newRelPath === null) return null;
  return relPath === oldRelPath ? newRelPath : `${newRelPath}${relPath.slice(oldRelPath.length)}`;
}

// Onglets réellement affichables : chemins existants (fichiers), sans
// doublon — un chemin disparu (supprimé ailleurs, synchro) n'apparaît pas.
export function visibleOpenTabs(openTabs: readonly string[], exists: (relPath: string) => boolean): string[] {
  const seen = new Set<string>();
  return openTabs.filter((relPath) => {
    if (seen.has(relPath) || !exists(relPath)) return false;
    seen.add(relPath);
    return true;
  });
}

// Décalage horizontal pour amener l'onglet [x, x+width] dans la vue
// [offset, offset+viewport] (marge `pad`), ou null s'il est déjà visible.
export function tabScrollOffset(tab: { x: number; width: number }, offset: number, viewport: number, pad = 24): number | null {
  if (viewport <= 0) return null;
  if (tab.x - pad < offset) return Math.max(0, tab.x - pad);
  if (tab.x + tab.width + pad > offset + viewport) return Math.max(0, tab.x + tab.width + pad - viewport);
  return null;
}

//////// 2. Fusion restauration/session — mergeRestoredOpenTabs //////////////

// Fusionne la liste d'onglets persistée d'un coffre avec les onglets déjà
// ouverts en session (une ouverture par défaut / un pendingOpen a pu ajouter
// un onglet PENDANT le chargement asynchrone) : l'ordre persisté prime, les
// onglets de session absents de la liste sont ajoutés à la fin, doublons
// exclus — sans ça, la restauration écraserait l'onglet de la note rouverte
// au démarrage et la barre disparaîtrait bien que la note soit active.
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
