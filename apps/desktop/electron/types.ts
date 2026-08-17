// Types partagés entre les fichiers du process principal Electron —
// regroupés ici pour éviter de les redéclarer dans chaque module (ex.
// `VaultRegistryEntry` utilisé par vaults.js ET vault.js). PAS partagés
// avec apps/mobile/types/global.d.ts (pas de `packages/shared-types`
// aujourd'hui) : chaque bout de l'app type ses propres frontières, une
// discipline de cohérence plutôt qu'un couplage technique — voir le plan de
// cette conversion. Les FORMES doivent malgré tout rester en phase avec
// leurs équivalents côté renderer (mêmes noms de champs) puisqu'elles
// traversent le pont IPC telles quelles (voir preload.ts).

export type VaultEntryKind = 'markdown' | 'canvas' | 'chart';

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

export interface Task {
  id: string;
  text: string;
  done: boolean;
  createdAt: string;
  listId: string;
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

export type PropertyType = 'text' | 'list' | 'number' | 'checkbox' | 'date' | 'datetime';

export interface PropertyDefinition {
  id: string;
  name: string;
  type: PropertyType;
  createdAt: string;
}

export interface PropertyPatch {
  name?: string;
  type?: PropertyType;
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
  // Paramètres → Éditeur.
  editorFontSize: number;
  editorDefaultMode: EditorViewMode;
  editorCloseBrackets: boolean;
  editorInlineTitle: boolean;
}

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
