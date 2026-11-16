import { describe, expect, it } from 'vitest';

import {
  buildExplorerColors,
  contrastRatio,
  EXPLORER_BG_PRESETS_DARK,
  EXPLORER_BG_PRESETS_LIGHT,
  GUIDE_MIN_CONTRAST,
  indentGuideColor,
  isDarkColor,
  parseColor,
  relativeLuminance,
} from './explorerColors';
import { darkTheme, lightTheme } from '../../theme';

describe('couleurs', () => {
  it('parse hex court/long/alpha et rgba()', () => {
    expect(parseColor('#fff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseColor('#11223344')).toEqual({ r: 0x11, g: 0x22, b: 0x33 });
    expect(parseColor('rgba(28, 28, 34, 0.8)')).toEqual({ r: 28, g: 28, b: 34 });
    expect(parseColor('pas une couleur')).toBeNull();
  });
  it('contraste WCAG', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0);
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1);
    expect(isDarkColor('#1c1c22')).toBe(true);
    expect(isDarkColor('#f5f5f7')).toBe(false);
  });
});

describe('lignes de guidage', () => {
  it('plus sombres sur fond clair, plus claires sur fond sombre', () => {
    const onLight = indentGuideColor('#f5f5f7');
    const onDark = indentGuideColor('#1c1c22');
    expect(relativeLuminance(onLight)).toBeLessThan(relativeLuminance('#f5f5f7'));
    expect(relativeLuminance(onDark)).toBeGreaterThan(relativeLuminance('#1c1c22'));
  });
  it('contraste minimal garanti sur tous les préréglages (avant : ~1,1:1)', () => {
    expect(contrastRatio('#e5e7eb', '#f5f5f7')).toBeLessThan(1.2);
    for (const bg of [...EXPLORER_BG_PRESETS_LIGHT, ...EXPLORER_BG_PRESETS_DARK, '#808080', '#ff0000']) {
      expect(contrastRatio(indentGuideColor(bg), bg)).toBeGreaterThanOrEqual(GUIDE_MIN_CONTRAST);
    }
  });
});

describe('buildExplorerColors', () => {
  it('sans réglage : fond des panneaux, texte du thème conservé', () => {
    const c = buildExplorerColors(lightTheme);
    expect(c.background).toBe(lightTheme.surface);
    expect(c.text).toBe(lightTheme.text);
    expect(c.textMuted).toBe(lightTheme.textMuted);
  });
  it('fond sombre en thème clair : texte basculé en clair, lisible', () => {
    const c = buildExplorerColors(lightTheme, '#1b1f27');
    expect(c.background).toBe('#1b1f27');
    expect(contrastRatio(c.text, c.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(c.textMuted, c.background)).toBeGreaterThanOrEqual(3);
    expect(isDarkColor(c.text)).toBe(false);
  });
  it('fond clair en thème sombre : texte basculé en sombre', () => {
    const c = buildExplorerColors(darkTheme, '#faf7f0');
    expect(contrastRatio(c.text, c.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(c.textMuted, c.background)).toBeGreaterThanOrEqual(3);
  });
  it('couleur invalide → repli sur les panneaux', () => {
    expect(buildExplorerColors(darkTheme, 'n’importe quoi').background).toBe(darkTheme.surface);
  });
  it('sélection plus appuyée sur fond sombre', () => {
    expect(buildExplorerColors(lightTheme, '#1b1f27').selectedRow).toMatch(/0\.42\)$/);
    expect(buildExplorerColors(lightTheme, '#ffffff').selectedRow).toMatch(/0\.24\)$/);
  });
});

describe('réglage persistant (profil d’apparence)', () => {
  it('fond valide repris, invalide ou réinitialisé (null) → défaut ; le thème porte les couleurs', async () => {
    const { buildTheme, resolveAppearanceProfile, resolveProfileWithVault } = await import('./appearance');
    expect(resolveAppearanceProfile({ appearanceLight: { explorerBackgroundColor: '#1b1f27' } }, 'light').explorerBackgroundColor).toBe(
      '#1b1f27',
    );
    expect(resolveAppearanceProfile({ appearanceLight: { explorerBackgroundColor: 'bleu' } }, 'light').explorerBackgroundColor).toBeNull();
    const reset = resolveProfileWithVault(
      { appearanceLight: { explorerBackgroundColor: '#1b1f27' } },
      { light: { explorerBackgroundColor: null } },
      'light',
    );
    expect(reset.explorerBackgroundColor).toBeNull();
    const theme = buildTheme(lightTheme, resolveProfileWithVault({}, { light: { explorerBackgroundColor: '#1b1f27' } }, 'light'));
    expect(theme.explorer?.background).toBe('#1b1f27');
    expect(contrastRatio(theme.explorer!.guide, '#1b1f27')).toBeGreaterThanOrEqual(GUIDE_MIN_CONTRAST);
    expect(buildTheme(lightTheme, resolveAppearanceProfile({}, 'light')).explorer?.background).toMatch(/^rgba\(245, 245, 247/);
  });
});
