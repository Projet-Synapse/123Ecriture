// Apparence de l'interface PAR MODE (v0.4.30) — pur et testé.
//
// Chaque mode (clair, sombre) possède son PROPRE profil complet : police
// globale, échelle, couleur d'accent, fond (couleur ou image + voile), style
// et rayon des boutons. La demande de l'utilisatrice : « Je peux enregistrer
// une apparence distincte pour le mode sombre et pour le mode clair ».
// La résolution profil→thème (buildTheme) et les bornes de sécurité vivent
// ici ; la persistance passe par les préférences, l'image de fond par un
// pont dédié (fichier dans le dossier de configuration).

import { darkTheme, lightTheme, type Theme } from '../theme';

export type AppFontFamily =
  | 'system'
  | 'serif'
  | 'rounded'
  | 'monospace'
  | 'georgia'
  | 'verdana'
  | 'trebuchet'
  | 'courier';

export type ButtonStyle = 'filled' | 'outline' | 'ghost';

export type AppearanceProfile = {
  accentColor: string;
  fontFamily: AppFontFamily;
  // Échelle globale de l'interface (1 = 100 %). Appliquée en `zoom` CSS sur
  // la racine : proportionnelle, jamais de texte tronqué.
  fontScale: number;
  // Fond quand il n'y a pas d'image (mode 'color').
  backgroundColor: string;
  backgroundMode: 'color' | 'image';
  // Voile d'assombrissement AU-DESSUS de l'image (0 = aucun) — la
  // lisibilité du texte prime sur le fond d'écran.
  backgroundDim: number;
  buttonStyle: ButtonStyle;
  buttonRadius: number;
};

// Piles CSS réelles — les noms cotés sont sûrs sur toutes les plateformes
// (polices système universelles), rien à télécharger.
export const FONT_STACKS: Record<AppFontFamily, string> = {
  system:
    'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  serif: 'Georgia, "Times New Roman", Times, serif',
  rounded: '"Segoe UI", ui-rounded, "SF Pro Rounded", system-ui, sans-serif',
  monospace: 'ui-monospace, Consolas, "Courier New", monospace',
  georgia: 'Georgia, "Times New Roman", serif',
  verdana: 'Verdana, Geneva, sans-serif',
  trebuchet: '"Trebuchet MS", Tahoma, sans-serif',
  courier: '"Courier New", Courier, monospace',
};

export const FONT_OPTIONS: { value: AppFontFamily; label: string }[] = [
  { value: 'system', label: 'Système' },
  { value: 'serif', label: 'Serif' },
  { value: 'rounded', label: 'Arrondie' },
  { value: 'monospace', label: 'Monospace' },
  { value: 'georgia', label: 'Georgia' },
  { value: 'verdana', label: 'Verdana' },
  { value: 'trebuchet', label: 'Trebuchet' },
  { value: 'courier', label: 'Courier' },
];

export const BUTTON_OPTIONS: { value: ButtonStyle; label: string }[] = [
  { value: 'filled', label: 'Rempli' },
  { value: 'outline', label: 'Contour' },
  { value: 'ghost', label: 'Discret' },
];

// Bornes de sécurité pour les curseurs — clampValue protège aussi les
// valeurs corrompues lues depuis un config.json édité à la main.
export const FONT_SCALE_MIN = 0.85;
export const FONT_SCALE_MAX = 1.3;
export const BACKGROUND_DIM_MAX = 0.6;
export const BUTTON_RADIUS_MAX = 20;

export function clampFontScale(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, value));
}

export function clampDim(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(BACKGROUND_DIM_MAX, Math.max(0, value));
}

export function clampRadius(value: number): number {
  if (!Number.isFinite(value)) return 10;
  return Math.min(BUTTON_RADIUS_MAX, Math.max(0, value));
}

export const DEFAULT_LIGHT_PROFILE: AppearanceProfile = {
  accentColor: lightTheme.accent,
  fontFamily: 'system',
  fontScale: 1,
  backgroundColor: lightTheme.background,
  backgroundMode: 'color',
  backgroundDim: 0.3,
  buttonStyle: 'filled',
  buttonRadius: 10,
};

export const DEFAULT_DARK_PROFILE: AppearanceProfile = {
  accentColor: darkTheme.accent,
  fontFamily: 'system',
  fontScale: 1,
  backgroundColor: darkTheme.background,
  backgroundMode: 'color',
  backgroundDim: 0.3,
  buttonStyle: 'filled',
  buttonRadius: 10,
};

export function defaultProfile(mode: 'light' | 'dark'): AppearanceProfile {
  return mode === 'dark' ? { ...DEFAULT_DARK_PROFILE } : { ...DEFAULT_LIGHT_PROFILE };
}

// Profil EFFECTIF d'un mode, avec repli sur les défauts champ par champ
// (config.json d'une version antérieure = profil absent ou incomplet) et
// migration de l'ancienne préférence unique `accentColor` vers le mode
// clair (elle datait de l'époque « un seul accent pour tout »).
export function resolveAppearanceProfile(
  prefs: { appearanceLight?: Partial<AppearanceProfile>; appearanceDark?: Partial<AppearanceProfile>; accentColor?: string },
  mode: 'light' | 'dark',
): AppearanceProfile {
  const base = defaultProfile(mode);
  const partial = (mode === 'dark' ? prefs.appearanceDark : prefs.appearanceLight) ?? {};
  const merged: AppearanceProfile = {
    accentColor: typeof partial.accentColor === 'string' ? partial.accentColor : base.accentColor,
    fontFamily: partial.fontFamily && partial.fontFamily in FONT_STACKS ? partial.fontFamily : base.fontFamily,
    fontScale: clampFontScale(partial.fontScale ?? base.fontScale),
    backgroundColor: typeof partial.backgroundColor === 'string' ? partial.backgroundColor : base.backgroundColor,
    backgroundMode: partial.backgroundMode === 'image' ? 'image' : 'color',
    backgroundDim: clampDim(partial.backgroundDim ?? base.backgroundDim),
    buttonStyle: partial.buttonStyle && BUTTON_OPTIONS.some((o) => o.value === partial.buttonStyle) ? partial.buttonStyle : base.buttonStyle,
    buttonRadius: clampRadius(partial.buttonRadius ?? base.buttonRadius),
  };
  if (mode === 'light' && prefs.appearanceLight === undefined && typeof prefs.accentColor === 'string') {
    merged.accentColor = prefs.accentColor;
  }
  return merged;
}

// Tokens d'apparence portés par le thème consommé partout (via
// usePreferences().theme) — la police en pile CSS prête à injecter.
export type AppearanceTokens = {
  fontStack: string;
  fontScale: number;
  buttonStyle: ButtonStyle;
  buttonRadius: number;
  backgroundMode: 'color' | 'image';
  backgroundDim: number;
  // dataURL de l'image de fond du mode (chargée par le pont) — absente en
  // mode couleur ou sans image.
  wallpaper?: string;
};

export function buildAppearanceTokens(profile: AppearanceProfile, wallpaper?: string): AppearanceTokens {
  return {
    fontStack: FONT_STACKS[profile.fontFamily] ?? FONT_STACKS.system,
    fontScale: clampFontScale(profile.fontScale),
    buttonStyle: profile.buttonStyle,
    buttonRadius: clampRadius(profile.buttonRadius),
    backgroundMode: profile.backgroundMode === 'image' && wallpaper ? 'image' : 'color',
    backgroundDim: clampDim(profile.backgroundDim),
    wallpaper: profile.backgroundMode === 'image' ? wallpaper : undefined,
  };
}

// Thème effectif = palette de base du mode + profil d'apparence (accent,
// fond) + tokens. C'est LA seule usine à thème de l'app.
export function buildTheme(base: Theme, profile: AppearanceProfile, wallpaper?: string): Theme & AppearanceTokens {
  return {
    ...base,
    accent: profile.accentColor,
    background: profile.backgroundMode === 'image' && wallpaper ? base.surface : profile.backgroundColor,
    ...buildAppearanceTokens(profile, wallpaper),
  };
}
