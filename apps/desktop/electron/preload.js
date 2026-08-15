const { contextBridge, ipcRenderer } = require('electron');

// Phase 1 : pont contextIsolation-safe (pas de nodeIntegration) vers le
// vault local — la logique fichier réelle vit dans vault.js (accès fs
// natif dans le process principal), exposée ici via IPC.
contextBridge.exposeInMainWorld('electronBridge', {
  platform: process.platform,
});

contextBridge.exposeInMainWorld('vault', {
  chooseFolder: () => ipcRenderer.invoke('vault:choose-folder'),
  getCurrentPath: () => ipcRenderer.invoke('vault:get-current-path'),
  listNotes: () => ipcRenderer.invoke('vault:list-notes'),
  readNote: (relPath) => ipcRenderer.invoke('vault:read-note', relPath),
  writeNote: (relPath, content) => ipcRenderer.invoke('vault:write-note', relPath, content),
  createNote: (name) => ipcRenderer.invoke('vault:create-note', name),
  createFolder: (name) => ipcRenderer.invoke('vault:create-folder', name),
});

contextBridge.exposeInMainWorld('updater', {
  getVersion: () => ipcRenderer.invoke('updater:get-version'),
  getStatus: () => ipcRenderer.invoke('updater:get-status'),
  check: () => ipcRenderer.invoke('updater:check'),
  quitAndInstall: () => ipcRenderer.invoke('updater:quit-and-install'),
  onStatusChange: (callback) => {
    const handler = (_event, status) => callback(status);
    ipcRenderer.on('updater:status', handler);
    return () => ipcRenderer.removeListener('updater:status', handler);
  },
});

contextBridge.exposeInMainWorld('preferences', {
  get: () => ipcRenderer.invoke('preferences:get'),
  set: (partial) => ipcRenderer.invoke('preferences:set', partial),
});

contextBridge.exposeInMainWorld('contextMenu', {
  show: (items) => ipcRenderer.invoke('context-menu:show', items),
});
