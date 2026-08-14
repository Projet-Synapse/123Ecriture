const { contextBridge } = require('electron');

// Phase 0 : pont vide (contextIsolation activée, pas de nodeIntegration).
// Les APIs de fichiers/vault (VaultAdapter Electron) seront exposées ici en
// Phase 1 — voir docs/ARCHITECTURE.md §5.
contextBridge.exposeInMainWorld('electronBridge', {
  platform: process.platform,
});
