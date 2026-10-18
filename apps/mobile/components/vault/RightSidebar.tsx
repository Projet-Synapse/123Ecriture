import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Theme } from '../../theme';

// ✒️ 123ECRITURE — components/vault/RightSidebar.tsx — le panneau latéral droit des notes
//////////////////////////////////////////////////////////////////////////////
//
// Panneau persistant à droite de l'éditeur Notes (voir NotesScreen.tsx,
// bouton de repli dans l'en-tête) : un rail de boutons en haut choisit quel
// contenu afficher en dessous (Propriétés / Occurrences / Plan).
//
// Invariants du fichier :
//   • Composant purement présentationnel : NotesScreen possède l'état
//     (onglet actif) et fournit déjà le bon contenu via `children`.
//   • Rail d'onglets GÉNÉRIQUE (tableau TABS) plutôt que deux composants
//     ad hoc : il accueille de nouveaux onglets en ajoutant une entrée.
//   • `width` est optionnelle et retombe sur la largeur fixe d'origine
//     (280) si omise — ex. un appelant sans redimensionnement.
//
//////////////////////////////////////////////////////////////////////////////

export type SidebarTab = 'properties' | 'occurrences' | 'outline';

type SidebarTabConfig = { id: SidebarTab; icon: string; label: string };

const TABS: SidebarTabConfig[] = [
  { id: 'properties', icon: '🏷️', label: 'Propriétés' },
  { id: 'occurrences', icon: '🔤', label: 'Occurrences' },
  { id: 'outline', icon: '📑', label: 'Plan' },
];

type Props = {
  theme: Theme;
  activeTab: SidebarTab;
  onSelectTab: (tab: SidebarTab) => void;
  children: ReactNode;
  // Redimensionnable au curseur depuis NotesScreen.tsx (voir
  // lib/useResizablePanel.ts) — optionnelle, retombe sur la largeur fixe
  // d'origine si omise (ex. futur appelant qui n'aurait pas encore ce
  // besoin).
  width?: number;
};

export function RightSidebar({ theme, activeTab, onSelectTab, children, width }: Props) {
  return (
    <View
      style={[
        styles.container,
        width !== undefined && { width },
        { borderColor: theme.border, backgroundColor: theme.surface },
      ]}
    >
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
