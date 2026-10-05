import * as FileSystem from 'expo-file-system/legacy';

import { DEFAULT_PREFERENCES } from '../../preferences/PreferencesContext';

// Pont `window.preferences` NATIF (Android) — même interface que
// webPreferencesAdapter (lib/storage/webAppAdapter.ts) et le preload
// Electron. Avant lui, PreferencesContext tournait sans bridge sur mobile :
// toute la personnalisation (thème, accent, polices, apparence, largeurs
// de panneaux…) restait en mémoire et se réinitialisait à chaque relance
// de l'app (vécu A13, 2026-10-03 — demande : « mes modifications dans
// paramètres doivent être sauvegardées »).
//
// Stockage : un JSON dans le stockage privé de l'app
// (documentDirectory, même emplacement que les onglets ouverts dans
// nativeVaultAdapter — survit aux relances ; effacé par la désinstallation).
//
// ⚠️ DEFAULT_PREFERENCES est IMPORTÉ de PreferencesContext (et non
// dupliqué comme le fait webAppAdapter pour le web) : ici react-native
// est disponible et une copie finirait par dériver (déjà le cas entre
// les copies desktop/web sur accentColor) — un défaut divergent
// écraserait la vraie valeur mobile au premier lancement, puisque
// get() fusionne les défauts dans le stocké. Aucun cycle : le contexte
// n'importe aucun module de lib/storage.

const PREFS_PATH = `${FileSystem.documentDirectory}123ecriture-preferences.json`;

// Fusion fine des 3 barres d'outils (copie de webAppAdapter) : une config
// stockée avant l'ajout d'un bouton doit quand même voir ce bouton
// (règle CLAUDE.md : visible et fonctionnel, pas juste présent).
function mergeToolbarOrder(
  defaults: ToolbarItemConfig[],
  stored: ToolbarItemConfig[] | undefined,
): ToolbarItemConfig[] {
  if (!stored) return defaults;
  const knownIds = new Set(stored.map((item) => item.id));
  const missing = defaults.filter((item) => !knownIds.has(item.id));
  return [...stored, ...missing];
}

// Cache mémoire : PreferencesContext relit bridge.get() à chaque montage
// de l'app (une fois par lancement) — la relecture fichier au-delà serait
// du gaspillage ; set/reset maintiennent le cache à jour pour les rares
// lectures consécutives.
let cache: Preferences | null = null;

async function readAll(): Promise<Preferences> {
  if (cache) return cache;
  try {
    const raw = await FileSystem.readAsStringAsync(PREFS_PATH);
    const stored = JSON.parse(raw) as Partial<Preferences>;
    const merged: Preferences = {
      ...DEFAULT_PREFERENCES,
      ...(stored && typeof stored === 'object' ? stored : {}),
    };
    merged.notesToolbarOrder = mergeToolbarOrder(DEFAULT_PREFERENCES.notesToolbarOrder, stored.notesToolbarOrder);
    merged.canvasToolbarOrder = mergeToolbarOrder(DEFAULT_PREFERENCES.canvasToolbarOrder, stored.canvasToolbarOrder);
    merged.chartToolbarOrder = mergeToolbarOrder(DEFAULT_PREFERENCES.chartToolbarOrder, stored.chartToolbarOrder);
    cache = merged;
  } catch {
    // Fichier absent (premier lancement) ou corrompu : défauts purs, et un
    // set() ultérieur recréera le fichier.
    cache = { ...DEFAULT_PREFERENCES };
  }
  return cache;
}

export const nativePreferencesAdapter = {
  get: readAll,

  // Resolve APRÈS l'écriture disque : des appelants dépendent de cette
  // garantie anti-course lecture-après-écriture (même contrat que le web).
  set: async (partial: Partial<Preferences>): Promise<Preferences> => {
    const next = { ...(await readAll()), ...partial };
    cache = next;
    await FileSystem.writeAsStringAsync(PREFS_PATH, JSON.stringify(next));
    return next;
  },

  // Paramètres → Confidentialité : remet la personnalisation aux défauts.
  reset: async (): Promise<Preferences> => {
    cache = { ...DEFAULT_PREFERENCES };
    await FileSystem.writeAsStringAsync(PREFS_PATH, JSON.stringify(cache));
    return cache;
  },

  getConfigPath: async (): Promise<string> => PREFS_PATH,

  // Pas d'« explorateur » à ouvrir sur Android — no-op silencieux.
  revealConfigFolder: async (): Promise<void> => undefined,
} satisfies PreferencesBridge;
