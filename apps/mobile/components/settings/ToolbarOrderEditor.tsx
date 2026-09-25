import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { Theme } from '../../theme';
import { settingsStyles as s } from './settingsStyles';

// Liste réordonnable/masquable générique (case à cocher + libellé + flèches
// haut/bas) — utilisée par les 3 cartes "Barre d'outils Notes/Canvas/
// Graphiques" de Paramètres → Éditeur (EditorSection.tsx), une seule
// implémentation partagée plutôt que dupliquée trois fois.
type Props = {
  items: ToolbarItemConfig[];
  descriptions: Record<string, string>;
  onChange: (next: ToolbarItemConfig[]) => void;
  theme: Theme;
  // v0.4.39 : autoriser l'attribution de GROUPES COLLAPSIBLES (champ texte
  // par item — les items partageant un même nom de groupe apparaissent
  // sous un seul bouton dépliable dans la barre). Optionnel : Canvas/
  // Graphiques n'ont pas encore l'assemblage groupé côté barre.
  allowGroups?: boolean;
  // Raccourci clavier affiché à côté du libellé, ex. "Ctrl+B" (voir
  // lib/notesToolbarActions.ts, NOTES_TOOLBAR_SHORTCUT_LABELS) — seule la
  // barre Notes en a pour l'instant, absent sinon.
  shortcuts?: Partial<Record<string, string>>;
};

export function ToolbarOrderEditor({ items, descriptions, onChange, theme, shortcuts, allowGroups = false }: Props) {
  const moveItem = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  const toggleItem = (index: number) => {
    const next = items.map((item, i) => (i === index ? { ...item, visible: !item.visible } : item));
    onChange(next);
  };

  return (
    <View style={s.toolbarList}>
      {items.map((item, index) => (
        <View key={item.id} style={[s.toolbarRow, { borderColor: theme.border }]}>
          <Pressable
            onPress={() => toggleItem(index)}
            style={[
              s.checkbox,
              { borderColor: theme.border },
              item.visible && { backgroundColor: theme.accent, borderColor: theme.accent },
            ]}
          >
            {item.visible && <Text style={s.checkboxMark}>✓</Text>}
          </Pressable>
          <Text style={[s.toolbarItemLabel, { color: theme.text }]}>
            {descriptions[item.id] ?? item.id}
            {shortcuts?.[item.id] ? (
              <Text style={{ color: theme.textMuted, fontSize: 12 }}> · {shortcuts[item.id]}</Text>
            ) : null}
          </Text>
          {allowGroups && (
            <TextInput
              value={item.group ?? ''}
              onChangeText={(text) => {
                const next = items.map((it, i) =>
                  i === index ? { ...it, group: text.trim() || undefined } : it,
                );
                onChange(next);
              }}
              placeholder="groupe…"
              placeholderTextColor={theme.textMuted}
              style={[groupStyles.groupInput, { color: theme.text, borderColor: theme.border }]}
            />
          )}
          <View style={s.reorderButtons}>
            <Pressable
              onPress={() => moveItem(index, -1)}
              disabled={index === 0}
              style={[s.reorderButton, index === 0 && s.reorderButtonDisabled]}
            >
              <Text style={{ color: theme.textMuted }}>↑</Text>
            </Pressable>
            <Pressable
              onPress={() => moveItem(index, 1)}
              disabled={index === items.length - 1}
              style={[s.reorderButton, index === items.length - 1 && s.reorderButtonDisabled]}
            >
              <Text style={{ color: theme.textMuted }}>↓</Text>
            </Pressable>
          </View>
        </View>
      ))}
    </View>
  );
}


const groupStyles = StyleSheet.create({
  groupInput: {
    width: 90,
    borderWidth: 1,
    borderRadius: 6,
    paddingVertical: 3,
    paddingHorizontal: 6,
    fontSize: 12,
  },
});
