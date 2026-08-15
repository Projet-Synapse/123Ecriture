// Types du pont vault exposé par apps/desktop/electron/preload.js via
// contextBridge. N'existe que côté Electron desktop (window.vault est
// undefined sur web/mobile — pas encore de vault sur ces plateformes, voir
// docs/ARCHITECTURE.md, Phase 2).
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

  interface Window {
    vault?: VaultBridge;
  }
}
