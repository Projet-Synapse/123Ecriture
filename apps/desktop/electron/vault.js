const { dialog, ipcMain } = require('electron');
const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const { readConfig, writeConfig } = require('./config');

// Phase 1 : vault local minimal — un dossier choisi par l'utilisateur·rice,
// des fichiers .mdx et des dossiers dedans, exposés comme une vraie
// arborescence (voir walkTree). Le chemin du vault est persisté dans
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

// Trouve un nom de fichier/dossier disponible dans `dir` en suffixant
// " 2", " 3"... si `candidate` existe déjà — mêmes règles pour les notes et
// les dossiers.
function findAvailableName(dir, candidate, extension = '') {
  let name = candidate;
  let counter = 2;
  while (fsSync.existsSync(path.join(dir, `${name}${extension}`))) {
    name = `${candidate} ${counter}`;
    counter += 1;
  }
  return `${name}${extension}`;
}

// Arborescence complète du vault : dossiers avec leurs enfants, notes en
// feuilles. Dossiers d'abord puis notes, triés alphabétiquement à chaque
// niveau — plus stable pour naviguer qu'un tri par date de modification.
async function walkTree(dir, vaultRoot) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const nodes = [];

  for (const entry of entries) {
    // Ignore les dossiers/fichiers cachés (.123ecriture/ config vault,
    // .git...).
    if (entry.name.startsWith('.')) continue;
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      const children = await walkTree(fullPath, vaultRoot);
      nodes.push({
        type: 'folder',
        relPath: path.relative(vaultRoot, fullPath),
        name: entry.name,
        children,
      });
    } else if (entry.isFile() && entry.name.endsWith('.mdx')) {
      const stat = await fs.stat(fullPath);
      nodes.push({
        type: 'note',
        relPath: path.relative(vaultRoot, fullPath),
        name: entry.name.replace(/\.mdx$/, ''),
        modifiedAt: stat.mtimeMs,
      });
    }
  }

  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
    return a.name.localeCompare(b.name, 'fr');
  });
  return nodes;
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

  ipcMain.handle('vault:list-tree', async () => {
    const vaultPath = getVaultPath();
    if (!vaultPath) return [];
    return walkTree(vaultPath, vaultPath);
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

  // `parentRelPath` optionnel : crée à la racine du vault si omis, sinon
  // dans le dossier visé (clic droit sur un dossier → "Nouvelle note ici").
  ipcMain.handle('vault:create-note', async (_event, name, parentRelPath) => {
    const vaultPath = getVaultPath();
    if (!vaultPath) throw new Error('Aucun vault sélectionné');
    const parentFull = parentRelPath ? resolveInVault(vaultPath, parentRelPath) : vaultPath;

    const safeName = name && name.trim().length > 0 ? name.trim() : 'Sans titre';
    const fileName = findAvailableName(parentFull, safeName, '.mdx');
    const fullPath = path.join(parentFull, fileName);
    const template = `---\ntitle: ${safeName}\ncreated: ${new Date().toISOString()}\n---\n\n`;
    await fs.writeFile(fullPath, template, 'utf8');
    const stat = await fs.stat(fullPath);

    return {
      relPath: path.relative(vaultPath, fullPath),
      name: fileName.replace(/\.mdx$/, ''),
      modifiedAt: stat.mtimeMs,
    };
  });

  ipcMain.handle('vault:create-folder', async (_event, name, parentRelPath) => {
    const vaultPath = getVaultPath();
    if (!vaultPath) throw new Error('Aucun vault sélectionné');
    const parentFull = parentRelPath ? resolveInVault(vaultPath, parentRelPath) : vaultPath;

    const safeName = name && name.trim().length > 0 ? name.trim() : 'Nouveau dossier';
    const folderName = findAvailableName(parentFull, safeName);
    const fullPath = path.join(parentFull, folderName);
    await fs.mkdir(fullPath);

    return { relPath: path.relative(vaultPath, fullPath), name: folderName };
  });

  // Renomme une note ou un dossier (détection automatique du type via
  // fs.stat) — reste dans le même dossier parent, pas de déplacement.
  ipcMain.handle('vault:rename', async (_event, relPath, newName) => {
    const vaultPath = getVaultPath();
    if (!vaultPath) throw new Error('Aucun vault sélectionné');

    const oldFull = resolveInVault(vaultPath, relPath);
    if (!fsSync.existsSync(oldFull)) throw new Error('Élément introuvable.');
    const isNote = fsSync.statSync(oldFull).isFile();

    // Un nom ne doit pas pouvoir contenir de séparateur de chemin : un
    // renommage reste un renommage, pas un déplacement déguisé.
    const trimmed = (newName ?? '').trim().replace(/[/\\]/g, '');
    if (!trimmed) throw new Error('Le nom ne peut pas être vide.');

    const baseName = isNote ? trimmed.replace(/\.mdx$/i, '') : trimmed;
    const finalName = isNote ? `${baseName}.mdx` : baseName;
    const parentDir = path.dirname(oldFull);
    const newFull = path.join(parentDir, finalName);

    if (newFull !== oldFull && fsSync.existsSync(newFull)) {
      throw new Error(`"${finalName}" existe déjà à cet endroit.`);
    }

    await fs.rename(oldFull, newFull);
    return { relPath: path.relative(vaultPath, newFull), name: baseName };
  });

  // Déplace une note ou un dossier vers un autre dossier du vault (ou la
  // racine si destinationParentRelPath est omis). Contrairement à
  // vault:rename, ça change le dossier parent — le nom reste le même sauf
  // collision à destination.
  ipcMain.handle('vault:move', async (_event, relPath, destinationParentRelPath) => {
    const vaultPath = getVaultPath();
    if (!vaultPath) throw new Error('Aucun vault sélectionné');

    const oldFull = resolveInVault(vaultPath, relPath);
    if (!fsSync.existsSync(oldFull)) throw new Error('Élément introuvable.');

    const destFull = destinationParentRelPath
      ? resolveInVault(vaultPath, destinationParentRelPath)
      : vaultPath;
    if (!fsSync.existsSync(destFull) || !fsSync.statSync(destFull).isDirectory()) {
      throw new Error('Destination invalide.');
    }

    // Un dossier ne peut pas être déplacé dans lui-même ni dans l'un de ses
    // propres sous-dossiers (casserait l'arborescence).
    if (destFull === oldFull || destFull.startsWith(oldFull + path.sep)) {
      throw new Error('Impossible de déplacer un dossier dans lui-même ou l’un de ses sous-dossiers.');
    }

    const isNote = fsSync.statSync(oldFull).isFile();
    const baseName = isNote ? path.basename(oldFull, '.mdx') : path.basename(oldFull);
    const extension = isNote ? '.mdx' : '';
    const finalName = findAvailableName(destFull, baseName, extension);
    const newFull = path.join(destFull, finalName);

    if (newFull === oldFull) {
      // Déjà à cet endroit — no-op plutôt qu'une erreur fs.rename inutile.
      return { relPath: path.relative(vaultPath, oldFull), name: baseName };
    }

    await fs.rename(oldFull, newFull);
    return { relPath: path.relative(vaultPath, newFull), name: finalName.replace(/\.mdx$/i, '') };
  });
}

module.exports = { registerVaultHandlers };
