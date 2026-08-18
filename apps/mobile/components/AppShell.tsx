import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import type { Section } from '../navigation';
import { useResizablePanel } from '../lib/useResizablePanel';
import { usePreferences } from '../preferences/PreferencesContext';
import { ResizeHandle } from './ResizeHandle';
import { VaultSwitcher } from './VaultSwitcher';

// Coquille de navigation générale de l'app : panneau de sections (Notes,
// Tâches, Calendrier...) + zone de contenu. Bascule automatiquement entre
// barre latérale (écrans larges : desktop/web/tablette) et barre d'onglets
// en bas (écrans étroits : téléphone) — un même composant pour toutes les
// plateformes, cohérent avec la vision « app multiplateforme » de
// docs/ARCHITECTURE.md.
const WIDE_BREAKPOINT = 720;

type Props = {
  sections: Section[];
  activeId: string;
  onSelect: (id: string) => void;
  children: ReactNode;
};

export function AppShell({ sections, activeId, onSelect, children }: Props) {
  const { theme } = usePreferences();
  const { width } = useWindowDimensions();
  const isWide = width >= WIDE_BREAKPOINT;
  // Redimensionnable/repliable au curseur (voir lib/useResizablePanel.ts) —
  // seulement pertinent en mode barre latérale large ; en mode barre
  // d'onglets (étroit), la nav n'a pas de largeur à faire varier.
  const navPanel = useResizablePanel('nav', { min: 72, max: 360, edge: 1 });

  const nav = (
    <View
      style={[
        isWide ? [styles.sidebar, { width: navPanel.width }] : styles.tabBar,
        { backgroundColor: theme.surface, borderColor: theme.border },
      ]}
    >
      {isWide && <VaultSwitcher />}
      {sections.map((section) => {
        const isActive = section.id === activeId;
        return (
          <Pressable
            key={section.id}
            onPress={() => onSelect(section.id)}
            style={[
              isWide ? styles.navItemWide : styles.navItemNarrow,
              isActive && { backgroundColor: `${theme.accent}22` },
            ]}
          >
            <Text style={styles.navIcon}>{section.icon}</Text>
            <Text
              style={[
                styles.navLabel,
                { color: isActive ? theme.accent : theme.textMuted },
                !isWide && styles.navLabelNarrow,
              ]}
            >
              {section.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );

  return (
    <View
      style={[styles.root, { backgroundColor: theme.background }, isWide ? styles.rowLayout : styles.columnLayout]}
    >
      {isWide && (
        <>
          <View style={styles.sidebarClip}>{nav}</View>
          <ResizeHandle
            theme={theme}
            side="left"
            collapsed={navPanel.collapsed}
            isDragging={navPanel.isDragging}
            onMouseDown={navPanel.onHandleMouseDown}
            onToggleCollapsed={navPanel.toggleCollapsed}
          />
        </>
      )}
      {/* Vue simple (pas de ScrollView) : chaque écran gère son propre
          scroll interne (NotesScreen.tsx a déjà le sien pour l'explorateur
          ET pour l'éditeur, SettingsScreen.tsx/CalendarScreen.tsx idem) —
          un ScrollView imbriquant un autre ScrollView casse la chaîne
          flex:1 dont dépend un scroll indépendant sur le web : c'était le
          scroll EXTÉRIEUR ici qui captait la molette au lieu du scroll
          propre à l'explorateur de fichiers. Vérifié : seul
          PlaceholderScreen.tsx n'a aucun ScrollView à lui (texte centré,
          n'en a jamais eu besoin) — rien ne dépendait de celui-ci. */}
      <View style={styles.content}>{children}</View>
      {!isWide && nav}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  rowLayout: {
    flexDirection: 'row',
  },
  columnLayout: {
    flexDirection: 'column',
  },
  // `overflow: hidden` : masque proprement le contenu de la nav pendant
  // qu'elle se réduit vers 0 au glisser/repli, plutôt que de le laisser
  // déborder par-dessus le contenu principal.
  sidebarClip: {
    overflow: 'hidden',
  },
  sidebar: {
    width: 220,
    borderRightWidth: 1,
    paddingVertical: 16,
  },
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    paddingVertical: 8,
    justifyContent: 'space-around',
  },
  navItemWide: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginHorizontal: 8,
  },
  navItemNarrow: {
    alignItems: 'center',
    gap: 2,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  navIcon: {
    fontSize: 18,
  },
  navLabel: {
    fontSize: 14,
    fontWeight: '500',
  },
  navLabelNarrow: {
    fontSize: 11,
  },
  content: {
    flex: 1,
  },
});
