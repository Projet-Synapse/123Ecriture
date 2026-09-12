import { useCallback, useRef } from 'react';
import type { LayoutChangeEvent, NativeScrollEvent, ScrollView } from 'react-native';
import type { RefObject } from 'react';

// Scroll-into-view pour les listes navigables au clavier (palette de
// commandes, recherche globale, MoveDialog) : sans lui, la sélection
// flèches ↓↑ continue "en coulisses" dès qu'elle dépasse la hauteur visible
// de la liste — l'Entrée qui suit active alors un élément qu'on n'a jamais
// vu surligné. Chaque élément mesure sa position via onLayout (hauteurs
// variables : ligne avec/sans extrait), et le ScrollView garde son offset +
// son viewport dans des refs pour recalculer SANS re-render — seule la
// sélection (déjà un state chez l'appelant) re-render la liste.
//
// Hook (pas logique pure testée comme calendarDates.ts) : il n'y a rien à
// tester sans un vrai ScrollView — le cœur calculatoire `scrollTargetForItem`
// est quand même isolé en fonction pure en bas de ce fichier.
//
// API en `recordItemLayout(index, event)` plutôt qu'en factory
// `onItemLayout(index)(event)` : la règle react-hooks/refs (React Compiler)
// refuse tout APPEL de fonction susceptible de toucher une ref PENDANT le
// rendu — les composants l'utilisent donc toujours via des handlers inline
// `onLayout={(e) => recordItemLayout(index, e)}`, jamais en l'appelant
// eux-mêmes pendant le rendu.

export type ScrollIntoViewController = {
  scrollRef: RefObject<ScrollView | null>;
  recordItemLayout: (index: number, event: LayoutChangeEvent) => void;
  handleListLayout: (event: LayoutChangeEvent) => void;
  handleListScroll: (event: { nativeEvent: NativeScrollEvent }) => void;
  ensureVisible: (index: number) => void;
};

export function useScrollIntoView(): ScrollIntoViewController {
  const scrollRef = useRef<ScrollView>(null);
  const itemLayouts = useRef<Map<number, { y: number; height: number }>>(new Map());
  const scrollOffsetRef = useRef(0);
  const viewportHeightRef = useRef(0);

  const recordItemLayout = useCallback((index: number, event: LayoutChangeEvent) => {
    const { y, height } = event.nativeEvent.layout;
    itemLayouts.current.set(index, { y, height });
  }, []);

  // Hauteur du viewport dès le montage : onScroll ne part qu'au premier
  // défilement réel, trop tard pour un ensureVisible sur une liste fraîche.
  const handleListLayout = useCallback((event: LayoutChangeEvent) => {
    viewportHeightRef.current = event.nativeEvent.layout.height;
  }, []);

  const handleListScroll = useCallback((event: { nativeEvent: NativeScrollEvent }) => {
    scrollOffsetRef.current = event.nativeEvent.contentOffset.y;
    viewportHeightRef.current = event.nativeEvent.layoutMeasurement.height;
  }, []);

  const ensureVisible = useCallback((index: number) => {
    const layout = itemLayouts.current.get(index);
    if (!layout) return;
    const target = scrollTargetForItem(layout, scrollOffsetRef.current, viewportHeightRef.current);
    if (target !== null) scrollRef.current?.scrollTo({ y: target, animated: false });
  }, []);

  return { scrollRef, recordItemLayout, handleListLayout, handleListScroll, ensureVisible };
}

// Position de scroll à appliquer pour que l'élément soit entièrement
// visible, ou null s'il l'est déjà — au plus juste (pas de recentrage
// systématique, la liste ne "saute" pas quand tout tient déjà).
export function scrollTargetForItem(
  item: { y: number; height: number },
  scrollOffset: number,
  viewportHeight: number,
): number | null {
  if (viewportHeight <= 0) return null;
  if (item.y < scrollOffset) return item.y;
  if (item.y + item.height > scrollOffset + viewportHeight) return item.y + item.height - viewportHeight;
  return null;
}
