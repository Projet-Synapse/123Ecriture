import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { useVaults } from '../../lib/sync/VaultsContext';

// Section « Coffres » des réglages (v0.4.83, §16 du journal d'incidents) :
// la BASCULE entre les coffres, absente du mobile jusqu'ici — l'angle mort
// signalé par Catelina (« on ne peut pas basculer entre les plusieurs
// vaults sur mobile… comme si on synchronisait tout dans le même répertoire
// local »). Le registre et le pont (VaultsBridge) géraient déjà plusieurs
// coffres : seul l'écran manquait. Pas de suppression ici volontairement —
// retirer un coffre reste un geste rare qui passe par la déconnexion
// complète (voir AccountSyncSection).
export function VaultSwitcherSection() {
  const { vaults, activeVaultId, switchVault, addExistingVault } = useVaults();
  const [busy, setBusy] = useState<string | null>(null);

  const basculer = async (id: string) => {
    if (id === activeVaultId || busy) return;
    setBusy(id);
    try {
      await switchVault(id);
    } catch (error) {
      Alert.alert('Bascule impossible', error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  const ajouter = async () => {
    if (busy) return;
    setBusy('__ajout__');
    try {
      await addExistingVault();
    } catch (error) {
      Alert.alert('Ajout impossible', error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={styles.card}>
      <Text style={styles.title}>📚 Coffres</Text>
      <Text style={styles.hint}>
        Basculez d’un coffre à l’autre : l’explorateur, les tâches et la synchronisation suivent le coffre actif.
      </Text>
      {vaults.map((vault) => {
        const actif = vault.id === activeVaultId;
        return (
          <View key={vault.id} style={[styles.row, actif && styles.rowActif]}>
            <View style={styles.rowText}>
              <Text style={styles.name} numberOfLines={1}>
                {vault.name}
                {actif ? '  ✅' : ''}
              </Text>
              {vault.cloudLinked ? <Text style={styles.cloud}>☁️ connecté au cloud</Text> : null}
            </View>
            {!actif ? (
              <Pressable
                style={[styles.button, busy === vault.id && styles.buttonBusy]}
                disabled={busy !== null}
                onPress={() => {
                  void basculer(vault.id);
                }}
              >
                <Text style={styles.buttonLabel}>{busy === vault.id ? '…' : 'Utiliser'}</Text>
              </Pressable>
            ) : (
              <Text style={styles.actifLabel}>coffre actif</Text>
            )}
          </View>
        );
      })}
      <Pressable
        style={[styles.buttonAjouter, busy === '__ajout__' && styles.buttonBusy]}
        disabled={busy !== null}
        onPress={() => {
          void ajouter();
        }}
      >
        <Text style={styles.buttonLabel}>+ Ajouter un coffre sur cet appareil</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(128,128,128,0.35)',
    padding: 14,
    gap: 10,
  },
  title: { fontSize: 16, fontWeight: '700' },
  hint: { fontSize: 12, opacity: 0.65 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(128,128,128,0.25)',
    padding: 10,
  },
  rowActif: { borderColor: 'rgba(64,180,120,0.6)' },
  rowText: { flex: 1, minWidth: 0 },
  name: { fontSize: 14, fontWeight: '600' },
  cloud: { fontSize: 11, opacity: 0.6, marginTop: 2 },
  actifLabel: { fontSize: 11, opacity: 0.6 },
  button: {
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: 'rgba(90,140,230,0.18)',
  },
  buttonAjouter: {
    alignSelf: 'flex-start',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: 'rgba(90,140,230,0.12)',
    marginTop: 2,
  },
  buttonBusy: { opacity: 0.5 },
  buttonLabel: { fontSize: 13, fontWeight: '600' },
});
