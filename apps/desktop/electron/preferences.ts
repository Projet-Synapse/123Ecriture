import { ipcMain } from 'electron';

import { readConfig, writeConfig } from './config';
import type { Preferences } from './types';

// Personnalisation de l'interface — voir docs/ARCHITECTURE.md §7. Stockée
// pour l'instant dans le config.json app-level (userData), pas encore
// vault-scopée (`.123ecriture/theme.json`) comme prévu à terme dans
// l'architecture : ça fonctionne même sans vault sélectionné, et évite de
// coupler la personnalisation à la présence d'un vault tant que la sync
// compte (Phase 3) n'existe pas. À revisiter quand la personnalisation
// devra suivre l'utilisateur·rice plutôt que la machine.
export const DEFAULT_PREFERENCES: Preferences = {
  themeMode: 'system',
  accentColor: '#4f46e5',
  // Ordre + visibilité des boutons de la barre d'outils Notes. La liste des
  // ids possibles vit côté renderer (apps/mobile/lib/notesToolbarActions.ts)
  // — le process principal ne connaît que la structure générique.
  notesToolbarOrder: [
    { id: 'h1', visible: true },
    { id: 'h2', visible: true },
    { id: 'h3', visible: true },
    { id: 'bold', visible: true },
    { id: 'italic', visible: true },
    { id: 'code', visible: true },
    { id: 'quote', visible: true },
    { id: 'bullet', visible: true },
    { id: 'numbered', visible: true },
    { id: 'link', visible: true },
    { id: 'table', visible: true },
  ],
};

export function getPreferences(): Preferences {
  const stored = readConfig().preferences;
  // Fusion superficielle : tolère qu'une version future ajoute un champ par
  // défaut sans planter sur une config plus ancienne qui ne l'a pas encore.
  const merged: Preferences = { ...DEFAULT_PREFERENCES, ...stored };

  // `notesToolbarOrder` a besoin d'une fusion plus fine que le reste : une
  // config déjà enregistrée AVANT l'ajout d'un nouveau bouton par défaut
  // (ex. "table") ne le contient pas encore — la fusion superficielle
  // ci-dessus prend `stored.notesToolbarOrder` tel quel et le nouveau
  // bouton disparaîtrait silencieusement. On l'ajoute plutôt à la fin (règle
  // CLAUDE.md : un nouveau bouton doit être visible et fonctionnel, pas
  // juste présent dans le code).
  if (stored?.notesToolbarOrder) {
    const knownIds = new Set(stored.notesToolbarOrder.map((item) => item.id));
    const missing = DEFAULT_PREFERENCES.notesToolbarOrder.filter((item) => !knownIds.has(item.id));
    merged.notesToolbarOrder = [...stored.notesToolbarOrder, ...missing];
  }

  return merged;
}

export function registerPreferencesHandlers(): void {
  ipcMain.handle('preferences:get', () => getPreferences());

  ipcMain.handle('preferences:set', (_event, partial: Partial<Preferences>) => {
    const next = { ...getPreferences(), ...partial };
    writeConfig({ preferences: next });
    return next;
  });
}
