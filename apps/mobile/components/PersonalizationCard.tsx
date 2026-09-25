import { useMemo, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  BUTTON_OPTIONS,
  FONT_OPTIONS,
  FONT_STACKS,
  BACKGROUND_DIM_MAX,
  BUTTON_RADIUS_MAX,
  FONT_SCALE_MAX,
  FONT_SCALE_MIN,
  SURFACE_OPACITY_MIN,
  resolveProfileWithVault,
  type AppearanceProfile,
  type AppFontFamily,
  type ButtonStyle,
} from '../lib/appearance';
import { usePreferences } from '../preferences/PreferencesContext';
import { useVaults } from '../lib/sync/VaultsContext';
import { ColorField } from './ColorField';
import { OptionCollapse } from './OptionCollapse';
import { SliderField } from './SliderField';

// Section « Personnalisation » (v0.4.32) — RÈGLES (demandes de
// l'utilisatrice, à respecter pour TOUT futur réglage) :
// 1. PAR COFFRE : tout ce qui suit s'applique au coffre ACTIF uniquement
//    (fichier .123ecriture/appearance.json du coffre — PROGRAMMATION et
//    DIVERS ont chacun leur apparence).
// 2. Options multiples non numériques → boutons COLLAPSIBLES VERTICAUX
//    (OptionCollapse).
// 3. Réglages numériques → CURSEURS (SliderField).
// 4. Chaque couleur → préréglages + ROUE des couleurs dédiée (ColorField).
// 5. Panneaux : couleur + translucidité réglables.
// 6. Modes : deux boutons ☀️/🌙 — cliquer déploie les réglages du mode en
//    brouillon ; « Sauvegarder » enregistre ; pas de libellé superflu.

const ACCENT_PRESETS = ['#4f46e5', '#2563eb', '#0d9488', '#16a34a', '#d97706', '#dc2626', '#db2777', '#7c3aed'];
const LIGHT_BG_PRESETS = ['#ffffff', '#f5f5f7', '#faf5ff', '#f0fdf4', '#fff7ed', '#f0f9ff', '#fef2f2', '#fdf4ff'];
const DARK_BG_PRESETS = ['#111114', '#1c1c22', '#0f172a', '#111827', '#1e1b1b', '#141c14', '#1c1420', '#0c0c10'];
const LIGHT_SURFACE_PRESETS = ['#f5f5f7', '#ffffff', '#eef2ff', '#f0fdf4', '#fdf2f8'];
const DARK_SURFACE_PRESETS = ['#1c1c22', '#111114', '#1e293b', '#1e1b1b', '#1c1420'];
const DIM_STEP = 0.05;
const SCALE_STEP = 0.05;
const RADIUS_STEP = 1;
const OPACITY_STEP = 0.05;

type ModeKey = 'light' | 'dark';

export function PersonalizationCard() {
  const {
    preferences,
    theme,
    colorScheme,
    wallpapers,
    setThemeMode,
    importWallpaper,
    clearWallpaper,
    vaultAppearance,
    saveVaultAppearance,
    resetVaultAppearance,
  } = usePreferences();
  const { activeVault } = useVaults();

  // Brouillon PAR MODE initialisé de la résolution courante (coffre →
  // global → défauts) — « Sauvegarder » (règle 6) écrit le fichier du coffre.
  const initial = useMemo(
    () => ({
      light: resolveProfileWithVault(preferences, vaultAppearance, 'light'),
      dark: resolveProfileWithVault(preferences, vaultAppearance, 'dark'),
    }),
    // Volontaire : le brouillon se reconstruit au CHANGEMENT de coffre, pas
    // à chaque frappe dans les préférences (elles servent de base lue une
    // fois à l'ouverture de la carte).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeVault?.id],
  );
  const [draft, setDraft] = useState<{ light: AppearanceProfile; dark: AppearanceProfile }>(initial);
  const [openMode, setOpenMode] = useState<ModeKey | null>(null);
  const [dirty, setDirty] = useState(false);

  // Changement de coffre actif → recharger le brouillon (le fichier du
  // coffre précédent n'a rien à voir ici).
  const [syncedVault, setSyncedVault] = useState(activeVault?.id);
  if (syncedVault !== activeVault?.id) {
    setSyncedVault(activeVault?.id);
    setOpenMode(null);
    setDraft({
      light: resolveProfileWithVault(preferences, vaultAppearance, 'light'),
      dark: resolveProfileWithVault(preferences, vaultAppearance, 'dark'),
    });
    setDirty(false);
  }

  const patchMode = (mode: ModeKey, patch: Partial<AppearanceProfile>) => {
    setDraft((prev) => ({ ...prev, [mode]: { ...prev[mode], ...patch } }));
    setDirty(true);
  };

  const sauvegarder = () => {
    void saveVaultAppearance({ light: draft.light, dark: draft.dark });
    setDirty(false);
  };

  const wallpaper = wallpapers[openMode ?? colorScheme];
  const canWallpaper = typeof window !== 'undefined' && Boolean(window.appearance?.importWallpaper);

  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <Text style={[styles.cardTitle, { color: theme.text }]}>🎨 Personnalisation</Text>
      <Text style={[styles.hint, { color: theme.textMuted }]}>
        Apparence du coffre actif : {activeVault ? activeVault.name : 'aucun'} — chaque coffre a la sienne.
      </Text>

      <Text style={[styles.label, { color: theme.textMuted }]}>Mode actif</Text>
      <View style={styles.row}>
        {([['system', 'Système'], ['light', 'Clair'], ['dark', 'Sombre']] as const).map(([mode, label]) => {
          const isActive = preferences.themeMode === mode;
          return (
            <Pressable
              key={mode}
              onPress={() => void setThemeMode(mode as ThemeMode)}
              accessibilityRole="button"
              style={[styles.modeButton, { borderColor: theme.border }, isActive && { backgroundColor: theme.accent, borderColor: theme.accent }]}
            >
              <Text style={{ color: isActive ? '#fff' : theme.text }}>{label}</Text>
            </Pressable>
          );
        })}
      </View>

      {/* ---- Les deux modes : boutons qui déploient leurs réglages (règle 6) ---- */}
      <View style={{ gap: 8, marginTop: 4 }}>
        {(['light', 'dark'] as const).map((mode) => {
          const open = openMode === mode;
          const p = draft[mode];
          return (
            <View key={mode} style={[styles.modeSection, { borderColor: open ? theme.accent : theme.border }]}>
              <Pressable
                onPress={() => setOpenMode(open ? null : mode)}
                accessibilityRole="button"
                style={[styles.modeHeader, { backgroundColor: theme.surface }]}
              >
                <Text style={{ color: theme.text, fontWeight: '600', fontSize: 15, flex: 1 }}>
                  {mode === 'light' ? '☀️ Mode clair' : '🌙 Mode sombre'}
                </Text>
                <Text style={{ color: theme.textMuted, fontSize: 12 }}>
                  {p.fontFamily} · {Math.round(p.fontScale * 100)} %{colorScheme === mode ? ' · actif' : ''}
                </Text>
                <Text style={{ color: theme.textMuted }}>{open ? '▾' : '▸'}</Text>
              </Pressable>

              {open && (
                <View style={{ gap: 12, padding: 12 }}>
                  <OptionCollapse<AppFontFamily>
                    label="Police de l&apos;interface"
                    value={p.fontFamily}
                    options={FONT_OPTIONS.map((o) => ({
                      value: o.value,
                      label: o.label,
                      extra: (
                        <Text style={{ fontFamily: FONT_STACKS[o.value], color: theme.textMuted, fontSize: 12 }}>
                          Aa — Exemple
                        </Text>
                      ),
                    }))}
                    onValueChange={(v) => patchMode(mode, { fontFamily: v })}
                    theme={theme}
                  />

                  <SliderField
                    label="Échelle de l&apos;interface"
                    value={p.fontScale}
                    minimumValue={FONT_SCALE_MIN}
                    maximumValue={FONT_SCALE_MAX}
                    step={SCALE_STEP}
                    format={(v) => Math.round(v * 100) + ' %'}
                    onValueChange={(v) => patchMode(mode, { fontScale: v })}
                    theme={theme}
                  />

                  <ColorField
                    label="Couleur d&apos;accent"
                    value={p.accentColor}
                    presets={ACCENT_PRESETS}
                    onValueChange={(hex) => patchMode(mode, { accentColor: hex })}
                    theme={theme}
                  />

                  <OptionCollapse<'color' | 'image'>
                    label="Fond du mode"
                    value={p.backgroundMode === 'image' && canWallpaper ? 'image' : 'color'}
                    options={[
                      { value: 'color' as const, label: 'Couleur unie' },
                      ...(canWallpaper ? [{ value: 'image' as const, label: 'Image (fond d’écran)' }] : []),
                    ]}
                    onValueChange={(v) => patchMode(mode, { backgroundMode: v })}
                    theme={theme}
                  />

                  {p.backgroundMode === 'image' && canWallpaper ? (
                    <>
                      <View style={styles.row}>
                        <Pressable
                          onPress={() =>
                            void importWallpaper(mode).then((ok) => {
                              if (ok) patchMode(mode, { backgroundMode: 'image' });
                            })
                          }
                          accessibilityRole="button"
                          style={[styles.modeButton, { borderColor: theme.border }]}
                        >
                          <Text style={{ color: theme.text }}>📥 Importer une image…</Text>
                        </Pressable>
                        {wallpaper && (
                          <Pressable onPress={() => void clearWallpaper(mode)} accessibilityRole="button" style={[styles.modeButton, { borderColor: theme.border }]}>
                            <Text style={{ color: theme.danger }}>Retirer l&apos;image</Text>
                          </Pressable>
                        )}
                      </View>
                      {wallpaper ? (
                        <View style={styles.wallpaperPreviewBox}>
                          <Image source={{ uri: wallpaper }} style={styles.wallpaperPreview} resizeMode="cover" />
                          <View style={[styles.wallpaperPreviewDim, { opacity: p.backgroundDim }]} />
                        </View>
                      ) : (
                        <Text style={[styles.hint, { color: theme.textMuted }]}>Aucune image pour ce mode — importe-en une (12 Mo max).</Text>
                      )}
                      <SliderField
                        label="Voile de lisibilité"
                        value={p.backgroundDim}
                        minimumValue={0}
                        maximumValue={BACKGROUND_DIM_MAX}
                        step={DIM_STEP}
                        format={(v) => Math.round(v * 100) + ' %'}
                        onValueChange={(v) => patchMode(mode, { backgroundDim: v })}
                        theme={theme}
                      />
                    </>
                  ) : (
                    <ColorField
                      label="Couleur du fond"
                      value={p.backgroundColor}
                      presets={mode === 'dark' ? DARK_BG_PRESETS : LIGHT_BG_PRESETS}
                      onValueChange={(hex) => patchMode(mode, { backgroundColor: hex })}
                      theme={theme}
                    />
                  )}

                  {/* ---- Panneaux (règle 5) ---- */}
                  <ColorField
                    label="Couleur des panneaux"
                    value={p.surfaceColor}
                    presets={mode === 'dark' ? DARK_SURFACE_PRESETS : LIGHT_SURFACE_PRESETS}
                    onValueChange={(hex) => patchMode(mode, { surfaceColor: hex })}
                    theme={theme}
                  />
                  <SliderField
                    label="Translucidité des panneaux"
                    value={1 - p.surfaceOpacity}
                    minimumValue={0}
                    maximumValue={1 - SURFACE_OPACITY_MIN}
                    step={OPACITY_STEP}
                    format={(v) => Math.round(v * 100) + ' % transparent'}
                    onValueChange={(v) => patchMode(mode, { surfaceOpacity: 1 - v })}
                    theme={theme}
                  />

                  <OptionCollapse<ButtonStyle>
                    label="Style des boutons"
                    value={p.buttonStyle}
                    options={BUTTON_OPTIONS.map((o) => ({ value: o.value as ButtonStyle, label: o.label }))}
                    onValueChange={(v) => patchMode(mode, { buttonStyle: v })}
                    theme={theme}
                  />
                  <SliderField
                    label="Arrondi des boutons"
                    value={p.buttonRadius}
                    minimumValue={0}
                    maximumValue={BUTTON_RADIUS_MAX}
                    step={RADIUS_STEP}
                    format={(v) => (v === 0 ? 'Droit' : v + ' px')}
                    onValueChange={(v) => patchMode(mode, { buttonRadius: v })}
                    theme={theme}
                  />
                </View>
              )}
            </View>
          );
        })}
      </View>

      {/* ---- Sauvegarder (règle 6) ---- */}
      <View style={[styles.row, { marginTop: 4 }]}>
        <Pressable
          onPress={sauvegarder}
          disabled={!dirty}
          accessibilityRole="button"
          style={[
            styles.modeButton,
            { borderColor: theme.accent },
            dirty && { backgroundColor: theme.accent },
            !dirty && { opacity: 0.45 },
          ]}
        >
          <Text style={{ color: dirty ? '#ffffff' : theme.text }}>{dirty ? '💾 Sauvegarder ce coffre' : 'Aucune modification'}</Text>
        </Pressable>
        {dirty && (
          <Pressable
            onPress={() => {
              setDraft({
                light: resolveProfileWithVault(preferences, vaultAppearance, 'light'),
                dark: resolveProfileWithVault(preferences, vaultAppearance, 'dark'),
              });
              setDirty(false);
            }}
            accessibilityRole="button"
            style={[styles.modeButton, { borderColor: theme.border }]}
          >
            <Text style={{ color: theme.text }}>Annuler</Text>
          </Pressable>
        )}
      </View>
      <Pressable
        onPress={() => void resetVaultAppearance()}
        accessibilityRole="button"
        style={[styles.modeButton, { borderColor: theme.border, alignSelf: 'flex-start' }]}
      >
        <Text style={{ color: theme.text }}>↩︎ Revenir à la personnalisation globale</Text>
      </Pressable>
      {!canWallpaper && (
        <Text style={[styles.hint, { color: theme.textMuted }]}>Fond en image disponible sur la version bureau uniquement.</Text>
      )}
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
  modeSection: {
    borderWidth: 1,
    borderRadius: 10,
    overflow: 'hidden',
  },
  modeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  wallpaperPreviewBox: {
    height: 110,
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
