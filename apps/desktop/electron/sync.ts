import { ipcMain, type BrowserWindow } from 'electron';
import crypto from 'crypto';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';

import * as vaults from './vaults';
import type { HashedNote } from './types';
// v0.4.76 — SOURCE UNIQUE des règles de hachage (partagé avec le pont
// mobile nativeSyncAdapter.ts) : isHashableRelPath. Avant, les règles
// étaient dupliquées avec des divergences (fichiers code dans .trash
// hachés d'un côté seulement ; liste blanche des métadonnées côté desktop
// morte — le `continue` sur les noms cachés s'exécutait AVANT le test de
// liste blanche).
import { isHashableRelPath } from '../../mobile/lib/sync/syncRules';

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

// Cache de hachage entre deux cycles (perf, lenteur de frappe rapportée) :
// chaque sauvegarde débouncée déclenche un cycle de synchro ~2 s plus tard,
// qui relisait + hachait TOUT le coffre DANS le process principal — 1,4 s
// mesuré sur un coffre réel (224 fichiers, 169 Mo dont 3 notes de 32 Mo),
// pendant que l'utilisatrice continue de taper : le renderer attendait ses
// IPC derrière un main saturé, l'écriture devenait « extrêmement lente ».
// mtimeMs + size suffisent à identifier un fichier inchangé (même convention
// que les synchros grand public) : on ne relit désormais que ce qui a
// réellement changé depuis le cycle précédent — typiquement la note en
// cours d'édition. Cache jetable au changement de coffre actif (les chemins
// relatifs changent de sens) ; reconstruit à chaque cycle (les entrées des
// fichiers supprimés disparaissent d'elles-mêmes).
let hashCacheVaultPath: string | null = null;
const hashCache = new Map<string, { mtimeMs: number; size: number; hash: string }>();

// Les listes et la règle d'inclusion (métadonnées synchronisées, pièces
// jointes, .trash, segments cachés, backslash) vivent dans syncRules.ts —
// SOURCE UNIQUE partagée avec le pont mobile, avec des tests de parité.

function resetHashCache(vaultPath: string): void {
  if (hashCacheVaultPath !== vaultPath) {
    hashCache.clear();
    hashCacheVaultPath = vaultPath;
  }
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
  const nextCache = new Map<string, { mtimeMs: number; size: number; hash: string }>();
  for (const entry of entries) {
    const parentAbs = path.resolve(entry.parentPath);
    if (parentAbs !== rootAbs && !parentAbs.startsWith(rootAbsSep)) continue;
    const fullPath = parentAbs + path.sep + entry.name;
    const relSegments = path.relative(vaultRoot, fullPath).split(path.sep);
    // v0.4.76 — RÈGLE UNIQUE (syncRules.ts, partagée avec le pont mobile) :
    // liste blanche des métadonnées .123ecriture/**, .trash/ inclus,
    // segments cachés exclus, backslash rejetés, extensions de contenu et
    // pièces jointes. (Avant : le test des noms cachés s'exécutait AVANT la
    // liste blanche — les métadonnées synchronisées n'étaient jamais
    // hachées côté desktop, et les fichiers code de .trash jamais côté
    // mobile : deux vérités différentes pour un même coffre.)
    const relPathPosix = relSegments.join('/');
    if (!entry.isFile() || !isHashableRelPath(relPathPosix)) continue;
    // Pièces jointes : synchronisées SANS limite de taille (choix de
    // l'utilisatrice) — l'alerte « fichier volumineux » se produit au push
    // (syncEngine, seuil MAX_ATTACHMENT_ALERT_BYTES).
    {
      try {
        const stat = await fs.stat(fullPath);
        // v0.4.54 — normalisation POSIX OBLIGATOIRE : sur Windows,
        // path.relative produit des `\`, et un relPath backslashed créait
        // des DOUBLES entrées dans le cloud (jamais matchées par les lignes
        // à slashes) — cassant les tombestones : toute suppression locale
        // était annoncée mais jamais envoyée, et le fichier ressuscitait au
        // cycle suivant (vécu : 1577 doublons + résurrections en boucle).
        const relPath = path.relative(vaultRoot, fullPath).split(path.sep).join('/');
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
        // verra absent et posera sa tombestone. Rendre tout le hachage
        // invalide pour un fichier partiant rendait la synchro échouer en
        // rafale pendant les gros nettoyages (vécu).
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
  // Verrou anti-bascule (v0.4.54) : posé par le renderer au début de CHAQUE
  // cycle (et retiré à la fin) — pendant le cycle, vaults:switch est refusé.
  ipcMain.handle('sync:set-vault-lock', (_event, active: unknown) => {
    vaults.setSyncLock(Boolean(active));
    return vaults.isSyncLocked();
  });
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
      // corbeille est synchronisée (v0.4.26).
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
