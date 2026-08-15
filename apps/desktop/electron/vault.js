const { dialog, ipcMain } = require('electron');
const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const { readConfig, writeConfig } = require('./config');

// Phase 1 : vault local minimal — un dossier choisi par l'utilisateur·rice,
// des fichiers .mdx dedans. Le chemin du vault est persisté dans
// config.json (voir config.js) pour le retrouver au redémarrage. Voir
// docs/ARCHITECTURE.md §5.

function getVaultPath() {
  return readConfig().vaultPath ?? null;
}

// La fenêtre est sandboxée (contextIsolation, pas de nodeIntegration) donc
// le renderer ne peut pas manipuler fs directement, mais mieux vaut quand
// même ne jamais faire confiance à un relPath IPC sans vérifier qu'il reste
// dans le vault (ex. contre un "../../etc/passwd" mal intentionné ou bugué).
function resolveInVault(vaultPath, relPath) {
  const root = path.resolve(vaultPath);
  const resolved = path.resolve(root, relPath);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(`Chemin hors du vault refusé : ${relPath}`);
  }
  return resolved;
}

// Trouve un nom de fichier/dossier disponible en suffixant " 2", " 3"...
// si `candidate` existe déjà — mêmes règles pour les notes et les dossiers.
function findAvailableName(vaultPath, candidate, extension = '') {
  let name = candidate;
  let counter = 2;
  while (fsSync.existsSync(path.join(vaultPath, `${name}${extension}`))) {
    name = `${candidate} ${counter}`;
    counter += 1;
  }
  return `${name}${extension}`;
}

async function walkMdxFiles(dir, vaultRoot, results = []) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    // Ignore les dossiers cachés (.123ecriture/ config vault, .git...).
    if (entry.name.startsWith('.')) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkMdxFiles(fullPath, vaultRoot, results);
    } else if (entry.isFile() && entry.name.endsWith('.mdx')) {
      const stat = await fs.stat(fullPath);
      results.push({
        relPath: path.relative(vaultRoot, fullPath),
        name: entry.name.replace(/\.mdx$/, ''),
        modifiedAt: stat.mtimeMs,
      });
    }
  }
  return results;
}

function registerVaultHandlers() {
  ipcMain.handle('vault:choose-folder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return getVaultPath();
    }
    const chosen = result.filePaths[0];
    writeConfig({ vaultPath: chosen });
    return chosen;
  });

  ipcMain.handle('vault:get-current-path', () => getVaultPath());

  ipcMain.handle('vault:list-notes', async () => {
    const vaultPath = getVaultPath();
    if (!vaultPath) return [];
    return walkMdxFiles(vaultPath, vaultPath);
  });

  ipcMain.handle('vault:read-note', async (_event, relPath) => {
    const vaultPath = getVaultPath();
    if (!vaultPath) throw new Error('Aucun vault sélectionné');
    return fs.readFile(resolveInVault(vaultPath, relPath), 'utf8');
  });

  ipcMain.handle('vault:write-note', async (_event, relPath, content) => {
    const vaultPath = getVaultPath();
    if (!vaultPath) throw new Error('Aucun vault sélectionné');
    await fs.writeFile(resolveInVault(vaultPath, relPath), content, 'utf8');
  });

  ipcMain.handle('vault:create-note', async (_event, name) => {
    const vaultPath = getVaultPath();
    if (!vaultPath) throw new Error('Aucun vault sélectionné');

    const safeName = name && name.trim().length > 0 ? name.trim() : 'Sans titre';
    const fileName = findAvailableName(vaultPath, safeName, '.mdx');
    const fullPath = path.join(vaultPath, fileName);
    const template = `---\ntitle: ${safeName}\ncreated: ${new Date().toISOString()}\n---\n\n`;
    await fs.writeFile(fullPath, template, 'utf8');
    const stat = await fs.stat(fullPath);

    return {
      relPath: path.relative(vaultPath, fullPath),
      name: fileName.replace(/\.mdx$/, ''),
      modifiedAt: stat.mtimeMs,
    };
  });

  // Crée un dossier à la racine du vault. Pas encore de navigateur de
  // dossiers dans l'UI (Notes reste une liste plate de tous les .mdx,
  // récursive) — le dossier existe bien sur le disque et toute note qu'on y
  // place manuellement apparaît dans la liste, mais rien ne l'affiche
  // encore comme dossier à proprement parler. À revoir avec un vrai
  // navigateur de vault.
  ipcMain.handle('vault:create-folder', async (_event, name) => {
    const vaultPath = getVaultPath();
    if (!vaultPath) throw new Error('Aucun vault sélectionné');

    const safeName = name && name.trim().length > 0 ? name.trim() : 'Nouveau dossier';
    const folderName = findAvailableName(vaultPath, safeName);
    await fs.mkdir(path.join(vaultPath, folderName));

    return { relPath: folderName, name: folderName };
  });
}

module.exports = { registerVaultHandlers };
