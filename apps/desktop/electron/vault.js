const { app, dialog, ipcMain } = require('electron');
const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');

// Phase 1 : vault local minimal — un dossier choisi par l'utilisateur·rice,
// des fichiers .mdx dedans. Le chemin du vault est persisté dans un petit
// config.json (dossier userData d'Electron, indépendant de la version de
// l'app) pour le retrouver au redémarrage. Voir docs/ARCHITECTURE.md §5.

function getConfigPath() {
  return path.join(app.getPath('userData'), 'config.json');
}

function readConfig() {
  try {
    return JSON.parse(fsSync.readFileSync(getConfigPath(), 'utf8'));
  } catch {
    return {};
  }
}

function writeConfig(config) {
  fsSync.mkdirSync(path.dirname(getConfigPath()), { recursive: true });
  fsSync.writeFileSync(getConfigPath(), JSON.stringify(config, null, 2), 'utf8');
}

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
    writeConfig({ ...readConfig(), vaultPath: chosen });
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
    let fileName = `${safeName}.mdx`;
    let counter = 2;
    while (fsSync.existsSync(path.join(vaultPath, fileName))) {
      fileName = `${safeName} ${counter}.mdx`;
      counter += 1;
    }

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
}

module.exports = { registerVaultHandlers };
