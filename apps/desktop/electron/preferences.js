const { ipcMain } = require('electron');
const { readConfig, writeConfig } = require('./config');

// Personnalisation de l'interface — voir docs/ARCHITECTURE.md §7. Stockée
// pour l'instant dans le config.json app-level (userData), pas encore
// vault-scopée (`.123ecriture/theme.json`) comme prévu à terme dans
// l'architecture : ça fonctionne même sans vault sélectionné, et évite de
// coupler la personnalisation à la présence d'un vault tant que la sync
// compte (Phase 3) n'existe pas. À revisiter quand la personnalisation
// devra suivre l'utilisateur·rice plutôt que la machine.
const DEFAULT_PREFERENCES = {
  themeMode: 'system', // 'system' | 'light' | 'dark'
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
  ],
};

function getPreferences() {
  const stored = readConfig().preferences;
  // Fusion superficielle : tolère qu'une version future ajoute un champ par
  // défaut sans planter sur une config plus ancienne qui ne l'a pas encore.
  return { ...DEFAULT_PREFERENCES, ...stored };
}

function registerPreferencesHandlers() {
  ipcMain.handle('preferences:get', () => getPreferences());

  ipcMain.handle('preferences:set', (_event, partial) => {
    const next = { ...getPreferences(), ...partial };
    writeConfig({ preferences: next });
    return next;
  });
}

module.exports = { registerPreferencesHandlers, getPreferences, DEFAULT_PREFERENCES };
