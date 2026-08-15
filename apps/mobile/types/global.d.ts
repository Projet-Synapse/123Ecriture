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

  type VaultNoteNode = { type: 'note' } & VaultEntry;
  type VaultFolderNode = { type: 'folder'; relPath: string; name: string; children: VaultTreeNode[] };
  type VaultTreeNode = VaultNoteNode | VaultFolderNode;

  interface VaultBridge {
    chooseFolder: () => Promise<string | null>;
    getCurrentPath: () => Promise<string | null>;
    listTree: () => Promise<VaultTreeNode[]>;
    readNote: (relPath: string) => Promise<string>;
    writeNote: (relPath: string, content: string) => Promise<void>;
    createNote: (name: string, parentRelPath?: string) => Promise<VaultEntry>;
    createFolder: (name: string, parentRelPath?: string) => Promise<VaultFolderEntry>;
    rename: (relPath: string, newName: string) => Promise<{ relPath: string; name: string }>;
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

  interface Task {
    id: string;
    text: string;
    done: boolean;
    createdAt: string;
  }

  interface TasksBridge {
    list: () => Promise<Task[]>;
    add: (text: string) => Promise<Task[]>;
    toggle: (id: string) => Promise<Task[]>;
    remove: (id: string) => Promise<Task[]>;
  }

  interface Window {
    vault?: VaultBridge;
    updater?: UpdaterBridge;
    preferences?: PreferencesBridge;
    contextMenu?: ContextMenuBridge;
    tasks?: TasksBridge;
  }
}
