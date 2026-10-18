// Logique PURE du navigateur de tâches (v0.4.48 — demandes utilisateur :
// « réorganiser les listes et dossiers par glisser-déposer », « aperçu
// cochable des sous-étapes sous le titre ») — séparée de TasksScreen.tsx
// pour rester testable sans dépendance lourde, comme les autres fichiers
// de lib/. Un item du navigateur est une TaskList (une entrée `isFolder`
// est un DOSSIER de listes — voir types/global.d.ts).

// Tri d'un SCOPE (les items d'un même dossier) : `order` croissant (les
// items sans ordre, ex. créés par une ancienne version, passent en fin),
// puis nom en repli — déterministe et stable pour le glisser-déposer.
export function sortNavigatorItems(items: TaskList[]): TaskList[] {
  return [...items].sort((a, b) => {
    const orderA = a.order ?? Number.MAX_SAFE_INTEGER;
    const orderB = b.order ?? Number.MAX_SAFE_INTEGER;
    if (orderA !== orderB) return orderA - orderB;
    return a.name.localeCompare(b.name, 'fr');
  });
}

// Ordre FINAL à persister après un dépôt AVANT l'item `beforeId` (null =
// fin de scope) : renvoie les paires {id, order} du scope recomposées
// (l'item déplacé retiré de sa position, réinséré au point de dépôt, puis
// renuméroté 0..n). `draggedId` doit appartenir au scope.
export function orderAfterDrop(
  scopeItems: TaskList[],
  draggedId: string,
  beforeId: string | null,
): { id: string; order: number }[] {
  const ids = sortNavigatorItems(scopeItems).map((item) => item.id);
  const from = ids.indexOf(draggedId);
  if (from === -1) return [];
  ids.splice(from, 1);

  let insertAt = beforeId === null ? ids.length : ids.indexOf(beforeId);
  if (insertAt === -1) insertAt = ids.length;
  ids.splice(insertAt, 0, draggedId);

  return ids.map((id, index) => ({ id, order: index }));
}

// Compte à faire d'un scope de tâches (pour le badge d'une liste) —
// nombre de tâches non cochées.
export function pendingTaskCount(tasks: { done: boolean }[]): number {
  return tasks.filter((task) => !task.done).length;
}
