//////////////////////////////////////////////////////////////////////////////
//                                 sync.ts                                  //  
//////////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////////
//
// Partie PROCESS MAIN de la synchronisation. La seule opération qui a
// vraiment besoin du process principal est de hasher le coffre actif en
// une seule fois — tout le reste (upload/download Storage, lignes
// vault_files, décisions de conflit) vit côté renderer avec la session
// Supabase, voir apps/mobile/lib/sync/syncEngine.ts. Un parcours + hash
// groupé ici évite l'aller-retour IPC readNote fichier par fichier juste
// pour savoir ce qui a changé.
//
// Invariants du fichier :
//   • La règle « qu'est-ce qui se synchronise » vit en SOURCE UNIQUE dans
//     apps/mobile/lib/sync/syncRules.ts (isHashableRelPath), partagée avec
//     le pont mobile et testée de parité — jamais de liste locale ici.
//   • Le hachage est borné au coffre actif (aucun chemin ne peut sortir du
//     dossier résolu) et ne relit que ce qui a changé (cache mtime + size).
//   • La surveillance du système de fichiers est PAUSABLE : le renderer la
//     suspend pendant un cycle, sinon les écritures du pull redéclenchent
//     la synchro en boucle.
//
// SOMMAIRE :
//   1. Le hachage du coffre (cache, parcours, handler sync:hash-vault)
//   2. La surveillance du coffre (watcher pausable + handlers watch-*)
//
//////////////////////////////////////////////////////////////////////////////

import { ipcMain, type BrowserWindow } from 'electron';
import crypto from 'crypto';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';

import * as vaults from './vaults';
import type { HashedNote } from '../types';
import { isHashableRelPath } from '../../../mobile/lib/sync/syncRules';
import { normalizeRelPath } from '../../../mobile/lib/sync/relPath';

// Ce module duplique volontairement une petite partie du parcours de
// vault.ts (walkTree) : vault.ts retourne une arborescence imbriquée
// (dossiers + notes, pour l'affichage), ici on veut une liste PLATE de
// notes avec leur hash — deux formes pour deux besoins. En revanche
// EXTENSION_TO_KIND (quelles extensions comptent comme contenu du coffre)
// reste importé de vault.ts : un filtre par extension local et divergent
// rendrait un fichier visible dans l'arborescence mais absent, en
// silence, de tout push/pull/conflit.

//////// 1. Le hachage du coffre ///////////////////////////////////////////

async function hashFileContent(fullPath: string): Promise<string> {
  const content = await fs.readFile(fullPath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

// Cache de hachage entre deux cycles : chaque sauvegarde débouncée
// déclenche un cycle ~2 s plus tard ; relire + hacher TOUT le coffre dans
// le process principal pendant que l'utilisatrice tape sature le main et
// rend l'écriture lente. mtimeMs + size suffisent à identifier un fichier
// inchangé (convention des synchros grand public) : on ne relit que ce qui
// a réellement changé depuis le cycle précédent. Jetable au changement de
// coffre actif (les chemins relatifs changent de sens) ; remplacé à chaque
// cycle (les entrées des fichiers supprimés disparaissent d'elles-mêmes).
let hashCacheVaultPath: string | null = null;
const hashCache = new Map<string, { mtimeMs: number; size: number; hash: string }>();

// Les listes et la règle d'inclusion (métadonnées synchronisées, pièces
// jointes, .trash, segments cachés, backslash) vivent dans syncRules.ts —
// source unique partagée avec le pont mobile, avec des tests de parité.

function resetHashCache(vaultPath: string): void {
  if (hashCacheVaultPath !== vaultPath) {
    hashCache.clear();
    hashCacheVaultPath = vaultPath;
  }
}

async function walkAndHash(dir: string, vaultRoot: string, out: HashedNote[]): Promise<HashedNote[]> {
  // Le point d'entrée vient d'IPC (chemin du coffre transmis par le
  // renderer) : chaque répertoire et chaque chemin est borné au coffre
  // résolu — rien ne peut en sortir et aucun chemin n'est reconstruit
  // dynamiquement. La racine n'a pas de séparateur final : comparer aux
  // DEUX formes, sinon tout fichier à la racine du coffre est exclu du
  // hachage (donc jamais poussé ni tiré).
  const rootAbs = path.resolve(vaultRoot);
  const rootAbsSep = rootAbs + path.sep;
  const entries = await fs.readdir(path.resolve(dir), {
    recursive: true,
    withFileTypes: true,
  });
  const nextCache = new Map<string, { mtimeMs: number; size: number; hash: string }>();
  for (const entry of entries) {
    const parentAbs = path.resolve(entry.parentPath);
    if (parentAbs !== rootAbs && !parentAbs.startsWith(rootAbsSep)) continue;
    const fullPath = parentAbs + path.sep + entry.name;
    const relSegments = path.relative(vaultRoot, fullPath).split(path.sep);
    // Règle unique d'inclusion (syncRules.ts) : liste blanche des
    // métadonnées .123ecriture/**, .trash/ inclus, segments cachés
    // exclus, backslash rejetés, extensions de contenu et pièces jointes.
    const relPathPosix = relSegments.join('/');
    if (!entry.isFile() || !isHashableRelPath(relPathPosix)) continue;
    // Pièces jointes synchronisées SANS limite de taille (choix de
    // l'utilisatrice) — l'alerte « fichier volumineux » se produit au push
    // (syncEngine, seuil MAX_ATTACHMENT_ALERT_BYTES).
    {
      try {
        const stat = await fs.stat(fullPath);
        // Le relPath est normalisé POSIX à la source : sur Windows,
        // path.relative produit des `\` et un relPath backslashed crée des
        // doubles entrées dans le cloud jamais matchées par les lignes à
        // slashes — les tombestones ne partent plus et le fichier
        // ressuscite au cycle suivant.
        const relPath = normalizeRelPath(path.relative(vaultRoot, fullPath));
        const cached = hashCache.get(relPath);
        if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
          nextCache.set(relPath, cached);
          out.push({
            relPath,
            contentHash: cached.hash,
            sizeBytes: stat.size,
            modifiedAt: stat.mtimeMs,
          });
          continue;
        }
        const contentHash = await hashFileContent(fullPath);
        nextCache.set(relPath, { mtimeMs: stat.mtimeMs, size: stat.size, hash: contentHash });
        out.push({
          relPath,
          contentHash,
          sizeBytes: stat.size,
          modifiedAt: stat.mtimeMs,
        });
      } catch (error) {
        // Fichier évaporé entre le listage et la lecture (suppression en
        // cours, vagues de nettoyage) : on l'ignore — le cycle suivant le
        // verra absent et posera sa tombestone. Invalider tout le hachage
        // pour un fichier partant fait échouer la synchro en rafale.
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
  }
  // Remplace (ne fusionne pas) : un fichier absent de CE parcours est
  // supprimé — garder son entrée ne servirait à rien et gonflerait le cache.
  hashCache.clear();
  for (const [key, value] of nextCache) hashCache.set(key, value);
  return out;
}

//////// 2. La surveillance du coffre /////////////////////////////////////

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
// l'instance trop tôt envoie les événements vers null (surveillance
// muette, seul le cycle de démarrage fonctionne).
let watcherGetWindow: (() => BrowserWindow | null) | null = null;

function stopActiveWatcher(): void {
  if (activeWatcher) {
    activeWatcher.close();
    activeWatcher = null;
  }
}

export function registerSyncHandlers(getWindow?: () => BrowserWindow | null): void {
  watcherGetWindow = getWindow ?? null;
  // Verrou anti-bascule : posé par le renderer au début de CHAQUE cycle
  // (retiré à la fin) — pendant le cycle, vaults:switch est refusé.
  ipcMain.handle('sync:set-vault-lock', (_event, active: unknown) => {
    vaults.setSyncLock(Boolean(active));
    return vaults.isSyncLocked();
  });
  ipcMain.handle('sync:hash-vault', async () => {
    const vaultPath = vaults.getActiveVaultPath();
    if (!vaultPath) return [];
    // Anti-résurrection : si le dossier enregistré a disparu (coffre
    // déplacé/renommé) ou ne porte plus l'identité du coffre, on REFUSE de
    // hacher plutôt que de renvoyer une liste vide — une liste vide ferait
    // verser tout le coffre distant dans l'ancien emplacement à la synchro
    // suivante. Le message oriente vers « Retrouver le dossier… ».
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
    resetHashCache(vaultPath);
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
      // Les métadonnées de l'app (.123ecriture, état/ordre/identité) ne
      // comptent pas comme du contenu à propager — mais `.trash` oui : la
      // corbeille est synchronisée.
      const parts = String(filename).split(path.sep);
      if (parts[0] !== '.trash' && parts.some((p) => p.startsWith('.'))) return;
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
