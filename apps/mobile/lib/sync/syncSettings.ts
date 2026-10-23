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
  // MISE À JOUR de l'app détectée (version installée ≠ dernière vue) :
  // AUCUNE synchro ni envoi tant que l'utilisatrice n'a pas explicitement
  // relié un coffre (dialogue de fusion) ou confirmé la reprise.
  lastSeenVersion: string | null;
  pausedAfterUpdate: boolean;
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
  lastSeenVersion: null,
  pausedAfterUpdate: false,
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
    lastSeenVersion: typeof r.lastSeenVersion === 'string' ? r.lastSeenVersion : null,
    pausedAfterUpdate: r.pausedAfterUpdate === true,
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
    const store = kv();
    if (store) store.setItem(STORAGE_KEY, JSON.stringify(memory));
    else void nativeFile()?.write(JSON.stringify(memory));
  } catch {
    // best-effort
  }
  for (const l of listeners) l(memory);
}

// Android/iOS (pas de localStorage) : fichier JSON dans le dossier privé de
// l'app (expo-file-system), relu au démarrage par hydrateSyncSettings().
function nativeFile(): { read(): Promise<string | null>; write(v: string): Promise<void> } | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const FS = require('expo-file-system/legacy') as {
      documentDirectory: string | null;
      readAsStringAsync(uri: string): Promise<string>;
      writeAsStringAsync(uri: string, v: string): Promise<void>;
    };
    if (!FS.documentDirectory) return null;
    const uri = `${FS.documentDirectory}sync-settings.json`;
    return {
      read: () => FS.readAsStringAsync(uri).catch(() => null),
      write: (v) => FS.writeAsStringAsync(uri, v),
    };
  } catch {
    return null;
  }
}

export async function hydrateSyncSettings(): Promise<SyncSettings> {
  if (kv()) return loadSyncSettings();
  const raw = await nativeFile()?.read();
  if (raw) {
    try {
      memory = normalizeSyncSettings(JSON.parse(raw));
    } catch {
      // illisible
    }
  }
  return memory;
}

// Détection de MISE À JOUR : à appeler au démarrage avec la version
// installée. Première exécution (aucune version vue) = pas une mise à jour.
export async function checkAppUpdate(installedVersion: string | null): Promise<SyncSettings> {
  const current = await hydrateSyncSettings();
  if (!installedVersion || current.lastSeenVersion === installedVersion) return current;
  const updated = current.lastSeenVersion !== null;
  const next: SyncSettings = {
    ...current,
    lastSeenVersion: installedVersion,
    pausedAfterUpdate: current.pausedAfterUpdate || updated,
  };
  saveSyncSettings(next);
  return next;
}

export function resumeSyncAfterUpdate(): void {
  saveSyncSettings({ ...loadSyncSettings(), pausedAfterUpdate: false });
}

export function subscribeSyncSettings(listener: (s: SyncSettings) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
