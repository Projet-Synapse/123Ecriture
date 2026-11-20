import { useRef, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import {
  compactSubMenuSize,
  TOOLBAR_TOUCH_TARGET,
  toolbarPressEffect,
  type ToolbarItem,
} from '../../lib/editor/toolbarItems';
import { placePopover, solidColor, type Rect } from '../../lib/ui/popover';

import type { Theme } from '../../theme';

// ✒️ 123ECRITURE — components/editors/EditorToolbar.tsx — barre d'outils partagée des éditeurs
//////////////////////////////////////////////////////////////////////////////
//
// Barre d'outils partagée par les 3 éditeurs de fichier (Notes, Canvas,
// Graphiques) : style neutre (fond `theme.surface`, texte `theme.text`,
// coins peu arrondis) — un bandeau d'actions discret, pas des
// call-to-action colorés. Chaque appelant précalcule sa propre liste
// `{id, label, onPress}` (déjà filtrée/ordonnée selon les préférences —
// voir NotesScreen.tsx/CanvasEditor.tsx/ChartEditor.tsx), ce composant ne
// fait que l'afficher de façon identique partout. Un item avec `subItems`
// est un groupe dépliant (ex. bouton "H" qui déploie H1-H6) : il déploie
// une seconde rangée en flux normal plutôt qu'un menu flottant ancré —
// aucun popover positionné n'existe ailleurs dans l'app (RN Web n'a pas
// de portail natif), la rangée reste simple et sans mesure de layout.
//
// Invariants du fichier :
//   • Un item `run` n'exécute rien lui-même : il remonte l'item à
//     l'appelant via onItemRun (annuler/rétablir touchent l'EditorView,
//     la pièce jointe ouvre le sélecteur) — les closures refs restent
//     dans le scope du prop JSX de l'appelant, où react-hooks/refs les
//     accepte.
//   • `divider` ne rend qu'un trait fin — label/id ignorés.
//   • Un sous-bouton de groupe dépliant suit le MÊME chemin qu'un bouton à
//     plat (`run` → onItemRun) — voir lib/editor/toolbarItems.ts.
//   • Mode COMPACT (mobile, par défaut hors web) : UNE seule ligne qui
//     défile horizontalement (jamais de retour à la ligne), boutons de
//     taille tactile (TOOLBAR_TOUCH_TARGET), et un groupe dépliant s'ouvre
//     en MENU flottant (Modal transparent + placePopover, fond opaque)
//     au-dessus de l'éditeur — la ligne ne bouge pas. Desktop (web) :
//     rendu inchangé (rangées qui passent à la ligne, rangée secondaire).
//
// SOMMAIRE :
//   1. Types d'items (groupe, séparateur, action déléguée)
//   2. Rendu (boutons, groupe dépliant, rangée secondaire)
//
//////////////////////////////////////////////////////////////////////////////

//////// 1. Types d'items (groupe, séparateur, action déléguée) ////////////
// Types et logique d'appui : lib/editor/toolbarItems.ts (testés).
type Item = ToolbarItem;

//////// 2. Rendu (boutons, groupe dépliant, rangée secondaire) ////////////

type Props = {
  items: Item[];
  theme: Theme;
  onItemRun?: (item: Item) => void;
  // Une ligne défilante + menus flottants (mobile). Défaut : hors web.
  compact?: boolean;
};

export function EditorToolbar({ items, theme, onItemRun, compact = Platform.OS !== 'web' }: Props) {
  const [openGroupId, setOpenGroupId] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<Rect | null>(null);
  const buttonRefs = useRef(new Map<string, View | null>());
  const screen = useWindowDimensions();

  if (items.length === 0) return null;

  const openGroup = items.find((item) => item.id === openGroupId && item.subItems);

  const runLeaf = (leaf: Item | NonNullable<Item['subItems']>[number]) => {
    const effect = toolbarPressEffect(leaf);
    if (effect === 'run') onItemRun?.(leaf);
    else if (effect === 'press') leaf.onPress?.();
  };

  // Compact : mesure le bouton du groupe pour placer le menu sous lui.
  const openCompactGroup = (id: string) => {
    const node = buttonRefs.current.get(id) as (View & { measureInWindow?: View['measureInWindow'] }) | null | undefined;
    if (node?.measureInWindow) {
      node.measureInWindow((x, y, width, height) => {
        setAnchor({ x, y, width, height });
        setOpenGroupId(id);
      });
    } else {
      setAnchor(null);
      setOpenGroupId(id);
    }
  };

  const buttons = items.map((item) => {
    if (item.divider) {
      return <View key={item.id} style={[styles.divider, { backgroundColor: theme.border }]} />;
    }
    const isGroup = Boolean(item.subItems);
    const isOpen = isGroup && item.id === openGroupId;
    return (
      <Pressable
        key={item.id}
        ref={(node) => {
          if (isGroup) buttonRefs.current.set(item.id, node);
        }}
        accessibilityRole="button"
        accessibilityState={isGroup ? { expanded: isOpen } : undefined}
        onPress={() => {
          const effect = toolbarPressEffect(item);
          if (effect === 'toggle-group') {
            if (isOpen) setOpenGroupId(null);
            else if (compact) openCompactGroup(item.id);
            else setOpenGroupId(item.id);
            return;
          }
          runLeaf(item);
        }}
        // Groupe dépliant (desktop) : le survol OU l'appui suffit à le
        // déployer. En compact, seul l'appui ouvre le menu flottant.
        onHoverIn={() => !compact && isGroup && setOpenGroupId(item.id)}
        onPressIn={() => !compact && isGroup && setOpenGroupId(item.id)}
        style={[
          styles.toolbarButton,
          compact && styles.compactButton,
          { backgroundColor: theme.surface },
          isOpen && { backgroundColor: `${theme.accent}22` },
        ]}
      >
        <Text
          numberOfLines={1}
          style={[styles.toolbarButtonText, compact && styles.compactButtonText, { color: isOpen ? theme.accent : theme.text }]}
        >
          {item.label}
          {isGroup ? (isOpen ? ' ▴' : ' ▾') : ''}
        </Text>
      </Pressable>
    );
  });

  if (compact) {
    const subItems = openGroup?.subItems ?? [];
    const size = compactSubMenuSize(subItems.length, screen.width);
    const place = anchor
      ? placePopover(anchor, size, screen)
      : { left: Math.max(8, (screen.width - size.width) / 2), top: 80, maxHeight: screen.height - 160 };
    const solid = solidColor(theme.surface, solidColor(theme.background, '#ffffff'));
    return (
      <View style={[styles.compactContainer, { borderColor: theme.border }]}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="always"
          contentContainerStyle={styles.compactRow}
        >
          {buttons}
        </ScrollView>
        <Modal visible={Boolean(openGroup)} transparent animationType="none" onRequestClose={() => setOpenGroupId(null)}>
          {/* Fond invisible plein écran : un appui hors du menu le ferme. */}
          <Pressable style={styles.backdrop} onPress={() => setOpenGroupId(null)} accessibilityLabel="Fermer le menu" />
          <View
            style={[
              styles.popover,
              { left: place.left, top: place.top, width: size.width, backgroundColor: solid, borderColor: theme.border },
            ]}
          >
            {subItems.map((subItem) => (
              <Pressable
                key={subItem.id}
                accessibilityRole="button"
                onPress={() => {
                  setOpenGroupId(null);
                  runLeaf(subItem);
                }}
                style={({ pressed }) => [
                  styles.toolbarButton,
                  styles.compactButton,
                  { backgroundColor: pressed ? `${theme.accent}22` : solid },
                ]}
              >
                <Text style={[styles.toolbarButtonText, styles.compactButtonText, { color: theme.text }]}>{subItem.label}</Text>
              </Pressable>
            ))}
          </View>
        </Modal>
      </View>
    );
  }

  return (
    <View style={[styles.container, { borderColor: theme.border }]}>
      <View style={styles.toolbar}>{buttons}</View>
      {openGroup?.subItems && (
        <View style={[styles.subToolbar, { borderColor: theme.border }]}>
          {openGroup.subItems.map((subItem) => (
            <Pressable
              key={subItem.id}
              onPress={() => {
                // Même chemin qu'un bouton à plat : `run` remonte à
                // l'appelant (H1…H6 du groupe « Titres »).
                runLeaf(subItem);
                setOpenGroupId(null);
              }}
              style={[styles.toolbarButton, { backgroundColor: theme.surface }]}
            >
              <Text style={[styles.toolbarButtonText, { color: theme.text }]}>{subItem.label}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  divider: {
    width: 1,
    alignSelf: 'stretch',
    marginHorizontal: 4,
    marginVertical: 6,
  },
  container: {
    borderBottomWidth: 1,
    paddingBottom: 10,
  },
  toolbar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
  },
  subToolbar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    marginHorizontal: 12,
    marginTop: 8,
    paddingTop: 8,
    paddingLeft: 8,
    borderLeftWidth: 2,
  },
  toolbarButton: {
    minWidth: 32,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 6,
    alignItems: 'center',
  },
  toolbarButtonText: {
    fontSize: 13,
    fontWeight: '600',
  },
  // --- Compact (mobile) : une ligne défilante, cibles tactiles
  compactContainer: {
    borderBottomWidth: 1,
    flexGrow: 0,
    flexShrink: 0,
  },
  compactRow: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  compactButton: {
    minWidth: TOOLBAR_TOUCH_TARGET,
    minHeight: TOOLBAR_TOUCH_TARGET,
    justifyContent: 'center',
    paddingVertical: 0,
  },
  compactButtonText: {
    fontSize: 15,
  },
  backdrop: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  },
  popover: {
    position: 'absolute',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    padding: 6,
    borderWidth: 1,
    borderRadius: 10,
    elevation: 8,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
});
