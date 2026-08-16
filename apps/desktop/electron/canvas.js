const { ipcMain } = require('electron');
const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const crypto = require('crypto');
const vaults = require('./vaults');

// Module "Canvas" (cartes texte/note reliées par des flèches sur un plan
// libre, voir apps/mobile/components/CanvasScreen.tsx) — plusieurs canvases
// nommés par coffre, même schéma de registre que les feuilles de
// graphiques (sheets.js) et les listes de tâches : `.123ecriture/canvaslists.json`
// (`{canvases, activeCanvasId}`) + un fichier de données par canvas
// (`.123ecriture/canvases/<id>.json`, nœuds/arêtes).

function getVaultPath() {
  return vaults.getActiveVaultPath();
}

function getCanvasListsFilePath(vaultPath) {
  return path.join(vaultPath, '.123ecriture', 'canvaslists.json');
}

function getCanvasDataFilePath(vaultPath, canvasId) {
  return path.join(vaultPath, '.123ecriture', 'canvases', `${canvasId}.json`);
}

function readCanvasListsRaw(vaultPath) {
  try {
    return JSON.parse(fsSync.readFileSync(getCanvasListsFilePath(vaultPath), 'utf8'));
  } catch {
    return null;
  }
}

function writeCanvasLists(vaultPath, data) {
  const filePath = getCanvasListsFilePath(vaultPath);
  fsSync.mkdirSync(path.dirname(filePath), { recursive: true });
  fsSync.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  return data;
}

function defaultCanvasData() {
  return { nodes: [], edges: [] };
}

function writeCanvasDataSync(vaultPath, canvasId, data) {
  const filePath = getCanvasDataFilePath(vaultPath, canvasId);
  fsSync.mkdirSync(path.dirname(filePath), { recursive: true });
  fsSync.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function readCanvasData(vaultPath, canvasId) {
  try {
    return JSON.parse(fsSync.readFileSync(getCanvasDataFilePath(vaultPath, canvasId), 'utf8'));
  } catch {
    return defaultCanvasData();
  }
}

// Migration paresseuse et idempotente : première consultation d'un coffre →
// un canvas "Canvas" par défaut, même pattern que vaults.js/tasks.js/sheets.js.
function migrateCanvasLists(vaultPath) {
  let data = readCanvasListsRaw(vaultPath);
  if (data) return data;

  const canvas = { id: crypto.randomUUID(), name: 'Canvas', createdAt: new Date().toISOString() };
  data = { canvases: [canvas], activeCanvasId: canvas.id };
  writeCanvasLists(vaultPath, data);
  writeCanvasDataSync(vaultPath, canvas.id, defaultCanvasData());
  return data;
}

function findCanvasOrThrow(canvases, id) {
  const canvas = canvases.find((c) => c.id === id);
  if (!canvas) throw new Error('Canvas introuvable.');
  return canvas;
}

function broadcastCanvasListsChanged(getWindow, vaultPath) {
  const win = getWindow?.();
  if (win) win.webContents.send('canvaslists:changed', migrateCanvasLists(vaultPath).canvases);
}

function registerCanvasHandlers(getWindow) {
  ipcMain.handle('canvaslists:list', () => {
    const vaultPath = getVaultPath();
    if (!vaultPath) return [];
    return migrateCanvasLists(vaultPath).canvases;
  });

  ipcMain.handle('canvaslists:get-active', () => {
    const vaultPath = getVaultPath();
    if (!vaultPath) return null;
    return migrateCanvasLists(vaultPath).activeCanvasId;
  });

  ipcMain.handle('canvaslists:create', (_event, name) => {
    const vaultPath = getVaultPath();
    if (!vaultPath) throw new Error('Aucun vault sélectionné');
    const trimmed = (name ?? '').trim();
    if (!trimmed) throw new Error('Le nom du canvas ne peut pas être vide.');

    const data = migrateCanvasLists(vaultPath);
    const canvas = { id: crypto.randomUUID(), name: trimmed, createdAt: new Date().toISOString() };
    data.canvases.push(canvas);
    data.activeCanvasId = canvas.id;
    writeCanvasLists(vaultPath, data);
    writeCanvasDataSync(vaultPath, canvas.id, defaultCanvasData());
    broadcastCanvasListsChanged(getWindow, vaultPath);
    return data.canvases;
  });

  ipcMain.handle('canvaslists:rename', (_event, id, name) => {
    const vaultPath = getVaultPath();
    if (!vaultPath) throw new Error('Aucun vault sélectionné');
    const trimmed = (name ?? '').trim();
    if (!trimmed) throw new Error('Le nom du canvas ne peut pas être vide.');

    const data = migrateCanvasLists(vaultPath);
    findCanvasOrThrow(data.canvases, id).name = trimmed;
    writeCanvasLists(vaultPath, data);
    broadcastCanvasListsChanged(getWindow, vaultPath);
    return data.canvases;
  });

  ipcMain.handle('canvaslists:remove', async (_event, id) => {
    const vaultPath = getVaultPath();
    if (!vaultPath) throw new Error('Aucun vault sélectionné');

    const data = migrateCanvasLists(vaultPath);
    data.canvases = data.canvases.filter((c) => c.id !== id);
    if (data.activeCanvasId === id) {
      data.activeCanvasId = data.canvases[0]?.id ?? null;
    }
    writeCanvasLists(vaultPath, data);
    await fs.rm(getCanvasDataFilePath(vaultPath, id), { force: true });

    broadcastCanvasListsChanged(getWindow, vaultPath);
    return data.canvases;
  });

  ipcMain.handle('canvaslists:switch', (_event, id) => {
    const vaultPath = getVaultPath();
    if (!vaultPath) throw new Error('Aucun vault sélectionné');

    const data = migrateCanvasLists(vaultPath);
    findCanvasOrThrow(data.canvases, id);
    data.activeCanvasId = id;
    writeCanvasLists(vaultPath, data);
    broadcastCanvasListsChanged(getWindow, vaultPath);
    return data.canvases;
  });

  ipcMain.handle('canvas:get-active-data', () => {
    const vaultPath = getVaultPath();
    if (!vaultPath) return defaultCanvasData();
    const activeCanvasId = migrateCanvasLists(vaultPath).activeCanvasId;
    if (!activeCanvasId) return defaultCanvasData();
    return readCanvasData(vaultPath, activeCanvasId);
  });

  ipcMain.handle('canvas:save-active-data', async (_event, canvasData) => {
    const vaultPath = getVaultPath();
    if (!vaultPath) throw new Error('Aucun vault sélectionné');
    const activeCanvasId = migrateCanvasLists(vaultPath).activeCanvasId;
    if (!activeCanvasId) throw new Error('Aucun canvas sélectionné.');
    const filePath = getCanvasDataFilePath(vaultPath, activeCanvasId);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(canvasData, null, 2), 'utf8');
    return canvasData;
  });
}

module.exports = { registerCanvasHandlers };
