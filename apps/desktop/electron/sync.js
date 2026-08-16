const { ipcMain } = require('electron');
const fs = require('fs/promises');
const crypto = require('crypto');
const path = require('path');
const vaults = require('./vaults');

// Partie "synchro" (voir docs/ARCHITECTURE.md §6) : la seule opération qui a
// vraiment besoin du process principal est de hasher le vault actif en une
// seule fois — tout le reste (upload/download Storage, lignes vault_files,
// décisions de conflit) vit côté renderer avec la session Supabase, voir
// apps/mobile/lib/sync/syncEngine.ts. Un parcours + hash groupé ici évite de
// faire l'aller-retour IPC `readNote` fichier par fichier juste pour savoir
// ce qui a changé.
//
// Duplique volontairement une petite partie du parcours de vault.js
// (walkTree) plutôt que de le réutiliser tel quel : vault.js retourne une
// arborescence imbriquée (dossiers + notes, pour l'affichage), alors qu'ici
// on veut une liste PLATE de notes avec leur hash — forme différente pour un
// besoin différent, pas la peine de faire porter cette forme à walkTree.

async function hashFileContent(fullPath) {
  const content = await fs.readFile(fullPath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

async function walkAndHash(dir, vaultRoot, out) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkAndHash(fullPath, vaultRoot, out);
    } else if (entry.isFile() && entry.name.endsWith('.mdx')) {
      const stat = await fs.stat(fullPath);
      out.push({
        relPath: path.relative(vaultRoot, fullPath),
        contentHash: await hashFileContent(fullPath),
        sizeBytes: stat.size,
        modifiedAt: stat.mtimeMs,
      });
    }
  }
  return out;
}

function registerSyncHandlers() {
  ipcMain.handle('sync:hash-vault', async () => {
    const vaultPath = vaults.getActiveVaultPath();
    if (!vaultPath) return [];
    return walkAndHash(vaultPath, vaultPath, []);
  });
}

module.exports = { registerSyncHandlers };
