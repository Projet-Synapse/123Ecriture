// Types des ponts exposés par apps/desktop/electron/preload.js via
// contextBridge. N'existent que côté Electron desktop (window.vault,
// window.updater, window.preferences, window.contextMenu sont undefined
// sur web/mobile — Phase 2 pour ces plateformes).
export {};

declare global {
  interface VaultEntry {
    relPath: string;
    name: string;
    modifiedAt: number;
  }

  interface VaultFolderEntry {
    relPath: string;
    name: string;
  }

  interface VaultBridge {
    chooseFolder: () => Promise<string | null>;
    getCurrentPath: () => Promise<string | null>;
    listNotes: () => Promise<VaultEntry[]>;
    readNote: (relPath: string) => Promise<string>;
    writeNote: (relPath: string, content: string) => Promise<void>;
    createNote: (name: string) => Promise<VaultEntry>;
    createFolder: (name: string) => Promise<VaultFolderEntry>;
  }

  type UpdaterStatus =
    | { state: 'idle' }
    | { state: 'checking' }
    | { state: 'up-to-date' }
    | { state: 'downloading'; version?: string; percent: number }
    | { state: 'ready'; version: string }
    | { state: 'error'; message: string };

  interface UpdaterBridge {
    getVersion: () => Promise<string>;
    getStatus: () => Promise<UpdaterStatus>;
    check: () => Promise<void>;
    quitAndInstall: () => Promise<void>;
    onStatusChange: (callback: (status: UpdaterStatus) => void) => () => void;
  }

  type ThemeMode = 'system' | 'light' | 'dark';

  interface ToolbarItemConfig {
    id: string;
    visible: boolean;
  }

  interface Preferences {
    themeMode: ThemeMode;
    accentColor: string;
    notesToolbarOrder: ToolbarItemConfig[];
  }

  interface PreferencesBridge {
    get: () => Promise<Preferences>;
    set: (partial: Partial<Preferences>) => Promise<Preferences>;
  }

  interface ContextMenuItem {
    id: string;
    label: string;
  }

  interface ContextMenuBridge {
    show: (items: ContextMenuItem[]) => Promise<string | null>;
  }

  interface Window {
    vault?: VaultBridge;
    updater?: UpdaterBridge;
    preferences?: PreferencesBridge;
    contextMenu?: ContextMenuBridge;
  }
}
