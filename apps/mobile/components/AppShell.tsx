import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import type { Section } from '../navigation';
import { usePreferences } from '../preferences/PreferencesContext';

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

  const nav = (
    <View
      style={[
        isWide ? styles.sidebar : styles.tabBar,
        { backgroundColor: theme.surface, borderColor: theme.border },
      ]}
    >
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
      {isWide && nav}
      <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
        {children}
      </ScrollView>
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
  contentContainer: {
    flexGrow: 1,
  },
});
