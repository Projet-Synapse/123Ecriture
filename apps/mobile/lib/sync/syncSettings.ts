// ✒️ 123ECRITURE — lib/sync/syncSettings.ts — les VRAIS paramètres de synchronisation
//////////////////////////////////////////////////////////////////////////////
//
// Remplace l'ancienne notion de « coffres actifs » : l'utilisatrice choisit
// CE QUI se synchronise (global, par coffre, par type de fichier, dossiers
// vides, Wi-Fi uniquement). Le moteur (syncEngine.ts, cloudVaultCore.ts)
// consulte `isSyncAllowed` pour CHAQUE chemin : un type désactivé n'est ni
// envoyé, ni reçu, ni supprimé — il reste simplement local.
//
// Persistance : préférence de l'APPAREIL (localStorage / AsyncStorage via
// le petit KV injecté) — jamais dans le coffre (sinon un appareil
// imposerait ses filtres aux autres).
//
//////////////////////////////////////////////////////////////////////////////

import { isFolderMarker } from './folderMarker';

export type SyncFileCategory =
  | 'markdown'
  | 'images'
  | 'pdf'
  | 'audio'
  | 'video'
  | 'canvas'
  | 'other'
  | 'config';

export type SyncSettings = {
  enabled: boolean;
  // Coffre distant → activé ? (absent = activé)
  perVault: Record<string, boolean>;
  types: Record<SyncFileCategory, boolean>;
  emptyFolders: boolean;
  wifiOnly: boolean;
  // Choix fait à la LIAISON d'un dossier non vide (dialogue de fusion) :
  // priorité des conflits du PREMIER cycle (base vide). Effacé après.
  linkPreference: Record<string, 'merge' | 'local' | 'remote'>;
};

export const DEFAULT_SYNC_SETTINGS: SyncSettings = {
  enabled: true,
  perVault: {},
  types: {
    markdown: true,
    images: true,
    pdf: true,
    audio: true,
    video: true,
    canvas: true,
    other: true,
    config: true,
  },
  emptyFolders: true,
  wifiOnly: false,
  linkPreference: {},
};

export const SYNC_CATEGORY_LABELS: Record<SyncFileCategory, string> = {
  markdown: 'Notes Markdown (.md)',
  images: 'Images (PNG, JPG, GIF, WebP, SVG, HEIC)',
  pdf: 'PDF',
  audio: 'Audio (MP3, WAV, OGG, M4A)',
  video: 'Vidéo (MP4, WebM)',
  canvas: 'Canvas, Bases, Excalidraw, graphiques',
  other: 'Autres fichiers (texte, CSV, code…)',
  config: 'Configuration (.123ecriture)',
};

const EXT: Record<string, SyncFileCategory> = {
  '.md': 'markdown', '.mdx': 'markdown',
  '.png': 'images', '.jpg': 'images', '.jpeg': 'images', '.gif': 'images', '.webp': 'images', '.svg': 'images', '.heic': 'images',
  '.pdf': 'pdf',
  '.mp3': 'audio', '.wav': 'audio', '.ogg': 'audio', '.m4a': 'audio',
  '.mp4': 'video', '.webm': 'video',
  '.canvas': 'canvas', '.base': 'canvas', '.excalidraw': 'canvas', '.chart': 'canvas',
};

export function categorize(relPath: string): SyncFileCategory {
  if (relPath.startsWith('.123ecriture/') || relPath.startsWith('.obsidian/')) return 'config';
  const name = relPath.slice(relPath.lastIndexOf('/') + 1).toLowerCase();
  const dot = name.lastIndexOf('.');
  if (dot < 0) return 'other';
  return EXT[name.slice(dot)] ?? 'other';
}

export function isVaultSyncEnabled(settings: SyncSettings, remoteVaultId: string | null | undefined): boolean {
  if (!settings.enabled) return false;
  if (!remoteVaultId) return true;
  return settings.perVault[remoteVaultId] !== false;
}

// Filtre APPLIQUÉ PAR LE MOTEUR à chaque chemin (local comme distant).
export function isSyncAllowed(relPath: string, settings: SyncSettings): boolean {
  if (isFolderMarker(relPath)) return settings.emptyFolders;
  return settings.types[categorize(relPath)] !== false;
}

export function normalizeSyncSettings(raw: unknown): SyncSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<SyncSettings>;
  return {
    enabled: r.enabled !== false,
    perVault: { ...(r.perVault ?? {}) },
    types: { ...DEFAULT_SYNC_SETTINGS.types, ...(r.types ?? {}) },
    emptyFolders: r.emptyFolders !== false,
    wifiOnly: r.wifiOnly === true,
    linkPreference: { ...(r.linkPreference ?? {}) },
  };
}

//////// Persistance (préférence d'appareil) ///////////

const STORAGE_KEY = '123ecriture.sync-settings.v1';

type Kv = { getItem(k: string): string | null; setItem(k: string, v: string): void };

function kv(): Kv | null {
  try {
    const ls = (globalThis as { localStorage?: Kv }).localStorage;
    return ls ?? null;
  } catch {
    return null;
  }
}

let memory: SyncSettings = DEFAULT_SYNC_SETTINGS;
const listeners = new Set<(s: SyncSettings) => void>();

export function loadSyncSettings(): SyncSettings {
  const store = kv();
  if (!store) return memory;
  try {
    const raw = store.getItem(STORAGE_KEY);
    memory = raw ? normalizeSyncSettings(JSON.parse(raw)) : memory;
  } catch {
    // illisible : on garde la valeur en mémoire
  }
  return memory;
}

export function saveSyncSettings(next: SyncSettings): void {
  memory = normalizeSyncSettings(next);
  try {
    kv()?.setItem(STORAGE_KEY, JSON.stringify(memory));
  } catch {
    // best-effort
  }
  for (const l of listeners) l(memory);
}

export function subscribeSyncSettings(listener: (s: SyncSettings) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
