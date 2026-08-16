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
  move: (relPath, destinationParentRelPath) =>
    ipcRenderer.invoke('vault:move', relPath, destinationParentRelPath),
  setPath: (relPath, newRelPath) => ipcRenderer.invoke('vault:set-path', relPath, newRelPath),
  ensureDailyNote: (dateIso) => ipcRenderer.invoke('vault:ensure-daily-note', dateIso),
});

contextBridge.exposeInMainWorld('vaults', {
  list: () => ipcRenderer.invoke('vaults:list'),
  getActive: () => ipcRenderer.invoke('vaults:get-active'),
  addExisting: () => ipcRenderer.invoke('vaults:add-existing'),
  createNew: (name) => ipcRenderer.invoke('vaults:create-new', name),
  switch: (id) => ipcRenderer.invoke('vaults:switch', id),
  rename: (id, name) => ipcRenderer.invoke('vaults:rename', id, name),
  remove: (id) => ipcRenderer.invoke('vaults:remove', id),
  setCloudLink: (id, payload) => ipcRenderer.invoke('vaults:set-cloud-link', id, payload),
  onChanged: (callback) => {
    const handler = (_event, vaultList) => callback(vaultList);
    ipcRenderer.on('vaults:changed', handler);
    return () => ipcRenderer.removeListener('vaults:changed', handler);
  },
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

contextBridge.exposeInMainWorld('auth', {
  openExternal: (url) => ipcRenderer.invoke('auth:open-external', url),
  onCallback: (callback) => {
    const handler = (_event, url) => callback(url);
    ipcRenderer.on('auth:callback', handler);
    return () => ipcRenderer.removeListener('auth:callback', handler);
  },
});

contextBridge.exposeInMainWorld('sync', {
  hashVaultTree: () => ipcRenderer.invoke('sync:hash-vault'),
});

contextBridge.exposeInMainWorld('tasks', {
  list: () => ipcRenderer.invoke('tasks:list'),
  add: (text) => ipcRenderer.invoke('tasks:add', text),
  toggle: (id) => ipcRenderer.invoke('tasks:toggle', id),
  remove: (id) => ipcRenderer.invoke('tasks:remove', id),
});

contextBridge.exposeInMainWorld('calendar', {
  listEvents: () => ipcRenderer.invoke('calendar:list-events'),
  addEvent: (input) => ipcRenderer.invoke('calendar:add-event', input),
  updateEvent: (id, patch) => ipcRenderer.invoke('calendar:update-event', id, patch),
  removeEvent: (id) => ipcRenderer.invoke('calendar:remove-event', id),
});

contextBridge.exposeInMainWorld('sheetLists', {
  list: () => ipcRenderer.invoke('sheetlists:list'),
  getActive: () => ipcRenderer.invoke('sheetlists:get-active'),
  create: (name) => ipcRenderer.invoke('sheetlists:create', name),
  rename: (id, name) => ipcRenderer.invoke('sheetlists:rename', id, name),
  remove: (id) => ipcRenderer.invoke('sheetlists:remove', id),
  switch: (id) => ipcRenderer.invoke('sheetlists:switch', id),
  onChanged: (callback) => {
    const handler = (_event, lists) => callback(lists);
    ipcRenderer.on('sheetlists:changed', handler);
    return () => ipcRenderer.removeListener('sheetlists:changed', handler);
  },
});

contextBridge.exposeInMainWorld('sheet', {
  getActiveData: () => ipcRenderer.invoke('sheet:get-active-data'),
  saveActiveData: (data) => ipcRenderer.invoke('sheet:save-active-data', data),
});

contextBridge.exposeInMainWorld('canvasLists', {
  list: () => ipcRenderer.invoke('canvaslists:list'),
  getActive: () => ipcRenderer.invoke('canvaslists:get-active'),
  create: (name) => ipcRenderer.invoke('canvaslists:create', name),
  rename: (id, name) => ipcRenderer.invoke('canvaslists:rename', id, name),
  remove: (id) => ipcRenderer.invoke('canvaslists:remove', id),
  switch: (id) => ipcRenderer.invoke('canvaslists:switch', id),
  onChanged: (callback) => {
    const handler = (_event, lists) => callback(lists);
    ipcRenderer.on('canvaslists:changed', handler);
    return () => ipcRenderer.removeListener('canvaslists:changed', handler);
  },
});

contextBridge.exposeInMainWorld('canvas', {
  getActiveData: () => ipcRenderer.invoke('canvas:get-active-data'),
  saveActiveData: (data) => ipcRenderer.invoke('canvas:save-active-data', data),
});

contextBridge.exposeInMainWorld('taskLists', {
  list: () => ipcRenderer.invoke('tasklists:list'),
  getActive: () => ipcRenderer.invoke('tasklists:get-active'),
  create: (name) => ipcRenderer.invoke('tasklists:create', name),
  rename: (id, name) => ipcRenderer.invoke('tasklists:rename', id, name),
  remove: (id) => ipcRenderer.invoke('tasklists:remove', id),
  switch: (id) => ipcRenderer.invoke('tasklists:switch', id),
  onChanged: (callback) => {
    const handler = (_event, lists) => callback(lists);
    ipcRenderer.on('tasklists:changed', handler);
    return () => ipcRenderer.removeListener('tasklists:changed', handler);
  },
});
