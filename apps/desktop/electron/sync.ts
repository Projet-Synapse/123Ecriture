import { ipcMain } from 'electron';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';

import * as vaults from './vaults';
import { EXTENSION_TO_KIND } from './vault';
import type { HashedNote } from './types';

// Partie "synchro" (voir docs/ARCHITECTURE.md §6) : la seule opération qui a
// vraiment besoin du process principal est de hasher le vault actif en une
// seule fois — tout le reste (upload/download Storage, lignes vault_files,
// décisions de conflit) vit côté renderer avec la session Supabase, voir
// apps/mobile/lib/sync/syncEngine.ts. Un parcours + hash groupé ici évite de
// faire l'aller-retour IPC `readNote` fichier par fichier juste pour savoir
// ce qui a changé.
//
// Duplique volontairement une petite partie du parcours de vault.ts
// (walkTree) plutôt que de le réutiliser tel quel : vault.ts retourne une
// arborescence imbriquée (dossiers + notes, pour l'affichage), alors qu'ici
// on veut une liste PLATE de notes avec leur hash — forme différente pour un
// besoin différent, pas la peine de faire porter cette forme à walkTree.
// En revanche EXTENSION_TO_KIND (quelles extensions comptent comme contenu
// de vault) EST importée de vault.ts, pas dupliquée : un filtre par
// extension local et divergent est exactement ce qui a fait qu'un fichier
// `.md`/`.canvas`/`.chart`/`.excalidraw` restait visible dans l'arborescence
// mais absent, silencieusement, de tout push/pull/conflit de synchro.

async function hashFileContent(fullPath: string): Promise<string> {
  const content = await fs.readFile(fullPath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

async function walkAndHash(dir: string, vaultRoot: string, out: HashedNote[]): Promise<HashedNote[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkAndHash(fullPath, vaultRoot, out);
    } else if (entry.isFile() && EXTENSION_TO_KIND[path.extname(entry.name)]) {
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

export function registerSyncHandlers(): void {
  ipcMain.handle('sync:hash-vault', async () => {
    const vaultPath = vaults.getActiveVaultPath();
    if (!vaultPath) return [];
    return walkAndHash(vaultPath, vaultPath, []);
  });
}
