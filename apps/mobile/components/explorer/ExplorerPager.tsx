import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import type { Theme } from '../../theme';

// ✒️ 123ECRITURE — components/explorer/ExplorerPager.tsx — MOBILE UNIQUEMENT
// L'explorateur occupe toute la largeur ; l'éditeur est la « page » suivante,
// atteinte par défilement horizontal paginé. Remplace, sur mobile, la
// poignée de largeur par une barre de défilement horizontale (en bas,
// toujours visible — l'indicateur natif Android s'efface, d'où la barre
// maison, comme NativeScrollbar en vertical). Desktop/web n'utilisent PAS ce
// composant (rangée explorateur | poignée | éditeur inchangée).
//
// Gestes : `scrollEnabled` est coupé par l'appelant pendant un glisser-
// déposer dans l'arbre (sinon le pager volerait le geste).

export type ExplorerPagerHandle = { showEditor: () => void; showExplorer: () => void };

type Props = {
  theme: Theme;
  explorer: (pageWidth: number) => ReactNode;
  editor: ReactNode;
  scrollEnabled: boolean;
  onPageChange?: (page: 0 | 1) => void;
};

export const ExplorerPager = forwardRef<ExplorerPagerHandle, Props>(function ExplorerPagerImpl(
  { theme, explorer, editor, scrollEnabled, onPageChange },
  ref,
) {
  const scrollRef = useRef<ScrollView>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const { width, height } = size;
  const [offset, setOffset] = useState(0);
  // Page demandée AVANT la première mesure (ex. « fichier ouvert par
  // défaut » au lancement) : appliquée via contentOffset au montage du
  // ScrollView, sinon le scrollTo d'un pager non mesuré était perdu.
  const pendingPageRef = useRef<0 | 1>(0);
  const go = (page: 0 | 1) => {
    pendingPageRef.current = page;
    if (width > 0) scrollRef.current?.scrollTo({ x: page * width, animated: true });
    onPageChange?.(page);
  };
  useEffect(() => {
    if (width > 0) setOffset(pendingPageRef.current * width);
  }, [width]);
  useImperativeHandle(ref, () => ({ showEditor: () => go(1), showExplorer: () => go(0) }));
  const progress = width > 0 ? Math.min(1, Math.max(0, offset / width)) : 0;
  return (
    <View style={styles.root} onLayout={(e) => {
        const { width: w, height: h } = e.nativeEvent.layout;
        setSize((prev) => (prev.width === w && prev.height === h ? prev : { width: w, height: h }));
      }}>
      {width > 0 && (
        <ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          scrollEnabled={scrollEnabled}
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          scrollEventThrottle={16}
          contentOffset={{ x: pendingPageRef.current * width, y: 0 }}
          onScroll={(e) => setOffset(e.nativeEvent.contentOffset.x)}
          onMomentumScrollEnd={(e) => {
            const page = e.nativeEvent.contentOffset.x >= width / 2 ? 1 : 0;
            pendingPageRef.current = page;
            onPageChange?.(page);
          }}
          style={styles.root}
        >
          {/* Hauteur EXPLICITE de chaque page : dans un ScrollView horizontal,
              une page sans hauteur prend celle de son contenu — la liste
              verticale de l'explorateur n'était alors plus bornée et ses
              derniers éléments passaient sous la piste / la barre système,
              impossibles à atteindre en défilant. */}
          <View style={{ width, height: Math.max(0, height - TRACK_HEIGHT) }}>{explorer(width)}</View>
          <View style={{ width, height: Math.max(0, height - TRACK_HEIGHT) }}>{editor}</View>
        </ScrollView>
      )}
      {/* Barre de défilement horizontale : remplace la poignée de largeur.
          Toucher une moitié de la piste bascule vers la page correspondante. */}
      <View style={[styles.track, { backgroundColor: theme.border }]}>
        <Pressable style={styles.half} onPress={() => go(0)} accessibilityLabel="Explorateur" />
        <Pressable style={styles.half} onPress={() => go(1)} accessibilityLabel="Éditeur" />
        <View
          pointerEvents="none"
          style={[styles.thumb, { backgroundColor: theme.accent, left: `${progress * 50}%` }]}
        />
      </View>
    </View>
  );
});

const TRACK_HEIGHT = 6;

const styles = StyleSheet.create({
  root: { flex: 1 },
  track: { height: TRACK_HEIGHT, flexDirection: 'row', position: 'relative' },
  half: { flex: 1 },
  thumb: { position: 'absolute', top: 0, bottom: 0, width: '50%', borderRadius: 3 },
});
