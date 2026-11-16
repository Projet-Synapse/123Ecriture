// ✒️ 123ECRITURE — lib/storage/nativePropertiesAdapter.ts — pont Propriétés natif (Android)
//////////////////////////////////////////////////////////////////////////////
//
// `window.properties` sur Android : jusqu'ici absent, d'où « Disponible sur
// la version desktop pour l'instant » dans le panneau Propriétés et la
// Gestion des propriétés, et un bloc Propriétés sans types (aucune
// définition chargée). Même schéma `.123ecriture/properties.json` DU COFFRE
// ACTIF que desktop/web, lu/écrit via readNote/writeNote comme events.json
// (nativeCalendarAdapter.ts) — synchronisé avec le reste du coffre. Toute
// la logique vit dans lib/properties/propertiesBridgeCore.ts (testée).
//
//////////////////////////////////////////////////////////////////////////////

import { flattenNotes } from '../notes/vaultTree';
import { createPropertiesBridge } from '../properties/propertiesBridgeCore';
import { activeVaultAdapter as vault } from './vaultBackend';
import { writeNoteIfChanged } from './writeIfChanged';

// Hermes n'expose pas crypto.randomUUID — identifiant local suffisant.
let idCounter = 0;
function newId(): string {
  idCounter += 1;
  return `p-${Date.now().toString(36)}-${idCounter.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export const nativePropertiesBridge: PropertiesBridge = createPropertiesBridge({
  readText: (relPath) => vault.readNote(relPath),
  writeText: async (relPath, content) => {
    await writeNoteIfChanged(
      (p) => vault.readNote(p),
      (p, c) => vault.writeNote(p, c),
      relPath,
      content,
    );
  },
  listNotes: async () =>
    flattenNotes(await vault.listTree())
      .map((note) => note.relPath)
      .filter((relPath) => /\.mdx?$/i.test(relPath) && !relPath.startsWith('.trash/')),
  newId,
});
