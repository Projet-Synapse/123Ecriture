import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Theme } from '../theme';

// Poignée de redimensionnement d'une barre latérale — barre fine tirable au
// curseur (`onMouseDown`, transmis tel quel jusqu'au DOM par
// react-native-web 0.21, voir `forwardedProps` — pas besoin d'échappatoire
// ref+useEffect ici, contrairement à `draggable` ailleurs dans l'app) + un
// petit chevron cliquable pour replier/déplier sans avoir à viser le
// glisser-jusqu'à-zéro. Purement présentationnel : la logique vit dans
// lib/useResizablePanel.ts.
type Props = {
  theme: Theme;
  side: 'left' | 'right';
  collapsed: boolean;
  isDragging: boolean;
  onMouseDown: (event: { clientX: number; preventDefault: () => void }) => void;
  onToggleCollapsed: () => void;
};

export function ResizeHandle({ theme, side, collapsed, isDragging, onMouseDown, onToggleCollapsed }: Props) {
  return (
    <View
      // @ts-expect-error -- `onMouseDown` est transmis tel quel jusqu'au DOM
      // par react-native-web (voir forwardedProps), mais absent des types
      // officiels de View/ViewProps.
      onMouseDown={onMouseDown}
      style={[
        styles.handle,
        { backgroundColor: isDragging ? theme.accent : 'transparent' },
      ]}
    >
      <View style={[styles.grip, { backgroundColor: theme.border }]} />
      <Pressable
        onPress={onToggleCollapsed}
        style={[styles.chevron, { backgroundColor: theme.surface, borderColor: theme.border }]}
        accessibilityLabel={collapsed ? 'Afficher le panneau' : 'Masquer le panneau'}
      >
        <Text style={{ color: theme.textMuted, fontSize: 10 }}>
          {side === 'left' ? (collapsed ? '▶' : '◀') : collapsed ? '◀' : '▶'}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  handle: {
    width: 6,
    alignItems: 'center',
    justifyContent: 'center',
    // Le type RN `CursorValue` officiel n'a pas 'col-resize', mais
    // react-native-web transmet la valeur brute au CSS — même échappatoire
    // que 'pointer' ailleurs (VaultTreeView.tsx).
    cursor: 'col-resize' as unknown as 'auto',
  },
  grip: {
    width: 2,
    flex: 1,
    borderRadius: 1,
  },
  chevron: {
    position: 'absolute',
    width: 16,
    height: 28,
    borderRadius: 6,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer' as unknown as 'auto',
  },
});
