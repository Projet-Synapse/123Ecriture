import { describe, expect, it } from 'vitest';

import {
  buildAppearanceTokens,
  buildTheme,
  clampDim,
  clampFontScale,
  clampRadius,
  hexToHsv,
  hexToRgba,
  hsvToHex,
  parseVaultAppearance,
  resolveAppearanceProfile,
  resolveProfileWithVault,
  type VaultAppearanceFile,
  FONT_STACKS,
} from './appearance';
import { darkTheme, lightTheme } from '../theme';

// Apparence par mode (v0.4.30) — résolution avec replis (config ancien,
// champs corrompus), bornes des curseurs, construction du thème effectif.

describe('resolveAppearanceProfile', () => {
  it('défauts complets quand rien de configuré', () => {
    const p = resolveAppearanceProfile({}, 'light');
    expect(p.accentColor).toBe(lightTheme.accent);
    expect(p.backgroundMode).toBe('color');
    expect(p.fontFamily).toBe('system');
    expect(resolveAppearanceProfile({}, 'dark').accentColor).toBe(darkTheme.accent);
  });

  it('chaque mode garde SON profil (clair ≠ sombre)', () => {
    const prefs = {
      appearanceLight: { accentColor: '#ff0000' },
      appearanceDark: { accentColor: '#00ff00' },
    };
    expect(resolveAppearanceProfile(prefs, 'light').accentColor).toBe('#ff0000');
    expect(resolveAppearanceProfile(prefs, 'dark').accentColor).toBe('#00ff00');
  });

  it('migration : lancienne accentColor unique devient laccent du mode clair', () => {
    expect(resolveAppearanceProfile({ accentColor: '#123456' }, 'light').accentColor).toBe('#123456');
    expect(resolveAppearanceProfile({ accentColor: '#123456' }, 'dark').accentColor).toBe(darkTheme.accent);
  });

  it('repli champ par champ sur valeurs corrompues', () => {
    const p = resolveAppearanceProfile(
      { appearanceDark: { fontScale: 99, backgroundDim: -3, buttonRadius: 5000, fontFamily: 'inconnue' as never } },
      'dark',
    );
    expect(p.fontScale).toBeLessThanOrEqual(1.3);
    expect(p.backgroundDim).toBeGreaterThanOrEqual(0);
    expect(p.buttonRadius).toBeLessThanOrEqual(20);
    expect(p.fontFamily).toBe('system');
  });
});

describe('bornes', () => {
  it('clampFontScale / clampDim / clampRadius', () => {
    expect(clampFontScale(2)).toBe(1.3);
    expect(clampFontScale(0.1)).toBe(0.85);
    expect(clampFontScale(Number.NaN)).toBe(1);
    expect(clampDim(1)).toBe(0.6);
    expect(clampDim(-1)).toBe(0);
    expect(clampRadius(50)).toBe(20);
    expect(clampRadius(-5)).toBe(0);
  });
});

describe('buildAppearanceTokens / buildTheme', () => {
  it('tokens : pile CSS selon la police, mode image seulement avec papier', () => {
    const t = buildAppearanceTokens(
      { ...resolveAppearanceProfile({}, 'light'), fontFamily: 'georgia', backgroundMode: 'image' },
      'data:image/png;base64,abc',
    );
    expect(t.fontStack).toBe(FONT_STACKS.georgia);
    expect(t.backgroundMode).toBe('image');
    expect(t.wallpaper).toBe('data:image/png;base64,abc');
    // sans image -> retombée couleur, pas de wallpaper fantôme
    const sans = buildAppearanceTokens({ ...resolveAppearanceProfile({}, 'light'), backgroundMode: 'image' });
    expect(sans.backgroundMode).toBe('color');
    expect(sans.wallpaper).toBeUndefined();
  });

  it('buildTheme : accent et fond du profil écrasent la palette de base', () => {
    const profil = resolveAppearanceProfile(
      { appearanceLight: { accentColor: '#e11d48', backgroundColor: '#faf5ff' } },
      'light',
    );
    const theme = buildTheme(lightTheme, profil);
    expect(theme.accent).toBe('#e11d48');
    expect(theme.background).toBe('#faf5ff');
    expect(theme.text).toBe(lightTheme.text);
    expect(theme.fontStack).toBe(FONT_STACKS.system);
  });
});

describe('HSV <-> hex (roue des couleurs)', () => {
  it('conversions aller-retour', () => {
    for (const hex of ['#4f46e5', '#dc2626', '#0d9488', '#111114', '#ffffff', '#000000']) {
      const { h, s, v } = hexToHsv(hex);
      expect(hsvToHex(h, s, v)).toBe(hex);
    }
  });

  it('hsvToHex : primaires', () => {
    expect(hsvToHex(0, 1, 1)).toBe('#ff0000');
    expect(hsvToHex(120, 1, 1)).toBe('#00ff00');
    expect(hsvToHex(240, 1, 1)).toBe('#0000ff');
  });

  it('hexToRgba : alpha applique', () => {
    expect(hexToRgba('#ff8800', 0.5)).toBe('rgba(255, 136, 0, 0.5)');
    expect(hexToRgba('#102030', 1)).toBe('rgba(16, 32, 48, 1)');
  });
});

describe('Apparence PAR COFFRE (v0.4.32)', () => {
  it('l overlay du coffre gagne champ par champ, le reste retombe sur le global', () => {
    const prefs = { appearanceLight: { accentColor: '#2563eb' } };
    const vault: VaultAppearanceFile = { light: { fontFamily: 'georgia', surfaceOpacity: 0.7 } };
    const p = resolveProfileWithVault(prefs, vault, 'light');
    expect(p.fontFamily).toBe('georgia');
    expect(p.accentColor).toBe('#2563eb');
    expect(p.surfaceOpacity).toBe(0.7);
    expect(p.fontScale).toBe(1);
  });

  it('sans fichier de coffre = profil global', () => {
    const prefs = { appearanceDark: { accentColor: '#00ff00' } };
    expect(resolveProfileWithVault(prefs, null, 'dark').accentColor).toBe('#00ff00');
  });

  it('parseVaultAppearance : JSON valide/invalide', () => {
    expect(parseVaultAppearance('{"light":{"fontFamily":"serif"}}')).toEqual({ light: { fontFamily: 'serif' }, dark: undefined });
    expect(parseVaultAppearance('pas du tout json')).toBeNull();
  });

  it('buildTheme : surface translucide via rgba', () => {
    const profil = resolveProfileWithVault({}, { light: { surfaceColor: '#ff0000', surfaceOpacity: 0.6 } }, 'light');
    const t = buildTheme(lightTheme, profil);
    expect(t.surface).toBe('rgba(255, 0, 0, 0.6)');
  });
});
