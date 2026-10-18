import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native';

import { useAuth } from '../../lib/sync/AuthContext';
import { restoreFromTrash } from '../../lib/sync/syncEngine';
import { useSyncStatus } from '../../lib/sync/SyncStatusContext';
import { useVaults } from '../../lib/sync/VaultsContext';
import { usePreferences } from '../../preferences/PreferencesContext';
import { ConfirmDialog } from '../dialogs/ConfirmDialog';
import { settingsStyles as s } from './settingsStyles';

type TrashItem = { relPath: string; sizeBytes: number; modifiedAt: string };

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }) +
        ' ' +
        date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

// Corbeille du coffre actif (v0.4.26). Supprimer ne détruit plus rien : le
// fichier part dans `.trash/`, un dossier caché à la racine du coffre qui
// est LUI-MÊME SYNCHRONISÉ — la corbeille est donc partagée entre tous les
// appareils du compte, chaque suppression y atterrit partout. Restaurer
// remet le fichier à son chemin d'origine (structure miroir) et retire la
// tombestone distante (voir restoreFromTrash, syncEngine.ts).
// « Supprimer définitivement » (et « Vider ») sont les seules actions
// destructrices — confirmées, et propagées comme suppressions de la
// corbeille aux autres appareils.
export function TrashSection() {
  const { theme } = usePreferences();
  const auth = useAuth();
  const { activeVault } = useVaults();
  const syncStatus = useSyncStatus();

  const [items, setItems] = useState<TrashItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const [visibleCount, setVisibleCount] = useState(100);

  const remoteVaultId = activeVault?.cloudLinked ? activeVault.remoteVaultId : null;
  const canRestore = Boolean(auth.user?.id && remoteVaultId);

  const refresh = useCallback(async () => {
    if (typeof window === 'undefined' || !window.vault?.listTrash) return;
    try {
      setItems(await window.vault.listTrash());
    } catch {
      setItems([]);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (typeof window === 'undefined' || !window.vault?.listTrash) return;
      try {
        const list = await window.vault.listTrash();
        if (!cancelled) setItems(list);
      } catch {
        if (!cancelled) setItems([]);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [activeVault?.id]);

  if (typeof window !== 'undefined' && !window.vault?.listTrash) return null;

  const restore = async (item: TrashItem) => {
    const ownerId = auth.user?.id;
    if (!ownerId || !remoteVaultId) return;
    setBusy(true);
    try {
      // EXCLUSIF : entre le déplacement local et la suppression de la
      // tombestone distante, un cycle auto déclenché par le déplacement
      // pouvait repousser la tombestone et ANNULER la restauration en
      // transparence (vécu 14/10/2026 : « tout se synchronise avant que le
      // fichier soit posé, et rien ne se restaure réellement »). Un SEUL
      // cycle part ensuite, sur l'état final cohérent.
      await syncStatus.runSyncExclusive(() => restoreFromTrash(item.relPath, remoteVaultId, ownerId));
      await syncStatus.runSync();
      await refresh();
    } catch (error) {
      Alert.alert('Restauration impossible', String(error instanceof Error ? error.message : error));
    } finally {
      setBusy(false);
    }
  };

  const destroy = async (item: TrashItem) => {
    setBusy(true);
    try {
      await syncStatus.runSyncExclusive(async () => {
        await window.vault?.delete(item.relPath, { permanent: true, silent: true });
      });
      await syncStatus.runSync();
      await refresh();
    } catch (error) {
      Alert.alert('Suppression impossible', String(error instanceof Error ? error.message : error));
    } finally {
      setBusy(false);
    }
  };

  const restoreAll = async () => {
    const ownerId = auth.user?.id;
    if (!ownerId || !remoteVaultId || !items?.length) return;
    setBusy(true);
    try {
      // UNE seule opération exclusive pour TOUTES les restaurations, puis un
      // seul cycle (même logique que restore, cf. v0.4.65).
      await syncStatus.runSyncExclusive(async () => {
        for (const item of items) {
          await restoreFromTrash(item.relPath, remoteVaultId, ownerId);
        }
      });
      await syncStatus.runSync();
      await refresh();
    } catch (error) {
      Alert.alert('Restauration impossible', String(error instanceof Error ? error.message : error));
    } finally {
      setBusy(false);
    }
  };

  const emptyAll = async () => {
    setBusy(true);
    try {
      await syncStatus.runSyncExclusive(async () => {
        for (const item of items ?? []) {
          await window.vault?.delete(item.relPath, { permanent: true, silent: true });
        }
      });
      await syncStatus.runSync();
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[s.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <Text style={[s.cardTitle, { color: theme.text }]}>🗑️ Corbeille du coffre</Text>
      <Text style={[s.hint, { color: theme.textMuted }]}>
        Supprimer déplace les fichiers ici au lieu de les détruire — et cette corbeille est synchronisée avec tes
        autres appareils : une suppression faite sur un PC y apparaît partout. « Supprimer définitivement » est
        irréversible.
      </Text>
      {!canRestore && items !== null && items.length > 0 && (
        <Text style={[s.hint, { color: theme.textMuted }]}>
          Restaurer nécessite d’être connecté·e à ton compte et que le coffre soit relié au cloud — le bouton
          apparaît grisé tant que ce n’est pas le cas.
        </Text>
      )}

      {items === null ? (
        <ActivityIndicator color={theme.accent} />
      ) : items.length === 0 ? (
        <Text style={[s.hint, { color: theme.textMuted }]}>La corbeille est vide.</Text>
      ) : (
        <View style={{ gap: 6 }}>
          {(items ?? []).slice(0, visibleCount).map((item) => {
            const displayPath = item.relPath.slice('.trash/'.length);
            return (
              <View
                key={item.relPath}
                style={[s.row, { borderColor: theme.border, borderWidth: 1, borderRadius: 6, padding: 8 }]}
              >
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ color: theme.text }}>
                    {displayPath}
                  </Text>
                  <Text style={[s.hint, { color: theme.textMuted }]}>
                    {formatSize(item.sizeBytes)} · {formatDate(item.modifiedAt)}
                  </Text>
                </View>
                <Pressable
                  disabled={busy || !canRestore}
                  onPress={() => void restore(item)}
                  hitSlop={6}
                  style={[
                    s.modeButton,
                    { borderColor: theme.border, paddingVertical: 10, opacity: !canRestore ? 0.4 : 1 },
                  ]}
                >
                  <Text style={{ color: theme.text }}>↩︎ Restaurer</Text>
                </Pressable>
                <Pressable
                  disabled={busy}
                  onPress={() => void destroy(item)}
                  hitSlop={6}
                  style={[s.modeButton, { borderColor: theme.danger, paddingVertical: 10 }]}
                >
                  <Text style={{ color: theme.danger }}>Définitif</Text>
                </Pressable>
              </View>
            );
          })}
          {items.length > visibleCount && (
            <Pressable
              onPress={() => setVisibleCount((count) => count + 100)}
              style={[s.modeButton, { borderColor: theme.border, alignSelf: 'flex-start' }]}
            >
              <Text style={{ color: theme.text }}>Afficher 100 entrées de plus ({items.length - visibleCount} restantes)</Text>
            </Pressable>
          )}
          {canRestore && items.length > 0 && (
            <Pressable
              disabled={busy}
              onPress={() => void restoreAll()}
              style={[s.modeButton, { borderColor: theme.accent, alignSelf: 'flex-start', paddingVertical: 10 }]}
            >
              <Text style={{ color: theme.accent }}>↩︎ Tout restaurer ({items.length} fichier(s))</Text>
            </Pressable>
          )}
          <Pressable
            disabled={busy}
            onPress={() => setConfirmEmpty(true)}
            style={[s.modeButton, { borderColor: theme.danger, alignSelf: 'flex-start' }]}
          >
            <Text style={{ color: theme.danger }}>Vider la corbeille ({items.length})</Text>
          </Pressable>
        </View>
      )}

      {confirmEmpty && (
        <ConfirmDialog
          theme={theme}
          title="Vider la corbeille ?"
          message={`Ces ${items?.length ?? 0} fichier(s) seront définitivement détruits sur TOUT tes appareils — les versions en corbeille ne pourront plus être récupérées. Tape « VIDER » pour confirmer.`}
          confirmLabel="Vider définitivement"
          onConfirm={() => emptyAll()}
          onCancel={() => setConfirmEmpty(false)}
          onSettled={() => setConfirmEmpty(false)}
          requireText="VIDER"
        />
      )}
    </View>
  );
}
