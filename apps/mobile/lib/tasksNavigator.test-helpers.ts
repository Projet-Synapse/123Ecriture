// Fabrique d'items de navigateur pour les tests (tasksNavigator.test.ts) —
// un helper plutôt que des littéraux répétés : createdAt est requis par le
// type TaskList (global, voir types/global.d.ts), les champs du navigateur
// (isFolder/folderId/order) sont optionnels et passés ici par patch.
export function makeTaskList(id: string, patch: Partial<TaskList> = {}): TaskList {
  return { id, name: id, createdAt: '2026-10-08T00:00:00.000Z', ...patch } as TaskList;
}
