import { Pressable, StyleSheet, Text } from 'react-native';

import { useVaults } from '../lib/sync/VaultsContext';
import { usePreferences } from '../preferences/PreferencesContext';

// Sélecteur rapide de coffre (vault), affiché dans la barre latérale — voir
// AppShell.tsx. Réutilise le menu contextuel natif générique déjà existant
// (window.contextMenu, voir apps/desktop/electron/contextMenu.js) plutôt que
// de construire un nouveau menu déroulant : aucun nouveau code main-process
// nécessaire pour ce composant. Le changement de coffre lui-même passe par
// VaultsContext (switchVault), qui notifie tout le reste de l'app (Notes,
// Tâches...) via l'évènement `vaults:changed`.
export function VaultSwitcher() {
  const { theme } = usePreferences();
  const { vaults, activeVault, switchVault } = useVaults();
  const contextMenuBridge = typeof window !== 'undefined' ? window.contextMenu : undefined;

  if (!contextMenuBridge) return null;

  const handlePress = () => {
    if (vaults.length === 0) return;
    void contextMenuBridge
      .show(vaults.map((v) => ({ id: v.id, label: v.id === activeVault?.id ? `✅ ${v.name}` : v.name })))
      .then((choice) => {
        if (choice) void switchVault(choice);
      });
  };

  return (
    <Pressable
      onPress={handlePress}
      style={[styles.container, { borderColor: theme.border, backgroundColor: theme.surface }]}
    >
      <Text style={styles.icon}>🗄️</Text>
      <Text style={[styles.label, { color: theme.text }]} numberOfLines={1}>
        {activeVault?.name ?? 'Aucun coffre'}
      </Text>
      {vaults.length > 1 && <Text style={[styles.caret, { color: theme.textMuted }]}>▾</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginHorizontal: 8,
    marginBottom: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
  },
  icon: {
    fontSize: 13,
  },
  label: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
  },
  caret: {
    fontSize: 11,
  },
});
