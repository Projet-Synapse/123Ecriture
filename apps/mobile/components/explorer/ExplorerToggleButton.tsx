import { Pressable, StyleSheet } from 'react-native';
import Svg, { Rect } from 'react-native-svg';

import type { Theme } from '../../theme';

// ✒️ 123ECRITURE — components/explorer/ExplorerToggleButton.tsx
// Bouton « barre latérale » façon Obsidian (rectangle arrondi + panneau
// gauche plein) : posé tout en haut de l'explorateur pour le masquer, et
// dans le rail de l'éditeur pour le rouvrir. Remplace le chevron ◀ qui
// était au milieu de la poignée.

type Props = { theme: Theme; open: boolean; onPress: () => void };

export function ExplorerToggleButton({ theme, open, onPress }: Props) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={open ? "Masquer l'explorateur" : "Afficher l'explorateur"}
      style={({ pressed }) => [styles.button, pressed && { backgroundColor: `${theme.accent}22` }]}
    >
      <Svg width={20} height={20} viewBox="0 0 24 24">
        <Rect x={3} y={4} width={18} height={16} rx={4} fill="none" stroke={theme.textMuted} strokeWidth={2} />
        <Rect x={6.5} y={7.5} width={4} height={9} rx={1.5} fill={open ? theme.textMuted : 'none'} stroke={theme.textMuted} strokeWidth={1.5} />
      </Svg>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer' as unknown as 'auto',
  },
});
