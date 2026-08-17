import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { usePreferences } from '../preferences/PreferencesContext';

const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

// Section "Personnalisation" de l'écran Paramètres — le point de départ de
// la vision « interface ultra-personnalisable » (voir .claude/CLAUDE.md et
// docs/ARCHITECTURE.md §7) : couleur d'accent, mode clair/sombre/système.
// La réorganisation des barres d'outils (Notes/Canvas/Graphiques) vit dans
// Paramètres → Éditeur (voir apps/mobile/components/settings/
// EditorSection.tsx) — plus cohérent d'avoir les 3 au même endroit que
// leurs autres réglages d'édition.
const THEME_MODE_OPTIONS: { mode: ThemeMode; label: string }[] = [
  { mode: 'system', label: 'Système' },
  { mode: 'light', label: 'Clair' },
  { mode: 'dark', label: 'Sombre' },
];

// Palette resserrée plutôt qu'un sélecteur de couleur libre — plus rapide à
// utiliser, et évite d'avoir à valider qu'une couleur arbitraire reste
// lisible (contraste texte/accent) sur les deux thèmes. Un choix de couleur
// libre (avec vérification de contraste) pourra venir plus tard.
const ACCENT_PRESETS = ['#4f46e5', '#2563eb', '#0d9488', '#16a34a', '#d97706', '#dc2626', '#db2777', '#7c3aed'];

export function PersonalizationCard() {
  const { preferences, theme, setThemeMode, setAccentColor } = usePreferences();
  const [hexDraft, setHexDraft] = useState(preferences.accentColor);
  const [hexError, setHexError] = useState(false);
  // Reste synchronisé si l'accent change ailleurs (clic sur une pastille, ou
  // chargement des préférences depuis Electron) — sans ça, le champ hex
  // afficherait une ancienne valeur après un clic sur une pastille. Ajustée
  // pendant le rendu plutôt que dans un effet (voir
  // https://react.dev/learn/you-might-not-need-an-effect) : pas de rendu
  // supplémentaire déclenché après coup.
  const [syncedAccentColor, setSyncedAccentColor] = useState(preferences.accentColor);
  if (preferences.accentColor !== syncedAccentColor) {
    setSyncedAccentColor(preferences.accentColor);
    setHexDraft(preferences.accentColor);
    setHexError(false);
  }

  const submitHexColor = () => {
    const trimmed = hexDraft.trim();
    if (!HEX_COLOR_PATTERN.test(trimmed)) {
      setHexError(true);
      return;
    }
    setHexError(false);
    setAccentColor(trimmed);
  };

  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <Text style={[styles.cardTitle, { color: theme.text }]}>🎨 Personnalisation</Text>

      <Text style={[styles.label, { color: theme.textMuted }]}>Apparence</Text>
      <View style={styles.row}>
        {THEME_MODE_OPTIONS.map((option) => {
          const isActive = preferences.themeMode === option.mode;
          return (
            <Pressable
              key={option.mode}
              onPress={() => setThemeMode(option.mode)}
              style={[
                styles.modeButton,
                { borderColor: theme.border },
                isActive && { backgroundColor: theme.accent, borderColor: theme.accent },
              ]}
            >
              <Text style={{ color: isActive ? '#fff' : theme.text }}>{option.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={[styles.label, { color: theme.textMuted }]}>Couleur d’accent</Text>
      <View style={styles.row}>
        {ACCENT_PRESETS.map((color) => {
          const isActive = preferences.accentColor.toLowerCase() === color.toLowerCase();
          return (
            <Pressable
              key={color}
              onPress={() => setAccentColor(color)}
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
          style={[
            styles.hexInput,
            { color: theme.text, borderColor: hexError ? '#dc2626' : theme.border },
          ]}
        />
      </View>
      {hexError && <Text style={styles.hexError}>⚠️ Couleur invalide — format attendu : #rrggbb</Text>}
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
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
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
    color: '#dc2626',
    fontSize: 12,
  },
});
