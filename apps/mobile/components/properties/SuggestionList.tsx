import type { RefObject } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { ValueSuggestion } from '../../lib/properties/propertyValueSuggestions';
import { solidColor } from '../../lib/ui/popover';
import type { Theme } from '../../theme';

// ✒️ 123ECRITURE — components/properties/SuggestionList.tsx — liste de suggestions (Android/iOS)
//////////////////////////////////////////////////////////////////////////////
//
// Version NATIVE : la liste s'affiche DANS le flux, juste sous le champ
// (elle pousse le contenu au lieu de flotter) — jamais masquée ni
// traversée par les lignes suivantes, et le clavier reste ouvert (un
// Modal natif volerait le focus du champ). Fond plein, choix au tap.
// La version web (SuggestionList.web.tsx) flotte au-dessus de tout.
//
//////////////////////////////////////////////////////////////////////////////

export type SuggestionListProps = {
  anchorRef: RefObject<View | null>;
  open: boolean;
  suggestions: ValueSuggestion[];
  highlighted: number;
  onPick: (suggestion: ValueSuggestion) => void;
  onHover: (index: number) => void;
  theme: Theme;
};

export const SOURCE_HINT: Record<ValueSuggestion['source'], string> = {
  used: '',
  option: 'option',
  note: 'note',
};

export function SuggestionList({ open, suggestions, highlighted, onPick, theme }: SuggestionListProps) {
  if (!open || suggestions.length === 0) return null;
  return (
    <View
      style={[styles.list, { backgroundColor: solidColor(theme.surface, solidColor(theme.background, '#ffffff')), borderColor: theme.border }]}
      accessibilityRole="menu"
    >
      {suggestions.map((suggestion, index) => (
        <Pressable
          key={suggestion.value}
          onPress={() => onPick(suggestion)}
          accessibilityRole="menuitem"
          style={[styles.row, index === highlighted && { backgroundColor: `${theme.accent}33` }]}
        >
          <Text style={{ color: theme.text, fontSize: 13, flex: 1 }} numberOfLines={1}>
            {suggestion.source === 'note' ? '📄 ' : ''}
            {suggestion.label}
          </Text>
          <Text style={{ color: theme.textMuted, fontSize: 11 }}>
            {suggestion.count > 0 ? `×${suggestion.count}` : SOURCE_HINT[suggestion.source]}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    marginTop: 4,
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 4,
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 10,
  },
});
