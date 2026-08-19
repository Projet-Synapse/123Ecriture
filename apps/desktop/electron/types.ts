// Types partagés entre les fichiers du process principal Electron —
// regroupés ici pour éviter de les redéclarer dans chaque module (ex.
// `VaultRegistryEntry` utilisé par vaults.js ET vault.js). PAS partagés
// avec apps/mobile/types/global.d.ts (pas de `packages/shared-types`
// aujourd'hui) : chaque bout de l'app type ses propres frontières, une
// discipline de cohérence plutôt qu'un couplage technique — voir le plan de
// cette conversion. Les FORMES doivent malgré tout rester en phase avec
// leurs équivalents côté renderer (mêmes noms de champs) puisqu'elles
// traversent le pont IPC telles quelles (voir preload.ts).

export type VaultEntryKind = 'markdown' | 'canvas' | 'chart' | 'excalidraw';

export interface VaultNoteNode {
  type: 'note';
  relPath: string;
  name: string;
  modifiedAt: number;
  kind: VaultEntryKind;
}

export interface VaultFolderNode {
  type: 'folder';
  relPath: string;
  name: string;
  children: VaultTreeNode[];
}

export type VaultTreeNode = VaultNoteNode | VaultFolderNode;

// `.123ecriture/order.json` — une entrée par dossier PARENT (chemin
// relatif, "" pour la racine du vault), voir vault.ts.
export type VaultOrder = Record<string, string[]>;

export interface VaultRegistryEntry {
  id: string;
  name: string;
  path: string;
  cloudLinked: boolean;
  remoteVaultId: string | null;
}

export interface VaultIdentity {
  id: string;
  name: string;
  createdAt: string;
}

// Config app-level (userData/config.json, voir config.ts) — `vaultPath`
// est l'ancien format (avant les coffres multiples), migré à la volée par
// vaults.ts ; gardé optionnel ici pour typer fidèlement ce qu'on peut
// effectivement lire d'un fichier existant.
export interface AppConfig {
  vaults?: VaultRegistryEntry[];
  activeVaultId?: string | null;
  vaultPath?: string;
  preferences?: Partial<Preferences>;
}

export interface Subtask {
  id: string;
  text: string;
  done: boolean;
}

export interface TaskAttachment {
  relPath: string;
  name: string;
}

export interface Task {
  id: string;
  text: string;
  done: boolean;
  createdAt: string;
  listId: string;
  // Ajoutés pour la refonte façon Microsoft To Do — voir tasks.ts,
  // `normalizeTask` : absents des tâches créées avant cette fonctionnalité,
  // toujours normalisés (repli sur ''/[]) à la LECTURE plutôt que migrés
  // sur disque, même esprit tolérant que frontmatter.ts.
  description: string;
  subtasks: Subtask[];
  attachments: TaskAttachment[];
}

export interface TaskList {
  id: string;
  name: string;
  createdAt: string;
}

export interface TaskListsData {
  lists: TaskList[];
  activeListId: string | null;
}

export interface CalendarEvent {
  id: string;
  title: string;
  date: string;
  time: string | null;
  allDay: boolean;
  notes: string;
  createdAt: string;
}

export interface CalendarEventInput {
  title: string;
  date: string;
  time?: string | null;
  allDay?: boolean;
  notes?: string;
}

export type PropertyType = 'text' | 'list' | 'number' | 'checkbox' | 'date' | 'datetime' | 'path' | 'options';

export interface PropertyDefinition {
  id: string;
  name: string;
  type: PropertyType;
  createdAt: string;
  // Uniquement pour type==='options' — liste des valeurs proposées (ex.
  // ["🟠 En cours", "🔴 Bloqué", "🟡 En attente"]), configurée dans
  // Paramètres → Gestion des propriétés. Absent/vide pour les autres types.
  options?: string[];
}

export interface PropertyPatch {
  name?: string;
  type?: PropertyType;
  options?: string[];
}

export interface OccurrenceEntry {
  id: string;
  word: string;
  description: string;
  createdAt: string;
}

export interface OccurrencePatch {
  word?: string;
  description?: string;
}

export type ThemeMode = 'system' | 'light' | 'dark';

export interface ToolbarItemConfig {
  id: string;
  visible: boolean;
}

export type NewNoteLocation = 'vaultRoot' | 'sameFolder' | 'custom';

export type EditorViewMode = 'source' | 'split' | 'reading';

// Police de l'éditeur — voir apps/mobile/components/MdxEditor.tsx
// (EDITOR_FONT_STACKS) pour les piles CSS correspondantes.
export type EditorFontFamily = 'system' | 'sans' | 'serif' | 'mono' | 'dyslexic';

// Ordre des fichiers/dossiers dans l'explorateur (voir walkTree dans
// vault.ts) — 'manual' applique la réorganisation glisser-déposer déjà
// enregistrée (.123ecriture/order.json) ; les autres modes l'ignorent
// (sans la perdre : re-choisir 'manual' la restaure). 'oldest' est le
// symétrique de 'recent' (plus ancien d'abord plutôt que plus récent).
export type FileSortMode = 'alphabetical' | 'recent' | 'oldest' | 'manual';

// "Fichier ouvert par défaut" — voir apps/mobile/components/NotesScreen.tsx
// et VaultBridge.getLastOpened/setLastOpened (.123ecriture/state.json,
// PAR coffre, voir vault.ts).
export type DefaultOpenMode = 'lastOpened' | 'newNote' | 'specific';

export interface Preferences {
  themeMode: ThemeMode;
  accentColor: string;
  notesToolbarOrder: ToolbarItemConfig[];
  canvasToolbarOrder: ToolbarItemConfig[];
  chartToolbarOrder: ToolbarItemConfig[];
  // Paramètres → Gestion des fichiers et des liens (voir SettingsScreen.tsx).
  attachmentsFolder: string;
  autoCreateWikilinkTarget: boolean;
  newNoteLocation: NewNoteLocation;
  newNoteCustomFolder: string;
  fileSortMode: FileSortMode;
  defaultOpenMode: DefaultOpenMode;
  defaultOpenSpecificPath: string;
  // Paramètres → Éditeur.
  editorFontSize: number;
  editorFontFamily: EditorFontFamily;
  editorDefaultMode: EditorViewMode;
  editorCloseBrackets: boolean;
  editorInlineTitle: boolean;
  sidebarLayout: SidebarLayoutState;
}

export interface SidebarPanelLayout {
  width: number;
  collapsed: boolean;
}

export type SidebarPanelId = 'nav' | 'explorer' | 'rightPanel';

export type SidebarLayoutState = Record<SidebarPanelId, SidebarPanelLayout>;

export type UpdaterStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'up-to-date' }
  | { state: 'downloading'; version?: string; percent: number }
  | { state: 'ready'; version: string }
  | { state: 'error'; message: string };

export interface ContextMenuItem {
  id: string;
  label: string;
}

export interface HashedNote {
  relPath: string;
  contentHash: string;
  sizeBytes: number;
  modifiedAt: number;
}

// Recherche globale (voir search.ts) — un résultat peut être un dossier ou
// une pièce jointe (aucun `VaultEntryKind` ne les couvre), d'où ce type
// élargi plutôt que de réutiliser VaultEntryKind tel quel.
export type SearchResultKind = VaultEntryKind | 'folder' | 'attachment';

export type SearchMatchType = 'title' | 'content' | 'tag' | 'property';

export interface SearchResult {
  relPath: string;
  name: string;
  kind: SearchResultKind;
  matchType: SearchMatchType;
  snippet?: string;
}

export interface SearchOptions {
  propertyId?: string;
  propertyValue?: string;
}
