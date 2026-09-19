import { ipcMain, type BrowserWindow } from 'electron';
import crypto from 'crypto';
import fs from 'fs/promises';
import fsSync from 'fs';
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
  // Contention anti-traversée : le point d'entrée vient d'IPC (chemin du
  // coffre transmis par le renderer). readdir récursif renvoie des chemins
  // construits par Node à partir de la racine résolue ; on borne en plus
  // explicitement chaque répertoire et chaque chemin au coffre : rien ne
  // peut en sortir, et aucun chemin n'est jamais reconstruit dynamiquement.
  // La racine elle-même n'a pas de séparateur final : comparer aux DEUX
  // formes, sinon TOUT fichier à la racine du coffre était exclu du hachage
  // — donc jamais poussé ni tiré (bug vécu : seuls les fichiers imbriqués
  // se synchronisaient depuis le début).
  const rootAbs = path.resolve(vaultRoot);
  const rootAbsSep = rootAbs + path.sep;
  const entries = await fs.readdir(path.resolve(dir), {
    recursive: true,
    withFileTypes: true,
  });
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const parentAbs = path.resolve(entry.parentPath);
    if (parentAbs !== rootAbs && !parentAbs.startsWith(rootAbsSep)) continue;
    const fullPath = parentAbs + path.sep + entry.name;
    if (entry.isFile() && EXTENSION_TO_KIND[path.extname(entry.name)]) {
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

// //2. 👁 SURVEILLANCE DU COFFRE ACTIF — synchro continue (v0.4.20)
// ////////////////////////////////////////////////////////////////////////
// « Une seule vérité : le coffre distant dans le compte » : chaque
// modification locale (fichier/dossier, n'importe quel appareil) pousse au
// compte en quelques secondes, et chaque appareil récupère les changements
// du compte automatiquement (cycle court côté renderer). Le watcher est
// PAUSABLE : le renderer le suspend pendant un cycle de synchro, sinon les
// écritures du pull redéclencheraient la synchro en boucle.
let activeWatcher: fsSync.FSWatcher | null = null;
let watcherPaused = false;
// Résolue À CHAQUE événement, pas à l'enregistrement : à l'appel de
// registerSyncHandlers la fenêtre peut ne pas exister encore — capturer
// l'instance trop tôt envoyait les événements vers null (vécu v0.4.20 :
// surveillance muette, seul le cycle 60 s fonctionnait).
let watcherGetWindow: (() => BrowserWindow | null) | null = null;

function stopActiveWatcher(): void {
  if (activeWatcher) {
    activeWatcher.close();
    activeWatcher = null;
  }
}

export function registerSyncHandlers(getWindow?: () => BrowserWindow | null): void {
  watcherGetWindow = getWindow ?? null;
  ipcMain.handle('sync:hash-vault', async () => {
    const vaultPath = vaults.getActiveVaultPath();
    if (!vaultPath) return [];
    // Anti-« résurrection » (v0.4.16) : si le dossier enregistré a disparu
    // (coffre déplacé/renommé) ou ne porte plus l'identité du coffre (déplacé
    // en laissant un dossier témoin vide), on REFUSE de hacher plutôt que de
    // renvoyer une liste vide — une liste vide ferait verser tout le coffre
    // distant dans l'ancien emplacement à la synchro suivante. Le message
    // oriente vers « Retrouver le dossier… » (Paramètres → Coffres locaux).
    if (!fsSync.existsSync(vaultPath)) {
      throw new Error(
        "Le dossier du coffre est introuvable à son emplacement enregistré (déplacé ou renommé ?) — retrouvez-le via Paramètres → Coffres locaux → « Retrouver le dossier… ».",
      );
    }
    if (!fsSync.existsSync(path.join(vaultPath, '.123ecriture', 'vault.json'))) {
      throw new Error(
        "Le dossier à l'emplacement enregistré ne contient plus l'identité du coffre (déplacé ?) — retrouvez le nouvel emplacement via Paramètres → Coffres locaux → « Retrouver le dossier… ».",
      );
    }
    return walkAndHash(vaultPath, vaultPath, []);
  });

  // Démarre/redémarre la surveillance sur le coffre ACTIF (à appeler au
  // montage et à chaque changement de coffre actif). Idempotent.
  ipcMain.handle('sync:watch-restart', () => {
    stopActiveWatcher();
    const vaultPath = vaults.getActiveVaultPath();
    if (!vaultPath || !fsSync.existsSync(vaultPath)) return false;
    activeWatcher = fsSync.watch(vaultPath, { recursive: true }, (_event, filename) => {
      if (watcherPaused || !filename) return;
      // Les métadonnées de l'app (.123ecriture, état/ordre/identité) et les
      // corbeilles ne comptent pas comme du contenu à propager.
      const parts = String(filename).split(path.sep);
      if (parts.some((p) => p.startsWith('.'))) return;
      watcherGetWindow?.()?.webContents?.send('sync:local-changed', String(filename));
    });
    return true;
  });

  ipcMain.handle('sync:watch-pause', () => {
    watcherPaused = true;
    return true;
  });

  ipcMain.handle('sync:watch-resume', () => {
    // Petite grâce après reprise : les événements encore en file issus de
    // NOS écritures arrivent dans la fenêtre de debounce naturelle du
    // renderer — sans elle, un pull massif redéclencherait un cycle.
    watcherPaused = false;
    return true;
  });
}
