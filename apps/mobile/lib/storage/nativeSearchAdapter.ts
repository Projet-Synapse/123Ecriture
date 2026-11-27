// ✒️ 123ECRITURE — lib/storage/nativeSearchAdapter.ts — pont window.search (Android)
//////////////////////////////////////////////////////////////////////////////
//
// Recherche globale Android (v0.4.100) : jusque-là AUCUN pont n'était
// installé, la boîte de recherche répondait « Aucun résultat » à tout.
// Délègue à lib/search/vaultSearch.ts en lisant le coffre ACTIF au moment
// de l'appel (window.vault peut changer : SAF, local, cloud).
//
//////////////////////////////////////////////////////////////////////////////

import { searchVault } from '../search/vaultSearch';

export const nativeSearchAdapter = {
  run: async (query: string, options?: SearchOptions): Promise<SearchResult[]> => {
    const vault = typeof window !== 'undefined' ? window.vault : undefined;
    if (!vault) return [];
    const tasks = window.tasks;
    const calendar = window.calendar;
    return searchVault(
      {
        listTree: () => vault.listTree(),
        readNote: (relPath) => vault.readNote(relPath),
        listTasks: tasks ? () => tasks.list() : undefined,
        listEvents: calendar ? () => calendar.listEvents() : undefined,
      },
      query,
      options,
    );
  },
} satisfies SearchBridge;
