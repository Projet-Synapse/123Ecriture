// Types des ponts exposés par apps/desktop/electron/preload.js via
// contextBridge. N'existent que côté Electron desktop (window.vault,
// window.updater, window.preferences, window.contextMenu sont undefined
// sur web/mobile — Phase 2 pour ces plateformes).
export {};

declare global {
  // Type de fichier reconnu par le vault, dérivé de l'extension (voir
  // walkTree dans apps/desktop/electron/vault.js) — pilote l'aiguillage de
  // NotesScreen.tsx vers l'éditeur MDX, CanvasEditor.tsx ou ChartEditor.tsx,
  // et l'icône affichée par VaultTreeView.tsx.
  type VaultEntryKind = 'markdown' | 'canvas' | 'chart' | 'excalidraw';

  interface VaultEntry {
    relPath: string;
    name: string;
    modifiedAt: number;
    kind: VaultEntryKind;
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
    createNote: (name: string, parentRelPath?: string, kind?: VaultEntryKind) => Promise<VaultEntry>;
    createFolder: (name: string, parentRelPath?: string) => Promise<VaultFolderEntry>;
    rename: (relPath: string, newName: string) => Promise<{ relPath: string; name: string }>;
    move: (
      relPath: string,
      destinationParentRelPath?: string,
    ) => Promise<{ relPath: string; name: string }>;
    setPath: (relPath: string, newRelPath: string) => Promise<{ relPath: string; name: string }>;
    // Confirmation NATIVE (dialog.showMessageBox) déjà gérée côté main
    // process (voir vault.ts, `vault:delete`) — `deleted: false` si
    // l'utilisatrice a annulé, jamais de suppression silencieuse.
    delete: (relPath: string) => Promise<{ deleted: boolean }>;
    ensureDailyNote: (dateIso: string) => Promise<VaultEntry>;
    reorder: (parentRelPath: string | undefined, orderedNames: string[]) => Promise<VaultTreeNode[]>;
    importAttachment: () => Promise<{ relPath: string; name: string } | null>;
    readAttachmentDataUrl: (relPath: string) => Promise<string>;
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

  // Schéma global de propriétés typées (voir PropertiesPanel.tsx) — ne
  // porte que la DÉFINITION (nom + type) ; les valeurs vivent dans le
  // frontmatter YAML de chaque note (voir lib/frontmatter.ts).
  type PropertyType = 'text' | 'list' | 'number' | 'checkbox' | 'date' | 'datetime';

  interface PropertyDefinition {
    id: string;
    name: string;
    type: PropertyType;
    createdAt: string;
  }

  interface PropertyPatch {
    name?: string;
    type?: PropertyType;
  }

  interface PropertiesBridge {
    list: () => Promise<PropertyDefinition[]>;
    create: (name: string, type: PropertyType) => Promise<PropertyDefinition[]>;
    update: (id: string, patch: PropertyPatch) => Promise<PropertyDefinition[]>;
    remove: (id: string) => Promise<PropertyDefinition[]>;
  }

  // Dictionnaire personnel des {{occurrences}} (voir OccurrencesPanel.tsx,
  // lib/markdownPlugins.ts, lib/mdxLivePreview.ts). Renommer un mot
  // (`update` avec `word`) réécrit `{{ancien}}`→`{{nouveau}}` dans tout le
  // vault côté main process (apps/desktop/electron/occurrences.js) — pas
  // juste dans le registre.
  interface OccurrenceEntry {
    id: string;
    word: string;
    description: string;
    createdAt: string;
  }

  interface OccurrencePatch {
    word?: string;
    description?: string;
  }

  interface OccurrencesBridge {
    list: () => Promise<OccurrenceEntry[]>;
    create: (word: string, description?: string) => Promise<OccurrenceEntry[]>;
    update: (id: string, patch: OccurrencePatch) => Promise<OccurrenceEntry[]>;
    remove: (id: string) => Promise<OccurrenceEntry[]>;
    findNotes: (word: string) => Promise<string[]>;
  }

  // Recherche globale (voir SearchDialog.tsx, apps/desktop/electron/
  // search.ts) — un résultat peut être un dossier ou une pièce jointe,
  // aucun VaultEntryKind ne les couvre, d'où ce type élargi.
  type SearchResultKind = VaultEntryKind | 'folder' | 'attachment';
  type SearchMatchType = 'title' | 'content' | 'tag' | 'property';

  interface SearchResult {
    relPath: string;
    name: string;
    kind: SearchResultKind;
    matchType: SearchMatchType;
    snippet?: string;
  }

  interface SearchOptions {
    propertyId?: string;
    propertyValue?: string;
  }

  interface SearchBridge {
    run: (query: string, options?: SearchOptions) => Promise<SearchResult[]>;
  }

  // Contenu d'un fichier `.chart` (voir defaultContentForKind dans
  // apps/desktop/electron/vault.js) — plus de registre multi-feuilles
  // séparé (SheetListsBridge/SheetBridge supprimés) : un `.chart` est lu/
  // écrit via VaultBridge.readNote/writeNote comme n'importe quel fichier
  // du vault, son CONTENU (texte JSON) a cette forme.
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

  // Champs alignés sur JSON Canvas (spec ouverte publiée par Obsidian,
  // https://jsoncanvas.org — voir lib/canvas.ts) : un `.canvas` est un
  // fichier du vault comme un autre (plus de registre séparé, voir
  // CanvasEditor.tsx), lu/écrit via VaultBridge.readNote/writeNote comme
  // n'importe quelle note — son CONTENU (texte JSON) a cette forme.
  type CanvasNodeType = 'text' | 'file';

  interface CanvasNode {
    id: string;
    type: CanvasNodeType;
    x: number;
    y: number;
    width: number;
    height: number;
    text?: string; // type 'text'
    file?: string; // type 'file' — relPath de la note référencée
    title?: string; // type 'file' — titre affiché, mis en cache au choix de la note
  }

  type CanvasEdgeSide = 'top' | 'right' | 'bottom' | 'left';

  interface CanvasEdge {
    id: string;
    fromNode: string;
    fromSide?: CanvasEdgeSide;
    toNode: string;
    toSide?: CanvasEdgeSide;
  }

  interface CanvasData {
    nodes: CanvasNode[];
    edges: CanvasEdge[];
  }

  // Scène Excalidraw minimale (voir ExcalidrawEditor.tsx) — forme du
  // fichier natif `.excalidraw` (https://excalidraw.com), pour rester
  // compatible si le vrai outil de dessin (`@excalidraw/excalidraw`) est
  // intégré plus tard ; `elements`/`appState` volontairement non typés
  // finement tant qu'aucun outil ne les manipule vraiment (scaffolding
  // seulement cette session, voir docs/ARCHITECTURE.md §4).
  interface ExcalidrawData {
    type: 'excalidraw';
    version: number;
    elements: unknown[];
    appState: Record<string, unknown>;
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

  type NewNoteLocation = 'vaultRoot' | 'sameFolder' | 'custom';

  type EditorViewMode = 'source' | 'split' | 'reading';

  // Ordre des fichiers/dossiers dans l'explorateur (voir walkTree dans
  // apps/desktop/electron/vault.ts) — 'manual' applique la réorganisation
  // glisser-déposer déjà enregistrée ; les deux autres modes l'ignorent
  // (sans la perdre : re-choisir 'manual' la restaure).
  type FileSortMode = 'alphabetical' | 'recent' | 'manual';

  interface Preferences {
    themeMode: ThemeMode;
    accentColor: string;
    notesToolbarOrder: ToolbarItemConfig[];
    canvasToolbarOrder: ToolbarItemConfig[];
    chartToolbarOrder: ToolbarItemConfig[];
    // Paramètres → Gestion des fichiers et des liens.
    attachmentsFolder: string;
    autoCreateWikilinkTarget: boolean;
    newNoteLocation: NewNoteLocation;
    newNoteCustomFolder: string;
    fileSortMode: FileSortMode;
    // Paramètres → Éditeur.
    editorFontSize: number;
    editorDefaultMode: EditorViewMode;
    editorCloseBrackets: boolean;
    editorInlineTitle: boolean;
    // Largeur/repli des 3 barres latérales redimensionnables au curseur
    // (voir lib/useResizablePanel.ts, components/ResizeHandle.tsx) : la
    // nav générale (AppShell.tsx), l'explorateur de fichiers et le panneau
    // droit Propriétés/Occurrences (les deux dans NotesScreen.tsx).
    // `collapsed` est un état séparé de `width` (pas juste width===0) pour
    // pouvoir mémoriser la dernière largeur "dépliée" et la restaurer telle
    // quelle en rouvrant.
    sidebarLayout: SidebarLayoutState;
  }

  interface SidebarPanelLayout {
    width: number;
    collapsed: boolean;
  }

  type SidebarPanelId = 'nav' | 'explorer' | 'rightPanel';

  type SidebarLayoutState = Record<SidebarPanelId, SidebarPanelLayout>;

  interface PreferencesBridge {
    get: () => Promise<Preferences>;
    set: (partial: Partial<Preferences>) => Promise<Preferences>;
    reset: () => Promise<Preferences>;
    getConfigPath: () => Promise<string>;
    revealConfigFolder: () => Promise<void>;
  }

  interface ContextMenuItem {
    id: string;
    label: string;
  }

  interface ContextMenuBridge {
    show: (items: ContextMenuItem[]) => Promise<string | null>;
  }

  interface Subtask {
    id: string;
    text: string;
    done: boolean;
  }

  interface TaskAttachment {
    relPath: string;
    name: string;
  }

  interface Task {
    id: string;
    text: string;
    done: boolean;
    createdAt: string;
    listId: string;
    description: string;
    subtasks: Subtask[];
    attachments: TaskAttachment[];
  }

  interface TasksBridge {
    list: () => Promise<Task[]>;
    add: (text: string) => Promise<Task[]>;
    toggle: (id: string) => Promise<Task[]>;
    remove: (id: string) => Promise<Task[]>;
    update: (id: string, patch: { text?: string; description?: string }) => Promise<Task[]>;
    addSubtask: (taskId: string, text: string) => Promise<Task[]>;
    renameSubtask: (taskId: string, subtaskId: string, text: string) => Promise<Task[]>;
    toggleSubtask: (taskId: string, subtaskId: string) => Promise<Task[]>;
    removeSubtask: (taskId: string, subtaskId: string) => Promise<Task[]>;
    addAttachment: (taskId: string, attachment: TaskAttachment) => Promise<Task[]>;
    removeAttachment: (taskId: string, relPath: string) => Promise<Task[]>;
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
    properties?: PropertiesBridge;
    occurrences?: OccurrencesBridge;
    search?: SearchBridge;
  }
}
