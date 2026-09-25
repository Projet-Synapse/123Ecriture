import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  BUTTON_OPTIONS,
  FONT_OPTIONS,
  FONT_STACKS,
  defaultProfile,
  resolveAppearanceProfile,
  type AppearanceProfile,
  type ButtonStyle,
} from '../lib/appearance';
import { usePreferences } from '../preferences/PreferencesContext';

const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

// Section « Personnalisation » (v0.4.30 refondu) : UNE apparence complète
// PAR MODE — chaque onglet (☀️ Clair / 🌙 Sombre) édite son propre profil :
// police globale, échelle de l'interface, couleur d'accent, fond (couleur
// ou image importée + voile de lisibilité), style et rayon des boutons.
// « Mode actif » (système/clair/sombre) reste global ; les profils se
// règlent indépendamment, y compris à l'avance (préparer le mode sombre
// pendant qu'on lit en clair). L'éditeur de notes garde ses propres
// polices (Paramètres → Éditeur) : elles priment sur la police globale.
const THEME_MODE_OPTIONS: { mode: ThemeMode; label: string }[] = [
  { mode: 'system', label: 'Système' },
  { mode: 'light', label: 'Clair' },
  { mode: 'dark', label: 'Sombre' },
];

// Palettes resserrées plutôt que sélecteur libre — rapides à parcourir et
// pré-visées pour rester lisibles ; le champ #rrggbb reste là pour sortir
// des sentiers battus.
const ACCENT_PRESETS = ['#4f46e5', '#2563eb', '#0d9488', '#16a34a', '#d97706', '#dc2626', '#db2777', '#7c3aed'];
const LIGHT_BG_PRESETS = ['#ffffff', '#f5f5f7', '#faf5ff', '#f0fdf4', '#fff7ed', '#f0f9ff', '#fef2f2', '#fdf4ff'];
const DARK_BG_PRESETS = ['#111114', '#1c1c22', '#0f172a', '#111827', '#1e1b1b', '#141c14', '#1c1420', '#0c0c10'];
const SCALE_OPTIONS = [0.85, 1, 1.15, 1.3];
const RADIUS_OPTIONS = [0, 6, 10, 14, 20];
const DIM_OPTIONS = [0, 0.15, 0.3, 0.45, 0.6];

type EditableMode = 'light' | 'dark';

export function PersonalizationCard() {
  const {
    preferences,
    theme,
    colorScheme,
    wallpapers,
    setThemeMode,
    setAppearance,
    importWallpaper,
    clearWallpaper,
  } = usePreferences();

  // Onglet édité : le mode SÉLECTIONNÉ, indépendant du mode actif — on peut
  // régler le mode sombre pendant qu'on lit en clair.
  const [mode, setMode] = useState<EditableMode>(colorScheme);
  const profile = resolveAppearanceProfile(preferences, mode);
  const wallpaper = wallpapers[mode];
  const canWallpaper = typeof window !== 'undefined' && Boolean(window.appearance?.importWallpaper);

  const [hexDraft, setHexDraft] = useState(profile.accentColor);
  const [hexError, setHexError] = useState(false);
  const [bgDraft, setBgDraft] = useState(profile.backgroundColor);
  const [bgError, setBgError] = useState(false);
  const [synced, setSynced] = useState({ accent: profile.accentColor, bg: profile.backgroundColor, mode });
  if (synced.mode !== mode || synced.accent !== profile.accentColor || synced.bg !== profile.backgroundColor) {
    setSynced({ accent: profile.accentColor, bg: profile.backgroundColor, mode });
    if (synced.mode !== mode || synced.accent !== profile.accentColor) setHexDraft(profile.accentColor);
    if (synced.mode !== mode || synced.bg !== profile.backgroundColor) setBgDraft(profile.backgroundColor);
    setHexError(false);
    setBgError(false);
  }

  const patch = (p: Partial<AppearanceProfile>) => void setAppearance(mode, p);

  const submitHexColor = () => {
    const trimmed = hexDraft.trim();
    if (!HEX_COLOR_PATTERN.test(trimmed)) {
      setHexError(true);
      return;
    }
    setHexError(false);
    patch({ accentColor: trimmed });
  };

  const submitBgColor = () => {
    const trimmed = bgDraft.trim();
    if (!HEX_COLOR_PATTERN.test(trimmed)) {
      setBgError(true);
      return;
    }
    setBgError(false);
    patch({ backgroundColor: trimmed });
  };

  // Style des puces selon le profil ÉDITÉ (pas le thème actif) —
  // « Rempli » : fond accent ; « Contour » : bordure accent ; « Discret » :
  // souligné. Le rayon suit le profil.
  const chip = (active: boolean) => {
    const base = { borderRadius: profile.buttonRadius, borderWidth: 1, paddingVertical: 6, paddingHorizontal: 14 };
    if (!active) return [base, { borderColor: theme.border, backgroundColor: 'transparent' }];
    if (profile.buttonStyle === 'filled') return [base, { borderColor: profile.accentColor, backgroundColor: profile.accentColor }];
    if (profile.buttonStyle === 'outline') return [base, { borderColor: profile.accentColor, backgroundColor: 'transparent' }];
    return [base, { borderColor: 'transparent', backgroundColor: 'transparent', textDecorationLine: 'underline' as const }];
  };
  const chipText = (active: boolean): { color: string } => ({
    color: active && profile.buttonStyle === 'filled' ? '#ffffff' : theme.text,
  });

  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <Text style={[styles.cardTitle, { color: theme.text }]}>🎨 Personnalisation</Text>

      <Text style={[styles.label, { color: theme.textMuted }]}>Mode actif</Text>
      <View style={styles.row}>
        {THEME_MODE_OPTIONS.map((option) => {
          const isActive = preferences.themeMode === option.mode;
          return (
            <Pressable
              key={option.mode}
              onPress={() => void setThemeMode(option.mode)}
              style={[styles.modeButton, { borderColor: theme.border }, isActive && { backgroundColor: theme.accent, borderColor: theme.accent }]}
            >
              <Text style={{ color: isActive ? '#fff' : theme.text }}>{option.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {/* ---- Onglets : le profil édité ---- */}
      <Text style={[styles.label, { color: theme.textMuted }]}>Apparence du mode (réglée indépendamment)</Text>
      <View style={styles.row}>
        {([['light', '☀️ Clair'], ['dark', '🌙 Sombre']] as const).map(([value, label]) => {
          const isActive = mode === value;
          return (
            <Pressable key={value} onPress={() => setMode(value)} style={chip(isActive)}>
              <Text style={chipText(isActive)}>
                {label}
                {colorScheme === value ? '  (actif)' : ''}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {mode !== colorScheme && (
        <Text style={[styles.hint, { color: theme.textMuted }]}>
          Tu prépares l&apos;apparence du mode {mode === 'dark' ? 'sombre' : 'clair'} — passe le mode actif dessus pour la voir en direct.
        </Text>
      )}

      {/* ---- Police globale ---- */}
      <Text style={[styles.label, { color: theme.textMuted }]}>Police de l&apos;interface</Text>
      <View style={styles.row}>
        {FONT_OPTIONS.map((option) => (
          <Pressable key={option.value} onPress={() => patch({ fontFamily: option.value })} style={chip(profile.fontFamily === option.value)}>
            <Text style={[chipText(profile.fontFamily === option.value), { fontFamily: FONT_STACKS[option.value] }]}>{option.label}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={[styles.label, { color: theme.textMuted }]}>Échelle de l&apos;interface</Text>
      <View style={styles.row}>
        {SCALE_OPTIONS.map((value) => (
          <Pressable key={value} onPress={() => patch({ fontScale: value })} style={chip(profile.fontScale === value)}>
            <Text style={chipText(profile.fontScale === value)}>{Math.round(value * 100)} %</Text>
          </Pressable>
        ))}
      </View>

      {/* ---- Couleur d&apos;accent ---- */}
      <Text style={[styles.label, { color: theme.textMuted }]}>Couleur d&apos;accent</Text>
      <View style={styles.row}>
        {ACCENT_PRESETS.map((color) => {
          const isActive = profile.accentColor.toLowerCase() === color.toLowerCase();
          return (
            <Pressable
              key={color}
              onPress={() => patch({ accentColor: color })}
              style={[styles.swatch, { backgroundColor: color }, isActive && styles.swatchActive]}
            >
              {isActive && <Text style={styles.swatchCheck}>✓</Text>}
            </Pressable>
          );
        })}
        <TextInput
          value={hexDraft}
          onChangeText={(text) => {
            setHexDraft(text);
            setHexError(false);
          }}
          onSubmitEditing={submitHexColor}
          onBlur={submitHexColor}
          placeholder="#rrggbb"
          placeholderTextColor={theme.textMuted}
          style={[styles.hexInput, { color: theme.text, borderColor: hexError ? theme.danger : theme.border }]}
        />
      </View>
      {hexError && (
        <Text style={[styles.hexError, { color: theme.danger }]}>⚠️ Couleur invalide — format attendu : #rrggbb</Text>
      )}

      {/* ---- Fond ---- */}
      <Text style={[styles.label, { color: theme.textMuted }]}>Fond du mode</Text>
      <View style={styles.row}>
        <Pressable onPress={() => patch({ backgroundMode: 'color' })} style={chip(profile.backgroundMode === 'color')}>
          <Text style={chipText(profile.backgroundMode === 'color')}>Couleur</Text>
        </Pressable>
        {canWallpaper && (
          <Pressable onPress={() => patch({ backgroundMode: 'image' })} style={chip(profile.backgroundMode === 'image')}>
            <Text style={chipText(profile.backgroundMode === 'image')}>Image</Text>
          </Pressable>
        )}
      </View>

      {profile.backgroundMode === 'image' && canWallpaper ? (
        <>
          <View style={styles.row}>
            <Pressable
              onPress={() =>
                void importWallpaper(mode).then((ok) => {
                  if (ok) patch({ backgroundMode: 'image' });
                })
              }
              style={chip(false)}
            >
              <Text style={chipText(false)}>📥 Importer une image…</Text>
            </Pressable>
            {wallpaper && (
              <Pressable onPress={() => void clearWallpaper(mode)} style={chip(false)}>
                <Text style={{ color: theme.danger }}>Retirer l&apos;image</Text>
              </Pressable>
            )}
          </View>
          {wallpaper ? (
            <View style={styles.wallpaperPreviewWrap}>
              <View style={styles.wallpaperPreviewBox}>
                <Image source={{ uri: wallpaper }} style={styles.wallpaperPreview} resizeMode="cover" />
                <View style={[styles.wallpaperPreviewDim, { opacity: profile.backgroundDim }]} />
              </View>
              <Text style={[styles.hint, { color: theme.textMuted }]}>
                Aperçu — voile {Math.round(profile.backgroundDim * 100)} %
              </Text>
            </View>
          ) : (
            <Text style={[styles.hint, { color: theme.textMuted }]}>Aucune image pour ce mode — importe-en une (12 Mo max).</Text>
          )}
          <Text style={[styles.label, { color: theme.textMuted }]}>Voile de lisibilité (assombrit l&apos;image sous le texte)</Text>
          <View style={styles.row}>
            {DIM_OPTIONS.map((value) => (
              <Pressable key={value} onPress={() => patch({ backgroundDim: value })} style={chip(profile.backgroundDim === value)}>
                <Text style={chipText(profile.backgroundDim === value)}>{Math.round(value * 100)} %</Text>
              </Pressable>
            ))}
          </View>
        </>
      ) : (
        <>
          <View style={styles.row}>
            {(mode === 'dark' ? DARK_BG_PRESETS : LIGHT_BG_PRESETS).map((color) => {
              const isActive = profile.backgroundColor.toLowerCase() === color.toLowerCase();
              return (
                <Pressable
                  key={color}
                  onPress={() => patch({ backgroundColor: color })}
                  style={[styles.swatch, { backgroundColor: color, borderWidth: 1, borderColor: theme.border }, isActive && styles.swatchActive]}
                >
                  {isActive && <Text style={[styles.swatchCheck, { color: mode === 'dark' ? '#fff' : '#111' }]}>✓</Text>}
                </Pressable>
              );
            })}
            <TextInput
              value={bgDraft}
              onChangeText={(text) => {
                setBgDraft(text);
                setBgError(false);
              }}
              onSubmitEditing={submitBgColor}
              onBlur={submitBgColor}
              placeholder="#rrggbb"
              placeholderTextColor={theme.textMuted}
              style={[styles.hexInput, { color: theme.text, borderColor: bgError ? theme.danger : theme.border }]}
            />
          </View>
          {bgError && (
            <Text style={[styles.hexError, { color: theme.danger }]}>⚠️ Couleur invalide — format attendu : #rrggbb</Text>
          )}
          {!canWallpaper && (
            <Text style={[styles.hint, { color: theme.textMuted }]}>
              Fond en image disponible sur la version bureau uniquement.
            </Text>
          )}
        </>
      )}

      {/* ---- Boutons ---- */}
      <Text style={[styles.label, { color: theme.textMuted }]}>Boutons — style</Text>
      <View style={styles.row}>
        {BUTTON_OPTIONS.map((option) => (
          <Pressable key={option.value} onPress={() => patch({ buttonStyle: option.value as ButtonStyle })} style={chip(profile.buttonStyle === option.value)}>
            <Text style={chipText(profile.buttonStyle === option.value)}>{option.label}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={[styles.label, { color: theme.textMuted }]}>Boutons — arrondi des coins</Text>
      <View style={styles.row}>
        {RADIUS_OPTIONS.map((value) => (
          <Pressable key={value} onPress={() => patch({ buttonRadius: value })} style={chip(profile.buttonRadius === value)}>
            <Text style={chipText(profile.buttonRadius === value)}>{value === 0 ? 'Droit' : `${value} px`}</Text>
          </Pressable>
        ))}
      </View>

      <Pressable
        onPress={() => void setAppearance(mode, defaultProfile(mode))}
        style={[styles.modeButton, { borderColor: theme.border, marginTop: 6 }]}
      >
        <Text style={{ color: theme.text }}>↩︎ Réinitialiser ce mode</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    gap: 10,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  label: {
    fontSize: 12,
    marginTop: 4,
  },
  hint: {
    fontSize: 12,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    alignItems: 'center',
  },
  modeButton: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1,
  },
  swatch: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swatchActive: {
    borderWidth: 2,
    borderColor: '#fff',
  },
  swatchCheck: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  hexInput: {
    width: 100,
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    fontSize: 13,
  },
  hexError: {
    fontSize: 12,
  },
  wallpaperPreviewWrap: {
    gap: 6,
  },
  wallpaperPreviewBox: {
    height: 120,
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 1,
  },
  wallpaperPreview: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    width: '100%',
    height: '100%',
  },
  wallpaperPreviewDim: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#000000',
  },
});
