import { Pressable, Text, View } from 'react-native';

import type { Theme } from '../../theme';
import { settingsStyles as s } from './settingsStyles';

// Liste réordonnable/masquable générique (case à cocher + libellé + flèches
// haut/bas) — reproduit le visuel de la barre d'outils Notes dans
// PersonalizationCard.tsx, généralisé pour être partagé entre Notes, Canvas
// et Graphiques plutôt que dupliqué trois fois. PersonalizationCard.tsx
// garde sa propre implémentation (pas touchée, pour ne pas risquer de
// régression sur une fonctionnalité déjà en production) ; ce composant sert
// les deux NOUVELLES listes (Canvas/Graphiques) dans EditorSection.tsx.
type Props = {
  items: ToolbarItemConfig[];
  descriptions: Record<string, string>;
  onChange: (next: ToolbarItemConfig[]) => void;
  theme: Theme;
};

export function ToolbarOrderEditor({ items, descriptions, onChange, theme }: Props) {
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
          <Text style={[s.toolbarItemLabel, { color: theme.text }]}>{descriptions[item.id] ?? item.id}</Text>
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
