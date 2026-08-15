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
  listTree: () => ipcRenderer.invoke('vault:list-tree'),
  readNote: (relPath) => ipcRenderer.invoke('vault:read-note', relPath),
  writeNote: (relPath, content) => ipcRenderer.invoke('vault:write-note', relPath, content),
  createNote: (name, parentRelPath) => ipcRenderer.invoke('vault:create-note', name, parentRelPath),
  createFolder: (name, parentRelPath) => ipcRenderer.invoke('vault:create-folder', name, parentRelPath),
  rename: (relPath, newName) => ipcRenderer.invoke('vault:rename', relPath, newName),
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

contextBridge.exposeInMainWorld('tasks', {
  list: () => ipcRenderer.invoke('tasks:list'),
  add: (text) => ipcRenderer.invoke('tasks:add', text),
  toggle: (id) => ipcRenderer.invoke('tasks:toggle', id),
  remove: (id) => ipcRenderer.invoke('tasks:remove', id),
});
