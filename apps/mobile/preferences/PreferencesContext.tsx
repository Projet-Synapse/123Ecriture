import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';

import { DEFAULT_NOTES_TOOLBAR_ORDER } from '../lib/notesToolbarActions';
import { darkTheme, lightTheme, type Theme } from '../theme';

// Point central de la personnalisation de l'interface (voir
// docs/ARCHITECTURE.md §7 et l'écran Paramètres → Personnalisation) :
// résout le thème effectif (mode clair/sombre/système + couleur d'accent)
// et l'ordre/visibilité de la barre d'outils Notes, et fournit les setters
// qui persistent côté Electron (window.preferences) quand disponible. Sur
// web/mobile (pas de window.preferences), tout reste en mémoire pour la
// session — pas de crash, juste pas de persistance.

const DEFAULT_PREFERENCES: Preferences = {
  themeMode: 'system',
  accentColor: lightTheme.accent,
  notesToolbarOrder: DEFAULT_NOTES_TOOLBAR_ORDER,
};

type PreferencesContextValue = {
  preferences: Preferences;
  theme: Theme;
  colorScheme: 'light' | 'dark';
  setThemeMode: (mode: ThemeMode) => void;
  setAccentColor: (color: string) => void;
  setNotesToolbarOrder: (order: ToolbarItemConfig[]) => void;
};

const PreferencesReactContext = createContext<PreferencesContextValue | null>(null);

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme();
  const bridge = typeof window !== 'undefined' ? window.preferences : undefined;
  const [preferences, setPreferences] = useState<Preferences>(DEFAULT_PREFERENCES);

  useEffect(() => {
    if (!bridge) return;
    void bridge
      .get()
      .then((stored) => setPreferences({ ...DEFAULT_PREFERENCES, ...stored }))
      .catch((error) => console.error('[preferences] échec du chargement :', error));
  }, [bridge]);

  const persist = useCallback(
    (partial: Partial<Preferences>) => {
      setPreferences((prev) => {
        const next = { ...prev, ...partial };
        if (bridge) {
          bridge.set(partial).catch((error) => console.error('[preferences] échec de sauvegarde :', error));
        }
        return next;
      });
    },
    [bridge],
  );

  const setThemeMode = useCallback((mode: ThemeMode) => persist({ themeMode: mode }), [persist]);
  const setAccentColor = useCallback((color: string) => persist({ accentColor: color }), [persist]);
  const setNotesToolbarOrder = useCallback(
    (order: ToolbarItemConfig[]) => persist({ notesToolbarOrder: order }),
    [persist],
  );

  const colorScheme: 'light' | 'dark' =
    preferences.themeMode === 'system' ? (systemScheme === 'dark' ? 'dark' : 'light') : preferences.themeMode;

  const theme = useMemo<Theme>(() => {
    const base = colorScheme === 'dark' ? darkTheme : lightTheme;
    return { ...base, accent: preferences.accentColor };
  }, [colorScheme, preferences.accentColor]);

  const value = useMemo<PreferencesContextValue>(
    () => ({ preferences, theme, colorScheme, setThemeMode, setAccentColor, setNotesToolbarOrder }),
    [preferences, theme, colorScheme, setThemeMode, setAccentColor, setNotesToolbarOrder],
  );

  return <PreferencesReactContext.Provider value={value}>{children}</PreferencesReactContext.Provider>;
}

export function usePreferences(): PreferencesContextValue {
  const ctx = useContext(PreferencesReactContext);
  if (!ctx) {
    throw new Error('usePreferences() doit être appelé sous <PreferencesProvider>');
  }
  return ctx;
}
