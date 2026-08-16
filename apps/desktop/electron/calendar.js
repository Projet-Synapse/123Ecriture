const { ipcMain } = require('electron');
const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const crypto = require('crypto');
const vaults = require('./vaults');

// Module "Calendrier" — évènements horodatés (voir docs/ARCHITECTURE.md §8
// et apps/mobile/components/CalendarScreen.tsx). Les notes JOURNALIÈRES,
// elles, vivent comme de vraies notes .mdx (voir vault:ensure-daily-note
// dans vault.js) — seuls les ÉVÈNEMENTS (titre, date, heure optionnelle)
// ont besoin d'un stockage structuré dédié, pas assez "document" pour être
// une note. Même schéma que tasks.js : un fichier caché scopé au coffre
// actif, pas de multi-listes ici (un seul calendrier par coffre a du sens,
// contrairement aux tâches).

function getVaultPath() {
  return vaults.getActiveVaultPath();
}

function getEventsFilePath(vaultPath) {
  return path.join(vaultPath, '.123ecriture', 'events.json');
}

function readEvents(vaultPath) {
  try {
    return JSON.parse(fsSync.readFileSync(getEventsFilePath(vaultPath), 'utf8'));
  } catch {
    return [];
  }
}

async function writeEvents(vaultPath, events) {
  const filePath = getEventsFilePath(vaultPath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(events, null, 2), 'utf8');
  return events;
}

function registerCalendarHandlers() {
  ipcMain.handle('calendar:list-events', () => {
    const vaultPath = getVaultPath();
    if (!vaultPath) return [];
    return readEvents(vaultPath);
  });

  ipcMain.handle('calendar:add-event', async (_event, input) => {
    const vaultPath = getVaultPath();
    if (!vaultPath) throw new Error('Aucun vault sélectionné');
    const title = (input?.title ?? '').trim();
    if (!title) throw new Error('Le titre de l’évènement ne peut pas être vide.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input?.date ?? '')) {
      throw new Error('Date invalide (attendu AAAA-MM-JJ).');
    }

    const events = readEvents(vaultPath);
    events.push({
      id: crypto.randomUUID(),
      title,
      date: input.date,
      time: input?.allDay ? null : input?.time || null,
      allDay: Boolean(input?.allDay),
      notes: input?.notes ?? '',
      createdAt: new Date().toISOString(),
    });
    return writeEvents(vaultPath, events);
  });

  ipcMain.handle('calendar:update-event', async (_event, id, patch) => {
    const vaultPath = getVaultPath();
    if (!vaultPath) throw new Error('Aucun vault sélectionné');
    const events = readEvents(vaultPath).map((ev) => (ev.id === id ? { ...ev, ...patch, id: ev.id } : ev));
    return writeEvents(vaultPath, events);
  });

  ipcMain.handle('calendar:remove-event', async (_event, id) => {
    const vaultPath = getVaultPath();
    if (!vaultPath) throw new Error('Aucun vault sélectionné');
    const events = readEvents(vaultPath).filter((ev) => ev.id !== id);
    return writeEvents(vaultPath, events);
  });
}

module.exports = { registerCalendarHandlers };
