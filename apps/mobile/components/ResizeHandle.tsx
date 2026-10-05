import { GestureResponderEvent, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import type { Theme } from '../theme';

// Poignée de redimensionnement d'une barre latérale — barre fine tirable au
// curseur (`onMouseDown`, transmis tel quel jusqu'au DOM par
// react-native-web 0.21, voir `forwardedProps` — pas besoin d'échappatoire
// ref+useEffect ici, contrairement à `draggable` ailleurs dans l'app) + un
// petit chevron cliquable pour replier/déplier sans avoir à viser le
// glisser-jusqu'à-zéro. Purement présentationnel : la logique vit dans
// lib/useResizablePanel.ts.
//
// TACTILE (natif, demande 2026-10-03 : « gérer leur largeur à l'aide de mon
// doigt ») : quand les callbacks `onTouch*` sont fournis, la poignée capte
// le geste via le système de responders (x absolu pageX — même sémantique
// que clientX côté souris) et le suit pendant tout le déplacement. La zone
// de prise est une vraie largeur de 24 dp en natif (voir le commentaire
// dans le JSX : un hitSlop ne suffit pas au-dessus du panneau voisin). Le
// chevron reste prioritaire (descendant pressable : la négociation de
// responder lui donne la main en premier) — seul le toucher hors chevron
// déclenche le glisser.
type Props = {
  theme: Theme;
  side: 'left' | 'right';
  collapsed: boolean;
  isDragging: boolean;
  onMouseDown: (event: { clientX: number; preventDefault: () => void }) => void;
  onTouchStart?: (x: number) => void;
  onTouchMove?: (x: number) => void;
  onTouchEnd?: () => void;
  onToggleCollapsed: () => void;
};

export function ResizeHandle({ theme, side, collapsed, isDragging, onMouseDown, onTouchStart, onTouchMove, onTouchEnd, onToggleCollapsed }: Props) {
  const touchEnabled = Platform.OS !== 'web' && Boolean(onTouchStart && onTouchMove && onTouchEnd);
  const handleTouchGrant = (event: GestureResponderEvent) => onTouchStart?.(event.nativeEvent.pageX);
  const handleTouchMove = (event: GestureResponderEvent) => onTouchMove?.(event.nativeEvent.pageX);
  return (
    <View
      // @ts-expect-error -- `onMouseDown` est transmis tel quel jusqu'au DOM
      // par react-native-web (voir forwardedProps), mais absent des types
      // officiels de View/ViewProps.
      onMouseDown={onMouseDown}
      style={[
        styles.handle,
        // Natif : zone de prise RÉELLE de 24 dp (la barre reste collée au
        // bord du panneau qu'elle sert). Un hitSlop ne suffit pas : sur la
        // zone qu'il ajoute PAR-DESSUS le panneau voisin, les lignes de
        // contenu (plus profondes dans l'arbre de vues) captent le toucher
        // avant la poignée — glisser ne démarrait qu'un swipe sur deux
        // (vécu A13, 2026-10-03). Web : 6 dp précis au curseur.
        touchEnabled
          ? { width: 24, alignItems: side === 'left' ? 'flex-end' : 'flex-start' }
          : null,
        { backgroundColor: isDragging ? theme.accent : 'transparent' },
      ]}
      {...(touchEnabled
        ? {
            onStartShouldSetResponder: () => true,
            onMoveShouldSetResponder: () => true,
            onResponderGrant: handleTouchGrant,
            onResponderMove: handleTouchMove,
            onResponderRelease: () => onTouchEnd?.(),
            onResponderTerminate: () => onTouchEnd?.(),
          }
        : {})}
    >
      <View style={[styles.grip, { backgroundColor: theme.border }]} />
      <Pressable
        onPress={onToggleCollapsed}
        style={[
          styles.chevron,
          touchEnabled && (side === 'left' ? { right: 4 } : { left: 4 }),
          { backgroundColor: theme.surface, borderColor: theme.border },
        ]}
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
