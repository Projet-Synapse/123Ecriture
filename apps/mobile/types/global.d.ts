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
    move: (
      relPath: string,
      destinationParentRelPath?: string,
    ) => Promise<{ relPath: string; name: string }>;
    setPath: (relPath: string, newRelPath: string) => Promise<{ relPath: string; name: string }>;
    ensureDailyNote: (dateIso: string) => Promise<VaultEntry>;
  }

  interface VaultRegistryEntry {
    id: string;
    name: string;
    path: string;
    cloudLinked: boolean;
    remoteVaultId: string | null;
  }

  interface VaultsBridge {
    list: () => Promise<VaultRegistryEntry[]>;
    getActive: () => Promise<string | null>;
    addExisting: () => Promise<VaultRegistryEntry[]>;
    createNew: (name: string) => Promise<VaultRegistryEntry[]>;
    switch: (id: string) => Promise<VaultRegistryEntry[]>;
    rename: (id: string, name: string) => Promise<VaultRegistryEntry[]>;
    remove: (id: string) => Promise<VaultRegistryEntry[]>;
    setCloudLink: (
      id: string,
      payload: { linked: boolean; remoteVaultId?: string | null },
    ) => Promise<VaultRegistryEntry[]>;
    onChanged: (callback: (vaults: VaultRegistryEntry[]) => void) => () => void;
  }

  interface AuthBridge {
    openExternal: (url: string) => Promise<void>;
    onCallback: (callback: (url: string) => void) => () => void;
  }

  interface HashedNote {
    relPath: string;
    contentHash: string;
    sizeBytes: number;
    modifiedAt: number;
  }

  interface SyncBridge {
    hashVaultTree: () => Promise<HashedNote[]>;
  }

  interface CalendarEvent {
    id: string;
    title: string;
    date: string; // AAAA-MM-JJ
    time: string | null; // HH:MM, null si allDay
    allDay: boolean;
    notes: string;
    createdAt: string;
  }

  interface CalendarEventInput {
    title: string;
    date: string;
    time?: string | null;
    allDay?: boolean;
    notes?: string;
  }

  interface CalendarBridge {
    listEvents: () => Promise<CalendarEvent[]>;
    addEvent: (input: CalendarEventInput) => Promise<CalendarEvent[]>;
    updateEvent: (id: string, patch: Partial<CalendarEventInput>) => Promise<CalendarEvent[]>;
    removeEvent: (id: string) => Promise<CalendarEvent[]>;
  }

  interface SheetListEntry {
    id: string;
    name: string;
    createdAt: string;
  }

  interface SheetListsBridge {
    list: () => Promise<SheetListEntry[]>;
    getActive: () => Promise<string | null>;
    create: (name: string) => Promise<SheetListEntry[]>;
    rename: (id: string, name: string) => Promise<SheetListEntry[]>;
    remove: (id: string) => Promise<SheetListEntry[]>;
    switch: (id: string) => Promise<SheetListEntry[]>;
    onChanged: (callback: (lists: SheetListEntry[]) => void) => () => void;
  }

  interface SheetColumn {
    id: string;
    name: string;
  }

  interface SheetRow {
    id: string;
    cells: Record<string, string>;
  }

  type SheetChartType = 'bar' | 'line' | 'pie';

  interface SheetChartConfig {
    type: SheetChartType;
    labelColumnId: string | null;
    valueColumnIds: string[];
  }

  interface SheetData {
    columns: SheetColumn[];
    rows: SheetRow[];
    chart: SheetChartConfig | null;
  }

  interface SheetBridge {
    getActiveData: () => Promise<SheetData>;
    saveActiveData: (data: SheetData) => Promise<SheetData>;
  }

  interface CanvasListEntry {
    id: string;
    name: string;
    createdAt: string;
  }

  interface CanvasListsBridge {
    list: () => Promise<CanvasListEntry[]>;
    getActive: () => Promise<string | null>;
    create: (name: string) => Promise<CanvasListEntry[]>;
    rename: (id: string, name: string) => Promise<CanvasListEntry[]>;
    remove: (id: string) => Promise<CanvasListEntry[]>;
    switch: (id: string) => Promise<CanvasListEntry[]>;
    onChanged: (callback: (lists: CanvasListEntry[]) => void) => () => void;
  }

  type CanvasNodeType = 'text' | 'note';

  interface CanvasNode {
    id: string;
    type: CanvasNodeType;
    x: number;
    y: number;
    width: number;
    height: number;
    text?: string; // type 'text'
    relPath?: string; // type 'note'
    title?: string; // type 'note' — titre affiché, mis en cache au choix de la note
  }

  interface CanvasEdge {
    id: string;
    from: string;
    to: string;
  }

  interface CanvasData {
    nodes: CanvasNode[];
    edges: CanvasEdge[];
  }

  interface CanvasBridge {
    getActiveData: () => Promise<CanvasData>;
    saveActiveData: (data: CanvasData) => Promise<CanvasData>;
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
    listId: string;
  }

  interface TasksBridge {
    list: () => Promise<Task[]>;
    add: (text: string) => Promise<Task[]>;
    toggle: (id: string) => Promise<Task[]>;
    remove: (id: string) => Promise<Task[]>;
  }

  interface TaskList {
    id: string;
    name: string;
    createdAt: string;
  }

  interface TaskListsBridge {
    list: () => Promise<TaskList[]>;
    getActive: () => Promise<string | null>;
    create: (name: string) => Promise<TaskList[]>;
    rename: (id: string, name: string) => Promise<TaskList[]>;
    remove: (id: string) => Promise<TaskList[]>;
    switch: (id: string) => Promise<TaskList[]>;
    onChanged: (callback: (lists: TaskList[]) => void) => () => void;
  }

  interface Window {
    vault?: VaultBridge;
    vaults?: VaultsBridge;
    updater?: UpdaterBridge;
    preferences?: PreferencesBridge;
    contextMenu?: ContextMenuBridge;
    tasks?: TasksBridge;
    taskLists?: TaskListsBridge;
    auth?: AuthBridge;
    sync?: SyncBridge;
    calendar?: CalendarBridge;
    sheetLists?: SheetListsBridge;
    sheet?: SheetBridge;
    canvasLists?: CanvasListsBridge;
    canvas?: CanvasBridge;
  }
}
