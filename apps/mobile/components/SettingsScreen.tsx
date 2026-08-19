import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { usePreferences } from '../preferences/PreferencesContext';
import { AboutSection } from './settings/AboutSection';
import { AccountSyncSection } from './settings/AccountSyncSection';
import { EditorSection } from './settings/EditorSection';
import { FilesLinksSection } from './settings/FilesLinksSection';
import { PersonalizationCard } from './PersonalizationCard';
import { PrivacyDataSection } from './settings/PrivacyDataSection';
import { PropertiesManagementSection } from './settings/PropertiesManagementSection';

// Écran Paramètres — sous-navigation à 6 sections (voir .claude/CLAUDE.md :
// "complexifier autant que possible" les réglages, et
// apps/mobile/components/settings/). Une pile plate de cartes ne tenait
// plus une fois passé de 3 à 6 sections ; on reprend le même principe que
// AppShell.tsx (rail latéral sur écran large / onglets scrollables sur
// écran étroit) mais à l'échelle de cet écran, avec son propre seuil de
// largeur : le contenu disponible ici est déjà amputé de la largeur du
// rail de AppShell (~220px) sur écran large, donc le seuil est plus haut
// que celui de AppShell.
const SETTINGS_WIDE_BREAKPOINT = 900;

type SettingsSectionId = 'personalization' | 'account' | 'files' | 'editor' | 'properties' | 'privacy' | 'about';

type SettingsSectionDef = {
  id: SettingsSectionId;
  label: string;
  icon: string;
};

const SETTINGS_SECTIONS: SettingsSectionDef[] = [
  { id: 'personalization', label: 'Personnalisation de l’UI', icon: '🎨' },
  { id: 'account', label: 'Compte et synchronisation', icon: '👤' },
  { id: 'files', label: 'Gestion des fichiers et des liens', icon: '🗂️' },
  { id: 'editor', label: 'Éditeur', icon: '✍️' },
  { id: 'properties', label: 'Gestion des propriétés', icon: '🏷️' },
  { id: 'privacy', label: 'Confidentialité et données', icon: '🔒' },
  { id: 'about', label: 'À propos', icon: 'ℹ️' },
];

function renderSection(id: SettingsSectionId) {
  switch (id) {
    case 'personalization':
      return <PersonalizationCard />;
    case 'account':
      return <AccountSyncSection />;
    case 'files':
      return <FilesLinksSection />;
    case 'editor':
      return <EditorSection />;
    case 'properties':
      return <PropertiesManagementSection />;
    case 'privacy':
      return <PrivacyDataSection />;
    case 'about':
      return <AboutSection />;
  }
}

export function SettingsScreen() {
  const { theme } = usePreferences();
  const { width } = useWindowDimensions();
  const isWide = width >= SETTINGS_WIDE_BREAKPOINT;
  const [activeSection, setActiveSection] = useState<SettingsSectionId>('personalization');

  const nav = (
    <View
      style={[
        isWide ? styles.rail : styles.tabBar,
        { backgroundColor: theme.surface, borderColor: theme.border },
      ]}
    >
      <ScrollView
        horizontal={!isWide}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={isWide ? styles.railContent : styles.tabBarContent}
      >
        {SETTINGS_SECTIONS.map((section) => {
          const isActive = section.id === activeSection;
          return (
            <Pressable
              key={section.id}
              onPress={() => setActiveSection(section.id)}
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
                numberOfLines={isWide ? 2 : 1}
              >
                {section.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );

  return (
    <View style={[styles.root, isWide ? styles.rowLayout : styles.columnLayout]}>
      {isWide && nav}
      <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
        {!isWide && nav}
        {renderSection(activeSection)}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    width: '100%',
  },
  rowLayout: {
    flexDirection: 'row',
  },
  columnLayout: {
    flexDirection: 'column',
  },
  rail: {
    width: 240,
    borderRightWidth: 1,
    paddingVertical: 16,
  },
  railContent: {
    gap: 2,
  },
  tabBar: {
    borderBottomWidth: 1,
  },
  tabBarContent: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
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
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
  },
  navIcon: {
    fontSize: 16,
  },
  navLabel: {
    fontSize: 13,
    fontWeight: '500',
  },
  navLabelNarrow: {
    fontSize: 10,
    maxWidth: 72,
    textAlign: 'center',
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: 24,
    gap: 16,
    maxWidth: 560,
    width: '100%',
    alignSelf: 'center',
  },
});
