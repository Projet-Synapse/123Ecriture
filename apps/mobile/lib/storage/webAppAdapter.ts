// //1. ⚙️ PRÉFÉRENCES + CONNEXION (web) — window.preferences / window.auth
// ////////////////////////////////////////////////////////////////////////
//
// Préférences : côté desktop elles vivent dans config.json (userData
// Electron, apps/desktop/electron/preferences.ts) — en navigateur
// l'équivalent app-level est localStorage (même clé que webVaultAdapter
// lit pour fileSortMode/attachmentsFolder). Même fusion superficielle que
// getPreferences() desktop, y compris mergeToolbarOrder (un nouveau bouton
// par défaut doit apparaître sur les configs stockées plus anciennes).
//
// Connexion : le desktop passe par navigateur système + protocole
// app123ecriture:// (apps/desktop/electron/auth.ts). En web, on EST le
// navigateur : openExternal redirige la page elle-même, et le retour OAuth
// (?code=...) est échangé par supabase-js au chargement suivant
// (detectSessionInUrl, activé seulement sans pont Electron — voir
// supabaseClient.ts). AuthContext construit alors redirectTo avec l'URL du
// site. onCallback n'a donc rien à relayer ici, mais reste branché pour
// honorer le contrat AuthBridge.

import { WEB_PREFERENCES_KEY } from './webVaultAdapter';

// Copie conforme de DEFAULT_PREFERENCES (apps/desktop/electron/preferences.ts)
// — deux paquets séparés, duplication assumée (même convention que les
// types hand-mirrored de types/global.d.ts, voir CLAUDE.md).
const DEFAULT_PREFERENCES: Preferences = {
  themeMode: 'system',
  accentColor: '#4f46e5',
  notesToolbarOrder: [
    { id: 'heading-group', visible: true },
    { id: 'bold', visible: true },
    { id: 'italic', visible: true },
    { id: 'code', visible: true },
    { id: 'quote', visible: true },
    { id: 'bullet', visible: true },
    { id: 'numbered', visible: true },
    { id: 'link', visible: true },
    { id: 'table', visible: true },
  ],
  canvasToolbarOrder: [
    { id: 'add-text', visible: true },
    { id: 'add-note', visible: true },
  ],
  chartToolbarOrder: [
    { id: 'add-column', visible: true },
    { id: 'add-row', visible: true },
    { id: 'create-chart', visible: true },
  ],
  attachmentsFolder: 'attachments',
  autoCreateWikilinkTarget: true,
  newNoteLocation: 'vaultRoot',
  newNoteCustomFolder: '',
  fileSortMode: 'alphabetical',
  tasksSortByDueDate: false,
  tasksHideCompleted: false,
  defaultOpenMode: 'lastOpened',
  defaultOpenSpecificPath: '',
  editorFontSize: 15,
  editorFontFamily: 'system',
  editorDefaultMode: 'source',
  editorCloseBrackets: true,
  editorInlineTitle: false,
  sidebarLayout: {
    nav: { width: 220, collapsed: false },
    explorer: { width: 260, collapsed: false },
    rightPanel: { width: 280, collapsed: false },
  },
  favoriteRelPaths: [],
  // Sync manuelle par défaut — choix déjà tranché (voir CLAUDE.md), ne
  // JAMAIS passer à `true` ici.
  autoSyncEnabled: false,
};

// Fusion fine des 3 barres d'outils : une config stockée avant l'ajout
// d'un bouton doit quand même voir ce bouton (règle CLAUDE.md : visible
// et fonctionnel, pas juste présent dans le code).
function mergeToolbarOrder(
  defaults: ToolbarItemConfig[],
  stored: ToolbarItemConfig[] | undefined,
): ToolbarItemConfig[] {
  if (!stored) return defaults;
  const knownIds = new Set(stored.map((item) => item.id));
  const missing = defaults.filter((item) => !knownIds.has(item.id));
  return [...stored, ...missing];
}

function readStoredPreferences(): Partial<Preferences> {
  try {
    const stored = JSON.parse(localStorage.getItem(WEB_PREFERENCES_KEY) ?? '{}');
    return stored && typeof stored === 'object' ? stored : {};
  } catch {
    return {};
  }
}

function getPreferences(): Preferences {
  const stored = readStoredPreferences();
  const merged: Preferences = { ...DEFAULT_PREFERENCES, ...stored };
  merged.notesToolbarOrder = mergeToolbarOrder(DEFAULT_PREFERENCES.notesToolbarOrder, stored.notesToolbarOrder);
  merged.canvasToolbarOrder = mergeToolbarOrder(DEFAULT_PREFERENCES.canvasToolbarOrder, stored.canvasToolbarOrder);
  merged.chartToolbarOrder = mergeToolbarOrder(DEFAULT_PREFERENCES.chartToolbarOrder, stored.chartToolbarOrder);
  return merged;
}

function writeStoredPreferences(preferences: Preferences): void {
  localStorage.setItem(WEB_PREFERENCES_KEY, JSON.stringify(preferences));
}

export const webPreferencesAdapter = {
  get: async (): Promise<Preferences> => getPreferences(),

  // Resolve APRÈS l'écriture effective : des appelants (réordonnancement
  // glissé juste après un changement de mode de tri) dépendent de cette
  // garantie contre les races lecture-après-écriture (voir CLAUDE.md).
  set: async (partial: Partial<Preferences>): Promise<Preferences> => {
    const next = { ...getPreferences(), ...partial };
    writeStoredPreferences(next);
    return next;
  },

  // Paramètres → Confidentialité : remet la personnalisation aux défauts,
  // ne touche ni aux coffres ni au contenu (port direct du reset desktop).
  reset: async (): Promise<Preferences> => {
    writeStoredPreferences(DEFAULT_PREFERENCES);
    return DEFAULT_PREFERENCES;
  },

  getConfigPath: async (): Promise<string> => 'localStorage (navigateur)',

  // Rien à révéler dans un explorateur de fichiers côté web — no-op
  // silencieux (le chemin affiché dans Paramètres l'explique déjà).
  revealConfigFolder: async (): Promise<void> => undefined,
} satisfies PreferencesBridge;

export const webAuthAdapter = {
  openExternal: async (url: string): Promise<void> => {
    if (typeof url !== 'string' || !url.startsWith('https://')) {
      throw new Error('URL de connexion invalide.');
    }
    // Redirection de la page elle-même : en navigateur on EST le « navigateur
    // système » du flux desktop. Le retour Google → Supabase recharge le
    // site avec ?code=..., échangé par supabase-js (detectSessionInUrl).
    window.location.assign(url);
  },

  // Le callback web passe par le rechargement de page (voir ci-dessus),
  // pas par un évènement push — abonnement sans effet, retourné pour
  // honorer le contrat.
  onCallback: (): (() => void) => () => undefined,
} satisfies AuthBridge;
