import { Pressable, StyleSheet, Text, View } from 'react-native';

import { NOTES_TOOLBAR_DESCRIPTIONS, type ToolbarActionId } from '../lib/notesToolbarActions';
import { usePreferences } from '../preferences/PreferencesContext';

// Section "Personnalisation" de l'écran Paramètres — le point de départ de
// la vision « interface ultra-personnalisable » (voir .claude/CLAUDE.md et
// docs/ARCHITECTURE.md §7) : couleur d'accent, mode clair/sombre/système, et
// réorganisation de la barre d'outils Notes (seule barre d'outils qui
// existe pour l'instant — les autres viendront avec leurs modules
// respectifs, Phase 5).
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
  const { preferences, theme, setThemeMode, setAccentColor, setNotesToolbarOrder } = usePreferences();

  const moveToolbarItem = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= preferences.notesToolbarOrder.length) return;
    const next = [...preferences.notesToolbarOrder];
    [next[index], next[target]] = [next[target], next[index]];
    setNotesToolbarOrder(next);
  };

  const toggleToolbarItem = (index: number) => {
    const next = preferences.notesToolbarOrder.map((item, i) =>
      i === index ? { ...item, visible: !item.visible } : item,
    );
    setNotesToolbarOrder(next);
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
      </View>

      <Text style={[styles.label, { color: theme.textMuted }]}>
        Barre d’outils Notes (ordre et boutons affichés)
      </Text>
      <View style={styles.toolbarList}>
        {preferences.notesToolbarOrder.map((item, index) => (
          <View key={item.id} style={[styles.toolbarRow, { borderColor: theme.border }]}>
            <Pressable
              onPress={() => toggleToolbarItem(index)}
              style={[
                styles.checkbox,
                { borderColor: theme.border },
                item.visible && { backgroundColor: theme.accent, borderColor: theme.accent },
              ]}
            >
              {item.visible && <Text style={styles.checkboxMark}>✓</Text>}
            </Pressable>
            <Text style={[styles.toolbarLabel, { color: theme.text }]}>
              {NOTES_TOOLBAR_DESCRIPTIONS[item.id as ToolbarActionId] ?? item.id}
            </Text>
            <View style={styles.reorderButtons}>
              <Pressable
                onPress={() => moveToolbarItem(index, -1)}
                disabled={index === 0}
                style={[styles.reorderButton, index === 0 && styles.reorderButtonDisabled]}
              >
                <Text style={{ color: theme.textMuted }}>↑</Text>
              </Pressable>
              <Pressable
                onPress={() => moveToolbarItem(index, 1)}
                disabled={index === preferences.notesToolbarOrder.length - 1}
                style={[
                  styles.reorderButton,
                  index === preferences.notesToolbarOrder.length - 1 && styles.reorderButtonDisabled,
                ]}
              >
                <Text style={{ color: theme.textMuted }}>↓</Text>
              </Pressable>
            </View>
          </View>
        ))}
      </View>
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
  toolbarList: {
    gap: 6,
  },
  toolbarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderRadius: 8,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxMark: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  toolbarLabel: {
    flex: 1,
    fontSize: 13,
  },
  reorderButtons: {
    flexDirection: 'row',
    gap: 4,
  },
  reorderButton: {
    paddingVertical: 2,
    paddingHorizontal: 8,
  },
  reorderButtonDisabled: {
    opacity: 0.3,
  },
});
