const { ipcMain } = require('electron');
const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const crypto = require('crypto');
const vaults = require('./vaults');

// Module "Graphiques" (tableur intégré + graphiques barres/lignes/
// camembert, voir apps/mobile/components/ChartsScreen.tsx) — plusieurs
// FEUILLES nommées par coffre, même schéma de registre que les listes de
// tâches (tasks.js) : `.123ecriture/sheetlists.json` (`{sheets, activeSheetId}`)
// + un fichier de données par feuille (`.123ecriture/sheets/<id>.json`,
// colonnes/lignes/config du graphique). Un fichier séparé par feuille (pas
// tout dans un seul fichier comme tasks.json) : contrairement aux tâches,
// une feuille peut contenir beaucoup de cellules, autant éviter de
// réécrire TOUTES les feuilles à chaque frappe dans une seule.

function getVaultPath() {
  return vaults.getActiveVaultPath();
}

function getSheetListsFilePath(vaultPath) {
  return path.join(vaultPath, '.123ecriture', 'sheetlists.json');
}

function getSheetDataFilePath(vaultPath, sheetId) {
  return path.join(vaultPath, '.123ecriture', 'sheets', `${sheetId}.json`);
}

function readSheetListsRaw(vaultPath) {
  try {
    return JSON.parse(fsSync.readFileSync(getSheetListsFilePath(vaultPath), 'utf8'));
  } catch {
    return null;
  }
}

function writeSheetLists(vaultPath, data) {
  const filePath = getSheetListsFilePath(vaultPath);
  fsSync.mkdirSync(path.dirname(filePath), { recursive: true });
  fsSync.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  return data;
}

// Deux colonnes vides par défaut — assez pour qu'un graphique (étiquettes +
// valeurs) ait immédiatement de quoi se configurer, sans imposer de
// données factices.
function defaultSheetData() {
  return {
    columns: [
      { id: crypto.randomUUID(), name: 'Colonne A' },
      { id: crypto.randomUUID(), name: 'Colonne B' },
    ],
    rows: [],
    chart: null,
  };
}

function writeSheetDataSync(vaultPath, sheetId, data) {
  const filePath = getSheetDataFilePath(vaultPath, sheetId);
  fsSync.mkdirSync(path.dirname(filePath), { recursive: true });
  fsSync.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function readSheetData(vaultPath, sheetId) {
  try {
    return JSON.parse(fsSync.readFileSync(getSheetDataFilePath(vaultPath, sheetId), 'utf8'));
  } catch {
    return defaultSheetData();
  }
}

// Migration paresseuse et idempotente : première consultation d'un coffre →
// une feuille "Feuille 1" par défaut, même pattern que vaults.js/tasks.js.
function migrateSheetLists(vaultPath) {
  let data = readSheetListsRaw(vaultPath);
  if (data) return data;

  const sheet = { id: crypto.randomUUID(), name: 'Feuille 1', createdAt: new Date().toISOString() };
  data = { sheets: [sheet], activeSheetId: sheet.id };
  writeSheetLists(vaultPath, data);
  writeSheetDataSync(vaultPath, sheet.id, defaultSheetData());
  return data;
}

function findSheetOrThrow(sheets, id) {
  const sheet = sheets.find((s) => s.id === id);
  if (!sheet) throw new Error('Feuille introuvable.');
  return sheet;
}

function broadcastSheetListsChanged(getWindow, vaultPath) {
  const win = getWindow?.();
  if (win) win.webContents.send('sheetlists:changed', migrateSheetLists(vaultPath).sheets);
}

function registerSheetsHandlers(getWindow) {
  ipcMain.handle('sheetlists:list', () => {
    const vaultPath = getVaultPath();
    if (!vaultPath) return [];
    return migrateSheetLists(vaultPath).sheets;
  });

  ipcMain.handle('sheetlists:get-active', () => {
    const vaultPath = getVaultPath();
    if (!vaultPath) return null;
    return migrateSheetLists(vaultPath).activeSheetId;
  });

  ipcMain.handle('sheetlists:create', (_event, name) => {
    const vaultPath = getVaultPath();
    if (!vaultPath) throw new Error('Aucun vault sélectionné');
    const trimmed = (name ?? '').trim();
    if (!trimmed) throw new Error('Le nom de la feuille ne peut pas être vide.');

    const data = migrateSheetLists(vaultPath);
    const sheet = { id: crypto.randomUUID(), name: trimmed, createdAt: new Date().toISOString() };
    data.sheets.push(sheet);
    data.activeSheetId = sheet.id;
    writeSheetLists(vaultPath, data);
    writeSheetDataSync(vaultPath, sheet.id, defaultSheetData());
    broadcastSheetListsChanged(getWindow, vaultPath);
    return data.sheets;
  });

  ipcMain.handle('sheetlists:rename', (_event, id, name) => {
    const vaultPath = getVaultPath();
    if (!vaultPath) throw new Error('Aucun vault sélectionné');
    const trimmed = (name ?? '').trim();
    if (!trimmed) throw new Error('Le nom de la feuille ne peut pas être vide.');

    const data = migrateSheetLists(vaultPath);
    findSheetOrThrow(data.sheets, id).name = trimmed;
    writeSheetLists(vaultPath, data);
    broadcastSheetListsChanged(getWindow, vaultPath);
    return data.sheets;
  });

  // Supprime la feuille ET son fichier de données — même logique que les
  // listes de tâches (une feuille est un document jetable parmi d'autres,
  // pas une note du vault, qu'on ne supprime jamais silencieusement ici).
  ipcMain.handle('sheetlists:remove', async (_event, id) => {
    const vaultPath = getVaultPath();
    if (!vaultPath) throw new Error('Aucun vault sélectionné');

    const data = migrateSheetLists(vaultPath);
    data.sheets = data.sheets.filter((s) => s.id !== id);
    if (data.activeSheetId === id) {
      data.activeSheetId = data.sheets[0]?.id ?? null;
    }
    writeSheetLists(vaultPath, data);
    await fs.rm(getSheetDataFilePath(vaultPath, id), { force: true });

    broadcastSheetListsChanged(getWindow, vaultPath);
    return data.sheets;
  });

  ipcMain.handle('sheetlists:switch', (_event, id) => {
    const vaultPath = getVaultPath();
    if (!vaultPath) throw new Error('Aucun vault sélectionné');

    const data = migrateSheetLists(vaultPath);
    findSheetOrThrow(data.sheets, id);
    data.activeSheetId = id;
    writeSheetLists(vaultPath, data);
    broadcastSheetListsChanged(getWindow, vaultPath);
    return data.sheets;
  });

  ipcMain.handle('sheet:get-active-data', () => {
    const vaultPath = getVaultPath();
    if (!vaultPath) return defaultSheetData();
    const activeSheetId = migrateSheetLists(vaultPath).activeSheetId;
    if (!activeSheetId) return defaultSheetData();
    return readSheetData(vaultPath, activeSheetId);
  });

  ipcMain.handle('sheet:save-active-data', async (_event, sheetData) => {
    const vaultPath = getVaultPath();
    if (!vaultPath) throw new Error('Aucun vault sélectionné');
    const activeSheetId = migrateSheetLists(vaultPath).activeSheetId;
    if (!activeSheetId) throw new Error('Aucune feuille sélectionnée.');
    const filePath = getSheetDataFilePath(vaultPath, activeSheetId);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(sheetData, null, 2), 'utf8');
    return sheetData;
  });
}

module.exports = { registerSheetsHandlers };
