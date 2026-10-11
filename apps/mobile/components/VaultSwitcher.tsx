import { Pressable, StyleSheet, Text } from 'react-native';

import { useVaults } from '../lib/sync/VaultsContext';
import { useSyncStatus } from '../lib/sync/SyncStatusContext';
import { usePreferences } from '../preferences/PreferencesContext';

// Sélecteur rapide de coffre (vault), affiché dans la barre latérale — voir
// AppShell.tsx. Réutilise le menu contextuel natif générique déjà existant
// (window.contextMenu, voir apps/desktop/electron/contextMenu.js) plutôt que
// de construire un nouveau menu déroulant : aucun nouveau code main-process
// nécessaire pour ce composant. Le changement de coffre lui-même passe par
// VaultsContext (switchVault), qui notifie tout le reste de l'app (Notes,
// Tâches...) via l'évènement `vaults:changed`.
//
// v0.4.54 : le changement est REFUSÉ pendant une synchronisation (verrou
// anti-bascule côté main, même garde ici) — une bascule en plein cycle
// empairait les fichiers locaux du nouveau coffre avec le bucket distant de
// l'ancien (cause du mélange de coffres vécu).
export function VaultSwitcher() {
  const { theme } = usePreferences();
  const { vaults, activeVault, switchVault } = useVaults();
  const { status } = useSyncStatus();
  const syncEnCours = status === 'syncing';
  const contextMenuBridge = typeof window !== 'undefined' ? window.contextMenu : undefined;

  if (!contextMenuBridge) return null;

  const handlePress = () => {
    if (vaults.length === 0) return;
    if (syncEnCours) return; // verrou anti-bascule (voir commentaire plus haut)
    void contextMenuBridge
      .show(vaults.map((v) => ({ id: v.id, label: v.id === activeVault?.id ? `✅ ${v.name}` : v.name })))
      .then((choice) => {
        if (choice) void switchVault(choice);
      });
  };

  return (
    <Pressable
      onPress={handlePress}
      accessibilityLabel={
        syncEnCours ? `Synchronisation en cours — changement de coffre suspendu (${activeVault?.name ?? 'Aucun coffre'})` : undefined
      }
      style={[styles.container, { borderColor: theme.border, backgroundColor: theme.surface }, syncEnCours && { opacity: 0.6 }]}
    >
      <Text style={styles.icon}>🗄️</Text>
      <Text style={[styles.label, { color: theme.text }]} numberOfLines={1}>
        {activeVault?.name ?? 'Aucun coffre'}
      </Text>
      {vaults.length > 1 && <Text style={[styles.caret, { color: theme.textMuted }]}>{syncEnCours ? '⏳' : '▾'}</Text>}
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
