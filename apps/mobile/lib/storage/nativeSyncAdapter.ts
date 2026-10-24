import * as FileSystem from 'expo-file-system/legacy';

import { getActiveVaultRootUri } from './nativeVaultsAdapter';
import { SYNC_ATTACHMENT_EXTENSIONS, takeDirtyPathsForRoot } from './nativeVaultAdapter';
import {
  activeVaultAdapter as nativeVaultAdapter,
  assertActiveVaultAccess,
  cloudSyncHandle,
  ensureActiveVaultIndexed as ensureVaultIndexed,
  getActiveVaultIndexEntry as getVaultIndexEntry,
  getActiveVaultIndexKeys as getVaultIndexKeys,
  hashActiveVaultFile,
  isActiveVaultFullyIndexed,
} from './vaultBackend';
import { sha256Hex, utf8Bytes } from '../sync/nativeSha256';
import { isHashableRelPath } from '../sync/syncRules';
import { visibleFolders } from '../sync/folderMarker';
import { setSyncProgress } from '../sync/syncProgress';
import { indexedModifiedAt } from '../sync/editQuiet';

// ✒️ 123ECRITURE — lib/storage/nativeSyncAdapter.ts — hachage de sync natif (Android)
//////////////////////////////////////////////////////////////////////////////
//
// Implémentation de SyncBridge (types/global.d.ts), pendant de
// `sync:hash-vault` côté Electron (apps/desktop/electron/sync.ts,
// walkAndHash) : le hachage du coffre actif est LA seule opération lourde
// du moteur de synchro (lib/sync/syncEngine.ts compare ces hashes aux
// métadonnées du coffre distant Supabase pour décider push/pull/conflit).
//
// Invariants du fichier :
//   • HACHAGE INCRÉMENTAL : SAF rend un parcours complet ruineux (~1
//     requête par entrée, l'UI gèle) — une BASELINE (relPath → hash/size)
//     est persistée HORS du coffre (documentDirectory, clé par URI racine)
//     et chaque cycle ne relit que les fichiers marqués modifiés (file
//     dirty de nativeVaultAdapter) ; première exécution seulement = passe
//     complète.
//   • MÊMES RÈGLES que walkAndHash desktop pour ce qui est HACHÉ —
//     fichiers cachés exclus SAUF `.trash` (corbeille volontairement
//     synchronisée), extensions de contenu, pièces jointes et métadonnées
//     synchronisées. Tout écart de règles entre plateformes produit des
//     conflits fantômes à chaque cycle.
//   • Le hash porte sur les OCTETS (UTF-8 du texte, octets décodés du
//     base64 pour les binaires) : identique au desktop, sinon le même
//     fichier paraît modifié selon l'appareil.
//   • LECTURE ÉCHOUÉE = NE RIEN SYNCHRONISER : un fichier présent dans
//     l'index mais illisible garde son hash précédent — aucune tombstone
//     ne part sur une erreur de lecture, le prochain cycle retente.
//   • modifiedAt n'est PAS fiable en SAF (→ Date.now()) : il ne départage
//     que la DIRECTION d'un conflit (local gagne les égalités), jamais
//     push/pull.
//
// SOMMAIRE :
//   1. Règles de hachage et baseline hors coffre
//   2. hashVaultTree — le hachage incrémental du coffre actif
//
//////////////////////////////////////////////////////////////////////////////

//////// 1. Règles de hachage et baseline hors coffre //////////////////////////////////

// Baseline hors coffre (documentDirectory), clé par URI racine : changer de
// coffre actif ou reconnecter un dossier invalide l'ancienne.
const BASELINE_PATH = `${FileSystem.documentDirectory}sync-hash-baseline.json`;
type BaselineEntries = Record<string, { hash: string; size: number }>;
type BaselineFile = { rootUri: string | null; entries: BaselineEntries };

async function loadBaseline(): Promise<BaselineFile> {
  try {
    const raw = await FileSystem.readAsStringAsync(BASELINE_PATH);
    const parsed = JSON.parse(raw) as BaselineFile;
    return { rootUri: parsed.rootUri ?? null, entries: parsed.entries ?? {} };
  } catch {
    return { rootUri: null, entries: {} }; // première exécution / corrompu
  }
}

async function saveBaseline(rootUri: string, entries: BaselineEntries): Promise<void> {
  const payload: BaselineFile = { rootUri, entries };
  try {
    await FileSystem.writeAsStringAsync(BASELINE_PATH, JSON.stringify(payload));
  } catch (error) {
    // La baseline est un cache : un échec d'écriture dégrade juste le
    // cycle suivant (passe complète), jamais la justesse du cycle courant.
    console.error('[sync] échec d’écriture de la baseline de hachage :', error);
  }
}

// Quels relPaths appartiennent à l'arbre synchronisé — mêmes règles que
// walkAndHash desktop (segments cachés exclus, .trash excepté), plus les
// MÉTADONNÉES SYNCHRONISÉES (SYNCED_META_FILES, importée de
// nativeVaultAdapter : apparence, tâches/listes, préférences).
function hashableRelPath(relPath: string): boolean {
  // RÈGLE UNIQUE (syncRules.isHashableRelPath) partagée avec le moteur : un
  // chemin distant que le hachage local ignorerait serait tiré en boucle.
  return isHashableRelPath(relPath);
}

// Décodage base64 → octets (pur JS : Hermes n'a pas `atob` garanti) —
// utilisé par le hachage des pièces jointes binaires.
function base64ToBytes(base64: string): Uint8Array {
  const table = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean = base64.replace(/[^A-Za-z0-9+/=]/g, '');
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  const bytes = new Uint8Array(Math.floor(clean.length / 4) * 3);
  let out = 0;
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < clean.length; i += 1) {
    const value = table.indexOf(clean[i]);
    if (value === -1) continue;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      if (out < bytes.length) bytes[out] = (buffer >> bits) & 0xff;
      out += 1;
    }
  }
  return bytes.subarray(0, Math.floor(clean.length / 4) * 3 - padding);
}

//////// 2. hashVaultTree — le hachage incrémental du coffre actif //////////////////////

export const nativeSyncAdapter = {
  // DOSSIERS (folderMarker.ts) : sans cette liste, le moteur croyait
  // qu'AUCUN dossier n'existait sur Android — un dossier reçu au cycle N
  // était donc tombstoné au cycle N+1 (« supprimé ici »). Source : l'index
  // du coffre (vault-fs ou SAF), dossiers visibles uniquement.
  listFolders: async (): Promise<string[]> => {
    const rootUri = await getActiveVaultRootUri();
    if (!rootUri) return [];
    await assertActiveVaultAccess();
    await ensureVaultIndexed();
    return visibleFolders(getVaultIndexKeys(), (p) => getVaultIndexEntry(p));
  },
  isFullyIndexed: () => isActiveVaultFullyIndexed(),
  hashVaultTree: async (): Promise<HashedNote[]> => {
    // Android cloud : l'« arbre local » est le CACHE privé (inventaire).
    if (cloudSyncHandle) return cloudSyncHandle.inventory();
    const rootUri = await getActiveVaultRootUri();
    if (!rootUri) return []; // pas de coffre actif : rien à hacher
    // Permission perdue : on REFUSE le cycle (jamais « coffre vide » ⇒ aucune suppression).
    await assertActiveVaultAccess();
    await ensureVaultIndexed();

    const baseline = await loadBaseline();
    const entries: BaselineEntries = baseline.rootUri === rootUri ? { ...baseline.entries } : {};
    const dirty = await takeDirtyPathsForRoot(rootUri);

    // Première exécution pour ce coffre (baseline vide) : passe complète
    // sur tout l'index. Sinon : uniquement les fichiers marqués modifiés.
    const targets = new Set(dirty);
    // Rattrapage à CHAQUE cycle (pas seulement au premier) : tout fichier
    // présent dans l'index mais absent de la baseline est haché, et toute
    // entrée de baseline que l'index ne connaît plus est re-vérifiée. Sans
    // ça, un fichier jamais marqué « dirty » (reçu, indexé par un parcours)
    // restait invisible au moteur : pull → « répond localement » → différé,
    // en boucle à chaque cycle.
    const indexKeys = getVaultIndexKeys();
    for (const relPath of indexKeys) {
      if (hashableRelPath(relPath) && !entries[relPath]) targets.add(relPath);
    }
    const indexSet = new Set(indexKeys);
    for (const relPath of Object.keys(entries)) {
      if (!indexSet.has(relPath)) targets.add(relPath);
    }

    // PROGRESSION + SAUVEGARDE AU FIL DE L'EAU : un rattrapage de centaines
    // de fichiers n'est plus muet (watchdog d'inactivité) et ce qui est haché
    // reste acquis si le cycle est interrompu (délai, app tuée).
    const total = targets.size;
    let done = 0;
    let lastSave = Date.now();
    for (const relPath of targets) {
      done += 1;
      if (total > 20 && (done % 10 === 0 || done === total)) {
        setSyncProgress({ phase: 'Analyse du coffre local…', done, total, current: relPath });
      }
      if (Date.now() - lastSave > 5_000) {
        await saveBaseline(rootUri, entries);
        lastSave = Date.now();
      }
      const entry = getVaultIndexEntry(relPath);
      if (!entry || entry.isDirectory) {
        delete entries[relPath]; // supprimé/déplacé depuis le dernier cycle
        continue;
      }
      if (!hashableRelPath(relPath)) {
        delete entries[relPath];
        continue;
      }
      try {
        if (hashActiveVaultFile) {
          const hashed = await hashActiveVaultFile(relPath);
          entries[relPath] = { hash: hashed.hash, size: hashed.size };
          continue;
        }
        let bytes: number[] | Uint8Array;
        if (SYNC_ATTACHMENT_EXTENSIONS.some((ext) => relPath.toLowerCase().endsWith(ext))) {
          // Binaire (image/PDF/audio…) : hachage sur les OCTETS décodés du
          // base64 — le fichier lu « en texte » donnerait un hash différent
          // du hachage desktop (octets bruts) et des faux conflits.
          // Via le pont actif (module natif VaultFs ou ancien SAF) — jamais
          // une URI lue directement ici.
          if (!nativeVaultAdapter.readNoteBinary) throw new Error('lecture binaire indisponible');
          const base64 = await nativeVaultAdapter.readNoteBinary(relPath);
          bytes = base64ToBytes(base64);
        } else {
          const content = await nativeVaultAdapter.readNote(relPath);
          bytes = utf8Bytes(content);
        }
        entries[relPath] = { hash: sha256Hex(bytes), size: bytes.length };
      } catch {
        // « LECTURE ÉCHOUÉE = NE RIEN SYNCHRONISER » : un fichier qui EXISTE
        // dans l'index mais qu'on n'a pas su LIRE garde son hash précédent —
        // le diff le voit inchangé, aucune tombstone ne part, et le prochain
        // cycle retente. On ne retire du hachage que les fichiers que
        // l'INDEX déclare disparus (suppression réelle).
        if (!entries[relPath]) delete entries[relPath];
      }
    }

    await saveBaseline(rootUri, entries);
    return Object.entries(entries).map(([relPath, value]) => ({
      relPath,
      contentHash: value.hash,
      sizeBytes: value.size,
      modifiedAt: indexedModifiedAt(getVaultIndexEntry(relPath)),
    }));
  },
};

