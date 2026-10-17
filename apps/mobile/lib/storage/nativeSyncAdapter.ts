//////////
// ✒️ 123ECRITURE — nativeSyncAdapter.ts
// PONT SYNC NATIF (ANDROID) : hachage VÉRIDIQUE du coffre (refonte v0.4.76)
//////////

// INTRODUCTION — Implémentation de SyncBridge (types/global.d.ts), pendant
// de `sync:hash-vault` côté Electron (apps/desktop/electron/sync.ts,
// walkAndHash) : le moteur de synchro (lib/sync/syncEngine.ts) compare ces
// hashes aux métadonnées du coffre distant Supabase pour décider
// push/pull/conflit.
//
// POURQUOI « VÉRIDIQUE » : l'ancien pont (SAF) s'appuyait sur un index
// persisté et une baseline qui pouvaient décrire des fichiers fantômes —
// le diff concluait « rien à faire » sur un dossier vide (vécu 17/10). Le
// socle en fichiers ordinaires permet de relire le disque à chaque cycle,
// comme le desktop : la vérité vient TOUJOURS du disque.
//
// RÈGLES DE HACHAGE (mêmes que walkAndHash desktop — À MAINTENIR ENSEMBLE) :
//   - segments cachés exclus (`.123ecriture`, `.obsidian`…) — SAUF la liste
//     blanche SYNCED_META_FILES (tâches/préférences synchronisées) ;
//   - `.trash/` INCLUS (corbeille du coffre, synchronisée v0.4.26) ;
//   - noms contenant un `\` jamais hachés (résidus de contamination) ;
//   - extensions de contenu (.mdx/.md/.canvas/.chart/.excalidraw/.base) et
//     pièces jointes (SYNC_ATTACHMENT_EXTENSIONS) ;
//   - le hash porte sur les OCTETS UTF-8 du texte (identique desktop).
//
// Coût : lecture intégrale du coffre à chaque cycle — c'est le prix de la
// véridicité ; à mesurer sur le coffre réel et optimiser (cache par
// mtime+taille validée par stat) UNIQUEMENT si le besoin s'en fait sentir.
//
// SOMMAIRE :
//   1. 📏 Règles de hachage (hashableRelPath)
//   2. 🔢 Décodage base64 (pièces jointes)
//   3. 🔌 hashVaultTree (l'opération exposée au moteur)

import * as FileSystem from 'expo-file-system/legacy';

import { getActiveVaultRootUri } from './nativeVaultsAdapter';
import { nativeVaultAdapter, SYNCED_META_FILES, SYNC_ATTACHMENT_EXTENSIONS } from './nativeVaultAdapter';
import { sha256Hex, utf8Bytes } from '../sync/nativeSha256';

//////// 1. 📏 RÈGLES DE HACHAGE (hashableRelPath) ///////////

const SYNC_EXTENSIONS = ['.mdx', '.md', '.canvas', '.chart', '.excalidraw', '.base'];

function hashableRelPath(relPath: string): boolean {
  if (SYNCED_META_FILES.includes(relPath)) return true;
  // ANTI-CONTAMINATION (v0.4.67) : un nom contenant un `\` est un fichier
  // plat issu d'anciens pulls du mélange — jamais haché, jamais poussé.
  if (relPath.includes('\\')) return false;
  const segments = relPath.split('/');
  const hidden = segments.some((segment) => segment.startsWith('.'));
  const inTrash = segments[0] === '.trash';
  if (hidden && !inTrash) return false;
  const name = segments[segments.length - 1].toLowerCase();
  if (SYNC_ATTACHMENT_EXTENSIONS.some((ext) => name.endsWith(ext))) return true;
  return SYNC_EXTENSIONS.some((ext) => name.endsWith(ext));
}

//////// 2. 🔢 DÉCODAGE BASE64 (pièces jointes) ///////////

function base64ToBytes(base64: string): number[] {
  const table = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean = base64.replace(/[^A-Za-z0-9+/=]/g, '');
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  const totalLength = Math.floor(clean.length / 4) * 3 - padding;
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < clean.length; i += 1) {
    const value = table.indexOf(clean[i]);
    if (value === -1) continue;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      if (bytes.length < totalLength) bytes.push((buffer >> bits) & 0xff);
    }
  }
  return bytes;
}

//////// 3. 🔌 HASHVAULTTREE (l'opération exposée au moteur) ///////////

function fileUri(plainPath: string): string {
  return plainPath.startsWith('file://') ? plainPath : `file://${plainPath}`;
}

// Parcours récursif du coffre — collecte les relPaths hachables.
async function collectHashable(root: string, dir: string, relPrefix: string, out: string[], depth = 0): Promise<void> {
  if (depth > 40) return;
  const dirUri = fileUri(dir);
  const names = await FileSystem.readDirectoryAsync(dirUri).catch(() => [] as string[]);
  for (const raw of names) {
    const name = raw.includes('/') ? decodeURIComponent(raw.slice(raw.lastIndexOf('/') + 1)) : raw;
    const relPath = relPrefix ? `${relPrefix}/${name}` : name;
    const childPath = `${dir}/${name}`;
    const info = await FileSystem.getInfoAsync(fileUri(childPath)).catch(() => null);
    if (!info || !info.exists) continue;
    if (info.isDirectory) {
      await collectHashable(root, childPath, relPath, out, depth + 1);
      continue;
    }
    if (hashableRelPath(relPath)) out.push(relPath);
  }
}

export const nativeSyncAdapter = {
  hashVaultTree: async (): Promise<HashedNote[]> => {
    const root = await getActiveVaultRootUri();
    if (!root) return []; // pas de coffre actif : rien à hacher
    const relPaths: string[] = [];
    await collectHashable(root, root, '', relPaths);

    const out: HashedNote[] = [];
    for (const relPath of relPaths) {
      try {
        const target = fileUri(`${root}/${relPath}`);
        let bytes: number[];
        if (SYNC_ATTACHMENT_EXTENSIONS.some((ext) => relPath.toLowerCase().endsWith(ext))) {
          // Binaire (image/PDF/audio…) : hachage sur les OCTETS décodés du
          // base64 — le fichier lu « en texte » donnerait un hash différent
          // du hachage desktop (octets bruts) et des faux conflits.
          const base64 = await FileSystem.readAsStringAsync(target, {
            encoding: FileSystem.EncodingType.Base64,
          });
          bytes = base64ToBytes(base64);
        } else {
          bytes = utf8Bytes(await nativeVaultAdapter.readNote(relPath));
        }
        const info = await FileSystem.getInfoAsync(target).catch(() => null);
        const modifiedAt = info && info.exists && info.modificationTime ? info.modificationTime * 1000 : Date.now();
        out.push({ relPath, contentHash: sha256Hex(bytes), sizeBytes: bytes.length, modifiedAt });
      } catch {
        // v0.4.72 — « LECTURE ÉCHOUÉE = NE RIEN SYNCHRONISER » (garde repris
        // de 123Promptez) : un fichier qu'on n'a pas su lire est simplement
        // ABSENT du résultat — le diff le verra inchangé, aucune tombstone
        // ne partira, et le prochain cycle retentera.
      }
    }
    return out;
  },
};
