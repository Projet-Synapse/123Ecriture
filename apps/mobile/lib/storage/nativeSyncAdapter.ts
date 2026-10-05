import * as FileSystem from 'expo-file-system/legacy';

import { getActiveVaultRootUri } from './nativeVaultsAdapter';
import {
  ensureVaultIndexed,
  getVaultIndexEntry,
  getVaultIndexKeys,
  nativeVaultAdapter,
  takeDirtyPathsForRoot,
} from './nativeVaultAdapter';
import { sha256Hex, utf8Bytes } from '../sync/nativeSha256';

// Pont sync natif (Android) — implémentation de SyncBridge (types/
// global.d.ts), pendant de `sync:hash-vault` côté Electron
// (apps/desktop/electron/sync.ts, walkAndHash) : le hachage du coffre actif
// est LA seule opération lourde du moteur de synchro (lib/sync/syncEngine.ts
// compare ces hashes aux métadonnées du coffre distant Supabase pour
// décider push/pull/conflit).
//
// ⚠️ HACHAGE INCRÉMENTAL — SAF rend un parcours complet ruineux (~1 requête
// par entrée : ~340 notes = plus d'une minute, l'UI gèle ; vécu en
// 0.4.41-fix6 : « la synchro charge indéfiniment »). Une BASELINE
// (relPath -> hash/size) est persistée hors du coffre ; chaque cycle ne
// relit que les fichiers marqués modifiés (file dirty de
// nativeVaultAdapter), les autres resservent leur hash. Première exécution
// seulement : passe complète (une fois par coffre).
//
// MÊMES RÈGLES que walkAndHash desktop pour ce qui est HACHÉ :
// - fichiers cachés exclus — métadonnées .123ecriture, .obsidian… — SAUF
//   `.trash`, la corbeille du coffre, volontairement synchronisée (v0.4.26) ;
// - seules les extensions de contenu comptent : .mdx/.md/.canvas/.chart/
//   .excalidraw/.base (EXTENSION_TO_KIND desktop, vault.ts) — .base est
//   indexé par l'arborescence même si elle ne l'affiche pas.
// Le hash porte sur les OCTETS UTF-8 du texte lu (voir nativeSha256.ts) :
// identique au desktop (createHash sur les octets) pour du texte UTF-8.
// modifiedAt n'est PAS fiable en SAF → Date.now() : il ne départage que la
// DIRECTION d'un conflit (local gagne les égalités), jamais push/pull.
const SYNC_EXTENSIONS = ['.mdx', '.md', '.canvas', '.chart', '.excalidraw', '.base'];

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
// walkAndHash desktop (segments cachés exclus, .trash excepté), plus
// l'APPARENCE PAR COFFRE : .123ecriture/appearance.json voyage avec le
// coffre pour que le thème réglé sur un appareil se retrouve sur tous
// (demande 2026-10-02).
function hashableRelPath(relPath: string): boolean {
  if (relPath === '.123ecriture/appearance.json') return true;
  const segments = relPath.split('/');
  if (segments[0] !== '.trash' && segments.some((segment) => segment.startsWith('.'))) return false;
  const name = segments[segments.length - 1].toLowerCase();
  return SYNC_EXTENSIONS.some((ext) => name.endsWith(ext));
}

export const nativeSyncAdapter = {
  hashVaultTree: async (): Promise<HashedNote[]> => {
    const rootUri = await getActiveVaultRootUri();
    if (!rootUri) return []; // pas de coffre actif : rien à hacher
    await ensureVaultIndexed();

    const baseline = await loadBaseline();
    const entries: BaselineEntries = baseline.rootUri === rootUri ? { ...baseline.entries } : {};
    const dirty = await takeDirtyPathsForRoot(rootUri);

    // Première exécution pour ce coffre (baseline vide) : passe complète
    // sur tout l'index. Sinon : uniquement les fichiers marqués modifiés.
    const targets = new Set(dirty);
    if (Object.keys(entries).length === 0) {
      for (const relPath of getVaultIndexKeys()) {
        if (hashableRelPath(relPath)) targets.add(relPath);
      }
    }

    for (const relPath of targets) {
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
        const content = await nativeVaultAdapter.readNote(relPath);
        const bytes = utf8Bytes(content);
        entries[relPath] = { hash: sha256Hex(bytes), size: bytes.length };
      } catch {
        delete entries[relPath]; // fichier illisible entre-temps : hors arbre
      }
    }

    await saveBaseline(rootUri, entries);
    return Object.entries(entries).map(([relPath, value]) => ({
      relPath,
      contentHash: value.hash,
      sizeBytes: value.size,
      modifiedAt: Date.now(),
    }));
  },
};
