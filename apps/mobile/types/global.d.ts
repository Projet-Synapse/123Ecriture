// Types des ponts exposés par apps/desktop/electron/preload.js via
// contextBridge. N'existent que côté Electron desktop (window.vault et
// window.updater sont undefined sur web/mobile — pas encore de vault ni
// d'auto-update sur ces plateformes, voir docs/ARCHITECTURE.md, Phase 2).
export {};

declare global {
  interface VaultEntry {
    relPath: string;
    name: string;
    modifiedAt: number;
  }

  interface VaultBridge {
    chooseFolder: () => Promise<string | null>;
    getCurrentPath: () => Promise<string | null>;
    listNotes: () => Promise<VaultEntry[]>;
    readNote: (relPath: string) => Promise<string>;
    writeNote: (relPath: string, content: string) => Promise<void>;
    createNote: (name: string) => Promise<VaultEntry>;
  }

  type UpdaterStatus =
    | { state: 'checking' }
    | { state: 'up-to-date' }
    | { state: 'downloading'; version?: string; percent: number }
    | { state: 'ready'; version: string }
    | { state: 'error'; message: string };

  interface UpdaterBridge {
    getVersion: () => Promise<string>;
    check: () => Promise<void>;
    quitAndInstall: () => Promise<void>;
    onStatusChange: (callback: (status: UpdaterStatus) => void) => () => void;
  }

  interface Window {
    vault?: VaultBridge;
    updater?: UpdaterBridge;
  }
}
