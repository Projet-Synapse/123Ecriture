// ✒️ 123ECRITURE — lib/theme/explorerColors.ts — fond de l'explorateur et lignes de guidage lisibles
//////////////////////////////////////////////////////////////////////////////
//
// Réglage « Fond de l'explorateur de fichiers » (Paramètres →
// Personnalisation) : couleur au choix (préréglages + roue), persistée par
// coffre et par mode, réinitialisable. Ce module (PUR, testé) dérive de ce
// fond tout ce qui doit rester lisible dans l'explorateur :
//   • les LIGNES DE GUIDAGE de profondeur (rails d'arborescence) : plus
//     SOMBRES sur fond clair, plus CLAIRES sur fond sombre, avec un
//     contraste minimal garanti (GUIDE_MIN_CONTRAST). Avant : couleur des
//     bordures à 55 % d'opacité — #e5e7eb sur #f5f5f7, un contraste de
//     ~1,1:1, quasi invisible ;
//   • le texte et le texte secondaire : la couleur du thème est gardée si
//     elle reste lisible (WCAG ≥ 4,5:1 / 3:1), sinon remplacée par un
//     quasi-noir / quasi-blanc ;
//   • les fonds de survol / sélection : teinte d'accent dosée selon la
//     luminosité du fond.
//
//////////////////////////////////////////////////////////////////////////////

export const GUIDE_MIN_CONTRAST = 1.9;
const TEXT_MIN_CONTRAST = 4.5;
const MUTED_MIN_CONTRAST = 3;

export const EXPLORER_BG_PRESETS_LIGHT = ['#ffffff', '#f5f5f7', '#faf7f0', '#f1e9da', '#e8f3ec', '#e7f0fa', '#efeaf8', '#fdecef'];
export const EXPLORER_BG_PRESETS_DARK = ['#111114', '#1c1c22', '#1b1f27', '#2b3038', '#1f2a24', '#1e2638', '#2a2130', '#2b2420'];

type Rgb = { r: number; g: number; b: number };

// #rgb, #rrggbb, #rrggbbaa, rgb()/rgba() → canaux 0-255 (alpha ignoré : les
// panneaux translucides sont approchés par leur couleur pleine).
export function parseColor(input: string | null | undefined): Rgb | null {
  if (!input) return null;
  const s = input.trim();
  let m = /^#([0-9a-f]{3})$/i.exec(s);
  if (m) {
    const [r, g, b] = m[1].split('').map((c) => parseInt(c + c, 16));
    return { r, g, b };
  }
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(s);
  if (m) {
    const n = parseInt(m[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  m = /^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)/i.exec(s);
  if (m) return { r: Math.min(255, +m[1]), g: Math.min(255, +m[2]), b: Math.min(255, +m[3]) };
  return null;
}

export function isValidColor(input: string | null | undefined): input is string {
  return parseColor(input) !== null;
}

function toHex({ r, g, b }: Rgb): string {
  return '#' + [r, g, b].map((n) => Math.round(n).toString(16).padStart(2, '0')).join('');
}

// Luminance relative WCAG 2.x.
export function relativeLuminance(color: string): number {
  const rgb = parseColor(color);
  if (!rgb) return 1;
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(rgb.r) + 0.7152 * lin(rgb.g) + 0.0722 * lin(rgb.b);
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// Fond « sombre » : le blanc y contraste plus que le noir.
export function isDarkColor(color: string): boolean {
  return contrastRatio(color, '#ffffff') > contrastRatio(color, '#000000');
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t };
}

// Ligne de guidage : le fond poussé vers le noir (fond clair) ou le blanc
// (fond sombre) juste assez pour atteindre GUIDE_MIN_CONTRAST — visible
// sans devenir une grille dure.
export function indentGuideColor(background: string): string {
  const bg = parseColor(background) ?? { r: 245, g: 245, b: 247 };
  const bgHex = toHex(bg);
  const target = isDarkColor(bgHex) ? { r: 255, g: 255, b: 255 } : { r: 0, g: 0, b: 0 };
  for (let t = 0.18; t <= 1; t += 0.02) {
    const candidate = toHex(mix(bg, target, t));
    if (contrastRatio(candidate, bgHex) >= GUIDE_MIN_CONTRAST) return candidate;
  }
  return toHex(target);
}

// Couleur de texte lisible : `preferred` si elle atteint `min`, sinon le
// quasi-noir / quasi-blanc le plus contrasté.
export function readableOn(background: string, preferred: string, min = TEXT_MIN_CONTRAST): string {
  if (isValidColor(preferred) && contrastRatio(preferred, background) >= min) return preferred;
  return isDarkColor(background) ? '#f5f5f7' : '#111114';
}

export type ExplorerColors = {
  background: string;
  text: string;
  textMuted: string;
  guide: string;
  // Fonds de ligne : note/dossier actif, sélection multiple / dépôt.
  activeRow: string;
  selectedRow: string;
};

function withAlpha(color: string, alpha: number): string {
  const rgb = parseColor(color);
  if (!rgb) return color;
  return `rgba(${Math.round(rgb.r)}, ${Math.round(rgb.g)}, ${Math.round(rgb.b)}, ${alpha})`;
}

// `custom` absent / invalide → fond actuel des panneaux (comportement
// historique), mais les lignes de guidage deviennent visibles quand même.
export function buildExplorerColors(
  theme: { surface: string; text: string; textMuted: string; accent: string },
  custom?: string | null,
): ExplorerColors {
  const background = isValidColor(custom) ? custom.trim() : theme.surface;
  const dark = isDarkColor(toHex(parseColor(background) ?? { r: 245, g: 245, b: 247 }));
  const text = readableOn(background, theme.text, TEXT_MIN_CONTRAST);
  const textMuted = readableOn(background, theme.textMuted, MUTED_MIN_CONTRAST);
  return {
    background,
    text,
    // Texte secondaire illisible → dérivé du texte retenu (mêmes règles
    // que le thème : moins appuyé, toujours ≥ 3:1).
    textMuted: textMuted === theme.textMuted ? textMuted : dark ? '#c4c4cc' : '#4b4b55',
    guide: indentGuideColor(background),
    activeRow: withAlpha(theme.accent, dark ? 0.3 : 0.16),
    selectedRow: withAlpha(theme.accent, dark ? 0.42 : 0.24),
  };
}
