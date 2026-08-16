import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Theme } from '../theme';

// Panneau persistant à droite de l'éditeur Notes (voir NotesScreen.tsx,
// bouton de repli dans l'en-tête) — un rail de boutons en haut choisit quel
// contenu afficher en dessous. Conçu pour accueillir d'AUTRES onglets plus
// tard (ex. vue graphique des liens) au-delà de Propriétés/Occurrences,
// d'où un rail générique plutôt que deux composants ad hoc. Composant
// purement présentationnel : NotesScreen possède l'état (onglet actif) et
// lui fournit déjà le bon contenu via `children`.
export type SidebarTab = 'properties' | 'occurrences';

type SidebarTabConfig = { id: SidebarTab; icon: string; label: string };

const TABS: SidebarTabConfig[] = [
  { id: 'properties', icon: '🏷️', label: 'Propriétés' },
  { id: 'occurrences', icon: '🔤', label: 'Occurrences' },
];

type Props = {
  theme: Theme;
  activeTab: SidebarTab;
  onSelectTab: (tab: SidebarTab) => void;
  children: ReactNode;
};

export function RightSidebar({ theme, activeTab, onSelectTab, children }: Props) {
  return (
    <View style={[styles.container, { borderColor: theme.border, backgroundColor: theme.surface }]}>
      <View style={[styles.rail, { borderColor: theme.border }]}>
        {TABS.map((tab) => {
          const isActive = tab.id === activeTab;
          return (
            <Pressable
              key={tab.id}
              onPress={() => onSelectTab(tab.id)}
              style={[styles.railButton, isActive && { backgroundColor: `${theme.accent}22` }]}
            >
              <Text style={styles.railIcon}>{tab.icon}</Text>
              <Text style={[styles.railLabel, { color: isActive ? theme.accent : theme.textMuted }]}>
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.body}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: 280,
    borderLeftWidth: 1,
  },
  rail: {
    flexDirection: 'row',
    borderBottomWidth: 1,
  },
  railButton: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
    paddingVertical: 10,
    borderRadius: 6,
  },
  railIcon: {
    fontSize: 16,
  },
  railLabel: {
    fontSize: 11,
    fontWeight: '600',
  },
  body: {
    flex: 1,
  },
});
