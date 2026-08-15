const { ipcMain } = require('electron');
const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const crypto = require('crypto');
const { readConfig } = require('./config');

// Premier module de productivité (voir docs/ARCHITECTURE.md §8) : une
// liste de tâches simple, stockée DANS le vault (pas dans le config.json
// app-level comme les préférences) — les tâches sont du contenu
// utilisateur au même titre que les notes, pas un réglage de l'app. Fichier
// caché dédié plutôt qu'une note .mdx : plus simple à lire/écrire comme
// données structurées, et .123ecriture/ est déjà le dossier réservé à la
// config du vault (voir docs/ARCHITECTURE.md §4).
//
// Pas encore de vrai registre de modules (§8) : prématuré tant qu'il n'y a
// qu'un seul module — à construire quand un deuxième (calendrier...)
// arrivera et qu'un pattern commun se dessinera vraiment.

function getVaultPath() {
  return readConfig().vaultPath ?? null;
}

function getTasksFilePath(vaultPath) {
  return path.join(vaultPath, '.123ecriture', 'tasks.json');
}

function readTasks(vaultPath) {
  try {
    return JSON.parse(fsSync.readFileSync(getTasksFilePath(vaultPath), 'utf8'));
  } catch {
    return [];
  }
}

async function writeTasks(vaultPath, tasks) {
  const filePath = getTasksFilePath(vaultPath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(tasks, null, 2), 'utf8');
  return tasks;
}

function registerTasksHandlers() {
  ipcMain.handle('tasks:list', () => {
    const vaultPath = getVaultPath();
    if (!vaultPath) return [];
    return readTasks(vaultPath);
  });

  ipcMain.handle('tasks:add', async (_event, text) => {
    const vaultPath = getVaultPath();
    if (!vaultPath) throw new Error('Aucun vault sélectionné');
    const trimmed = (text ?? '').trim();
    if (!trimmed) throw new Error('Le texte de la tâche ne peut pas être vide.');

    const tasks = readTasks(vaultPath);
    tasks.push({
      id: crypto.randomUUID(),
      text: trimmed,
      done: false,
      createdAt: new Date().toISOString(),
    });
    return writeTasks(vaultPath, tasks);
  });

  ipcMain.handle('tasks:toggle', async (_event, id) => {
    const vaultPath = getVaultPath();
    if (!vaultPath) throw new Error('Aucun vault sélectionné');
    const tasks = readTasks(vaultPath).map((task) =>
      task.id === id ? { ...task, done: !task.done } : task,
    );
    return writeTasks(vaultPath, tasks);
  });

  ipcMain.handle('tasks:remove', async (_event, id) => {
    const vaultPath = getVaultPath();
    if (!vaultPath) throw new Error('Aucun vault sélectionné');
    const tasks = readTasks(vaultPath).filter((task) => task.id !== id);
    return writeTasks(vaultPath, tasks);
  });
}

module.exports = { registerTasksHandlers };
