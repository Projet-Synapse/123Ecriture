import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';

import { DEFAULT_CANVAS_TOOLBAR_ORDER } from '../lib/canvasToolbarActions';
import { DEFAULT_CHART_TOOLBAR_ORDER } from '../lib/chartToolbarActions';
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
  canvasToolbarOrder: DEFAULT_CANVAS_TOOLBAR_ORDER,
  chartToolbarOrder: DEFAULT_CHART_TOOLBAR_ORDER,
  attachmentsFolder: 'attachments',
  autoCreateWikilinkTarget: true,
  newNoteLocation: 'vaultRoot',
  newNoteCustomFolder: '',
  editorFontSize: 15,
  editorDefaultMode: 'source',
  editorCloseBrackets: true,
  editorInlineTitle: false,
};

type PreferencesContextValue = {
  preferences: Preferences;
  theme: Theme;
  colorScheme: 'light' | 'dark';
  setThemeMode: (mode: ThemeMode) => void;
  setAccentColor: (color: string) => void;
  setNotesToolbarOrder: (order: ToolbarItemConfig[]) => void;
  setCanvasToolbarOrder: (order: ToolbarItemConfig[]) => void;
  setChartToolbarOrder: (order: ToolbarItemConfig[]) => void;
  setAttachmentsFolder: (folder: string) => void;
  setAutoCreateWikilinkTarget: (value: boolean) => void;
  setNewNoteLocation: (location: NewNoteLocation) => void;
  setNewNoteCustomFolder: (folder: string) => void;
  setEditorFontSize: (size: number) => void;
  setEditorDefaultMode: (mode: EditorViewMode) => void;
  setEditorCloseBrackets: (value: boolean) => void;
  setEditorInlineTitle: (value: boolean) => void;
  // Paramètres → Confidentialité et données. `undefined` si non disponible
  // (pas de pont Electron, ex. web/mobile) — laissé à la charge de l'écran
  // d'afficher/masquer les actions correspondantes, même logique de
  // dégradation que le reste des préférences.
  resetPreferences: () => void;
  getConfigPath: (() => Promise<string>) | undefined;
  revealConfigFolder: (() => Promise<void>) | undefined;
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
  const setCanvasToolbarOrder = useCallback(
    (order: ToolbarItemConfig[]) => persist({ canvasToolbarOrder: order }),
    [persist],
  );
  const setChartToolbarOrder = useCallback(
    (order: ToolbarItemConfig[]) => persist({ chartToolbarOrder: order }),
    [persist],
  );
  const setAttachmentsFolder = useCallback(
    (folder: string) => persist({ attachmentsFolder: folder }),
    [persist],
  );
  const setAutoCreateWikilinkTarget = useCallback(
    (value: boolean) => persist({ autoCreateWikilinkTarget: value }),
    [persist],
  );
  const setNewNoteLocation = useCallback(
    (location: NewNoteLocation) => persist({ newNoteLocation: location }),
    [persist],
  );
  const setNewNoteCustomFolder = useCallback(
    (folder: string) => persist({ newNoteCustomFolder: folder }),
    [persist],
  );
  const setEditorFontSize = useCallback((size: number) => persist({ editorFontSize: size }), [persist]);
  const setEditorDefaultMode = useCallback(
    (mode: EditorViewMode) => persist({ editorDefaultMode: mode }),
    [persist],
  );
  const setEditorCloseBrackets = useCallback(
    (value: boolean) => persist({ editorCloseBrackets: value }),
    [persist],
  );
  const setEditorInlineTitle = useCallback(
    (value: boolean) => persist({ editorInlineTitle: value }),
    [persist],
  );

  const resetPreferences = useCallback(() => {
    setPreferences(DEFAULT_PREFERENCES);
    if (bridge) {
      bridge.reset().catch((error) => console.error('[preferences] échec de la réinitialisation :', error));
    }
  }, [bridge]);

  const getConfigPath = bridge?.getConfigPath;
  const revealConfigFolder = bridge?.revealConfigFolder;

  const colorScheme: 'light' | 'dark' =
    preferences.themeMode === 'system' ? (systemScheme === 'dark' ? 'dark' : 'light') : preferences.themeMode;

  const theme = useMemo<Theme>(() => {
    const base = colorScheme === 'dark' ? darkTheme : lightTheme;
    return { ...base, accent: preferences.accentColor };
  }, [colorScheme, preferences.accentColor]);

  const value = useMemo<PreferencesContextValue>(
    () => ({
      preferences,
      theme,
      colorScheme,
      setThemeMode,
      setAccentColor,
      setNotesToolbarOrder,
      setCanvasToolbarOrder,
      setChartToolbarOrder,
      setAttachmentsFolder,
      setAutoCreateWikilinkTarget,
      setNewNoteLocation,
      setNewNoteCustomFolder,
      setEditorFontSize,
      setEditorDefaultMode,
      setEditorCloseBrackets,
      setEditorInlineTitle,
      resetPreferences,
      getConfigPath,
      revealConfigFolder,
    }),
    [
      preferences,
      theme,
      colorScheme,
      setThemeMode,
      setAccentColor,
      setNotesToolbarOrder,
      setCanvasToolbarOrder,
      setChartToolbarOrder,
      setAttachmentsFolder,
      setAutoCreateWikilinkTarget,
      setNewNoteLocation,
      setNewNoteCustomFolder,
      setEditorFontSize,
      setEditorDefaultMode,
      setEditorCloseBrackets,
      setEditorInlineTitle,
      resetPreferences,
      getConfigPath,
      revealConfigFolder,
    ],
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
