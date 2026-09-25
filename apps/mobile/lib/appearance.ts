// Apparence de l'interface — pur et testé.
//
// v0.4.30 : un profil complet PAR MODE (clair/sombre) — police, échelle,
// accent, fond, boutons. v0.4.32 (demandes de l'utilisatrice) :
// - PAR COFFRE : chaque coffre possède SON apparence dans
//   `.123ecriture/appearance.json` (dossier caché, jamais synchronisé) ;
//   chaîne de résolution : profil du coffre → profil global (config) →
//   défauts. « La personnalisation de PROGRAMMATION ne sera pas impactée
//   sur DIVERS. »
// - PANNEAUX : couleur + translucidité des surfaces (superbe sur un fond
//   d'écran : les panneaux laissent deviner l'image).
// - ROUE DES COULEURS : conversions HSV↔hex pour le sélecteur dédié.

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
  // Échelle globale de l'interface (1 = 100 %) — zoom CSS racine.
  fontScale: number;
  // Fond quand il n'y a pas d'image (mode 'color').
  backgroundColor: string;
  backgroundMode: 'color' | 'image';
  // Voile d'assombrissement AU-DESSUS de l'image (0 = aucun).
  backgroundDim: number;
  // PANNEAUX (v0.4.32) : couleur des surfaces (cartes, barres) et
  // translucidité (1 = opaque ; 0.6 = l'image transparaît).
  surfaceColor: string;
  surfaceOpacity: number;
  // v0.4.34 (demandes de l'utilisatrice) : bordures, couleur du TEXTE, et
  // fond de l'ÉDITEUR de notes réglables comme tout le reste.
  borderColor: string;
  textColor: string;
  editorBackgroundColor: string;
  buttonStyle: ButtonStyle;
  buttonRadius: number;
};

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

export const FONT_SCALE_MIN = 0.85;
export const FONT_SCALE_MAX = 1.3;
export const BACKGROUND_DIM_MAX = 0.6;
export const BUTTON_RADIUS_MAX = 20;
export const SURFACE_OPACITY_MIN = 0.5;

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

export function clampSurfaceOpacity(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(1, Math.max(SURFACE_OPACITY_MIN, value));
}

// ---- Couleurs : HSV ↔ hex (roue des couleurs) --------------------------
// hsv : h en degrés [0, 360), s/v en [0, 1]. Pur et testé — la roue du
// sélecteur (ColorField) n'est qu'une projection géométrique de ces
// fonctions : angle = teinte, distance au centre = saturation.

export function hsvToHex(h: number, s: number, v: number): string {
  const hh = ((h % 360) + 360) % 360;
  const c = v * Math.max(0, Math.min(1, s));
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = v - c;
  const seg = Math.floor(hh / 60) % 6;
  const rgb: [number, number, number] = [
    [c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x],
  ][seg].map((k) => Math.round((k + m) * 255)) as [number, number, number];
  return '#' + rgb.map((n) => n.toString(16).padStart(2, '0')).join('');
}

export function hexToHsv(hex: string): { h: number; s: number; v: number } {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return { h: 0, s: 0, v: 1 };
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  return { h: ((h % 360) + 360) % 360, s: max === 0 ? 0 : d / max, v: max };
}

// hex → rgba() pour les surfaces translucides (les couleurs RN n'acceptent
// pas #rrggbbaa partout — rgba() est universel sur RNWeb).
export function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${Math.min(1, Math.max(0, alpha))})`;
}

// Mélange deux hex (ratio = part du premier) — sert à dériver le texte
// SECONDAIRE (textMuted) de la couleur de texte choisie : 60 % texte + 40 %
// fond, lisible sur n'importe quelle combinaison sans réglage de plus.
export function mixHex(a: string, b: string, ratio: number): string {
  const pa = /^#?([0-9a-fA-F]{6})$/.exec(a.trim());
  const pb = /^#?([0-9a-fA-F]{6})$/.exec(b.trim());
  if (!pa || !pb) return a;
  const na = parseInt(pa[1], 16);
  const nb = parseInt(pb[1], 16);
  const r0 = Math.min(1, Math.max(0, ratio));
  const mix = (sa: number, sb: number) => Math.round(sa * r0 + sb * (1 - r0));
  const r = mix((na >> 16) & 255, (nb >> 16) & 255);
  const g = mix((na >> 8) & 255, (nb >> 8) & 255);
  const bl = mix(na & 255, nb & 255);
  return '#' + [r, g, bl].map((n) => n.toString(16).padStart(2, '0')).join('');
}

// ---- Profils -----------------------------------------------------------

export const DEFAULT_LIGHT_PROFILE: AppearanceProfile = {
  accentColor: lightTheme.accent,
  fontFamily: 'system',
  fontScale: 1,
  backgroundColor: lightTheme.background,
  backgroundMode: 'color',
  backgroundDim: 0.3,
  surfaceColor: lightTheme.surface,
  surfaceOpacity: 1,
  borderColor: lightTheme.border,
  textColor: lightTheme.text,
  editorBackgroundColor: lightTheme.background,
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
  surfaceColor: darkTheme.surface,
  surfaceOpacity: 1,
  borderColor: darkTheme.border,
  textColor: darkTheme.text,
  editorBackgroundColor: darkTheme.background,
  buttonStyle: 'filled',
  buttonRadius: 10,
};

export function defaultProfile(mode: 'light' | 'dark'): AppearanceProfile {
  return mode === 'dark' ? { ...DEFAULT_DARK_PROFILE } : { ...DEFAULT_LIGHT_PROFILE };
}

export type AppearancePrefsLike = {
  appearanceLight?: Partial<AppearanceProfile>;
  appearanceDark?: Partial<AppearanceProfile>;
  accentColor?: string;
};

// Profil EFFECTIF d'un mode, champ par champ avec repli sur les défauts
// (config ancienne ou incomplète) + migration de l'ancienne accentColor
// unique vers le mode clair.
export function resolveAppearanceProfile(
  prefs: AppearancePrefsLike,
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
    surfaceColor: typeof partial.surfaceColor === 'string' ? partial.surfaceColor : base.surfaceColor,
    surfaceOpacity: clampSurfaceOpacity(partial.surfaceOpacity ?? base.surfaceOpacity),
    borderColor: typeof partial.borderColor === 'string' ? partial.borderColor : base.borderColor,
    textColor: typeof partial.textColor === 'string' ? partial.textColor : base.textColor,
    editorBackgroundColor:
      typeof partial.editorBackgroundColor === 'string' ? partial.editorBackgroundColor : base.editorBackgroundColor,
    buttonStyle: partial.buttonStyle && BUTTON_OPTIONS.some((o) => o.value === partial.buttonStyle) ? partial.buttonStyle : base.buttonStyle,
    buttonRadius: clampRadius(partial.buttonRadius ?? base.buttonRadius),
  };
  if (mode === 'light' && prefs.appearanceLight === undefined && typeof prefs.accentColor === 'string') {
    merged.accentColor = prefs.accentColor;
  }
  return merged;
}

// ---- Fichier d'apparence PAR COFFRE (v0.4.32) --------------------------
// `.123ecriture/appearance.json` : { light?: Partial, dark?: Partial }.
// Partiels : chaque champ absent retombe sur le profil GLOBAL du mode puis
// sur les défauts — un coffre peut n'override que la police, par exemple.

export type VaultAppearanceFile = { light?: Partial<AppearanceProfile>; dark?: Partial<AppearanceProfile> };

export function parseVaultAppearance(raw: string): VaultAppearanceFile | null {
  try {
    const parsed = JSON.parse(raw) as Partial<VaultAppearanceFile>;
    if (!parsed || typeof parsed !== 'object') return null;
    return { light: parsed.light ?? undefined, dark: parsed.dark ?? undefined };
  } catch {
    return null;
  }
}

// Résolution COMPLETE d'un mode avec l'overlay du coffre : coffre → global
// → défauts, champ par champ (le partiel du coffre gagne toujours).
export function resolveProfileWithVault(
  prefs: AppearancePrefsLike,
  vault: VaultAppearanceFile | null,
  mode: 'light' | 'dark',
): AppearanceProfile {
  const global = resolveAppearanceProfile(prefs, mode);
  const overlay = (mode === 'dark' ? vault?.dark : vault?.light) ?? {};
  return {
    ...global,
    ...overlay,
    fontScale: clampFontScale(overlay.fontScale ?? global.fontScale),
    backgroundDim: clampDim(overlay.backgroundDim ?? global.backgroundDim),
    surfaceOpacity: clampSurfaceOpacity(overlay.surfaceOpacity ?? global.surfaceOpacity),
    buttonRadius: clampRadius(overlay.buttonRadius ?? global.buttonRadius),
    backgroundMode: overlay.backgroundMode === 'image' ? 'image' : overlay.backgroundMode === 'color' ? 'color' : global.backgroundMode,
  } as AppearanceProfile;
}

// ---- Tokens + thème ----------------------------------------------------

export type AppearanceTokens = {
  // Fond de l'éditeur de notes (v0.4.34) — absent = fond du mode.
  editorBackground?: string;
  fontStack: string;
  fontScale: number;
  buttonStyle: ButtonStyle;
  buttonRadius: number;
  backgroundMode: 'color' | 'image';
  backgroundDim: number;
  surfaceOpacity: number;
  wallpaper?: string;
};

export function buildAppearanceTokens(profile: AppearanceProfile, wallpaper?: string): AppearanceTokens {
  return {
    editorBackground: profile.editorBackgroundColor,
    fontStack: FONT_STACKS[profile.fontFamily] ?? FONT_STACKS.system,
    fontScale: clampFontScale(profile.fontScale),
    buttonStyle: profile.buttonStyle,
    buttonRadius: clampRadius(profile.buttonRadius),
    backgroundMode: profile.backgroundMode === 'image' && wallpaper ? 'image' : 'color',
    backgroundDim: clampDim(profile.backgroundDim),
    surfaceOpacity: clampSurfaceOpacity(profile.surfaceOpacity),
    wallpaper: profile.backgroundMode === 'image' ? wallpaper : undefined,
  };
}

export function buildTheme(base: Theme, profile: AppearanceProfile, wallpaper?: string): Theme & AppearanceTokens {
  return {
    ...base,
    accent: profile.accentColor,
    background: profile.backgroundMode === 'image' && wallpaper ? base.surface : profile.backgroundColor,
    // Les panneaux deviennent TRANSLUCIDES quand l'opacité baisse : le fond
    // d'écran (ou la couleur de fond) transparaît sous les cartes/barres.
    surface: hexToRgba(profile.surfaceColor, profile.surfaceOpacity),
    // v0.4.34 : bordures et texte réglables ; le texte SECONDAIRE est dérivé
    // (60 % textColor + 40 % fond) pour rester lisible sans réglage de plus.
    border: profile.borderColor,
    text: profile.textColor,
    textMuted: mixHex(profile.textColor, profile.backgroundColor, 0.6),
    ...buildAppearanceTokens(profile, wallpaper),
  };
}
