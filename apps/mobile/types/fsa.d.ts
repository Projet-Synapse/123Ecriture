// File System Access API — les sélecteurs de fichiers/dossiers ne sont pas
// déclarés dans lib.dom.d.ts de TypeScript (les handles
// FileSystemDirectoryHandle/FileSystemFileHandle, eux, le sont). Chromium
// seul les expose (Chrome/Edge/Chromium récents) — installWebBridges.ts
// teste leur présence avant de poser les ponts web, Firefox/Safari gardant
// le comportement dégradé existant.
interface Window {
  showDirectoryPicker?(options?: {
    mode?: 'read' | 'readwrite';
    id?: string;
    startIn?: string;
  }): Promise<FileSystemDirectoryHandle>;
  showOpenFilePicker?(options?: {
    multiple?: boolean;
    types?: { description?: string; accept: Record<string, string[]> }[];
  }): Promise<FileSystemFileHandle[]>;
}
