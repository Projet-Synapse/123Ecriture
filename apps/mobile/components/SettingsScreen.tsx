import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { PersonalizationCard } from './PersonalizationCard';
import { useAuth } from '../lib/sync/AuthContext';
import { linkVaultToCloud, runSync, type SyncSummary } from '../lib/sync/syncEngine';
import { useVaults } from '../lib/sync/VaultsContext';
import { usePreferences } from '../preferences/PreferencesContext';

// Écran Paramètres : personnalisation de l'interface (toujours disponible),
// coffres (vaults) multiples et traqueur de mise à jour (dépendent de ponts
// exposés uniquement par Electron desktop — window.vault / window.vaults /
// window.updater, voir apps/desktop/electron/preload.js).
export function SettingsScreen() {
  const { theme } = usePreferences();
  const vault = typeof window !== 'undefined' ? window.vault : undefined;
  const updater = typeof window !== 'undefined' ? window.updater : undefined;
  const {
    vaults: vaultList,
    activeVaultId,
    switchVault,
    addExistingVault,
    createVault,
    renameVault,
    removeVault,
    setCloudLink,
  } = useVaults();
  const auth = useAuth();

  const [version, setVersion] = useState<string | null>(null);
  const [status, setStatus] = useState<UpdaterStatus>({ state: 'idle' });
  const [vaultActionError, setVaultActionError] = useState<string | null>(null);
  const [renamingVaultId, setRenamingVaultId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createDraft, setCreateDraft] = useState('');
  const [syncingVaultId, setSyncingVaultId] = useState<string | null>(null);
  const [syncResults, setSyncResults] = useState<Record<string, { summary?: SyncSummary; error?: string }>>({});

  const runVaultAction = useCallback(async (action: () => Promise<void>) => {
    setVaultActionError(null);
    try {
      await action();
    } catch (error) {
      console.error('[vaults] échec :', error);
      setVaultActionError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  const startRenameVault = (v: VaultRegistryEntry) => {
    setRenamingVaultId(v.id);
    setRenameDraft(v.name);
  };

  const submitRenameVault = useCallback(async () => {
    if (!renamingVaultId) return;
    const id = renamingVaultId;
    const name = renameDraft;
    setRenamingVaultId(null);
    await runVaultAction(() => renameVault(id, name));
  }, [renamingVaultId, renameDraft, renameVault, runVaultAction]);

  const submitCreateVault = useCallback(async () => {
    const name = createDraft.trim();
    if (!name) return;
    setShowCreateForm(false);
    setCreateDraft('');
    await runVaultAction(() => createVault(name));
  }, [createDraft, createVault, runVaultAction]);

  const handleLinkVault = useCallback(
    async (v: VaultRegistryEntry) => {
      if (!auth.user) return;
      setSyncResults((prev) => ({ ...prev, [v.id]: {} }));
      try {
        const remoteVaultId = await linkVaultToCloud(v.id, v.name, auth.user.id);
        await setCloudLink(v.id, { linked: true, remoteVaultId });
      } catch (error) {
        console.error('[sync] échec de la liaison au cloud :', error);
        setSyncResults((prev) => ({
          ...prev,
          [v.id]: { error: error instanceof Error ? error.message : String(error) },
        }));
      }
    },
    [auth.user, setCloudLink],
  );

  const handleSyncVault = useCallback(
    async (v: VaultRegistryEntry) => {
      if (!auth.user || !v.remoteVaultId) return;
      setSyncingVaultId(v.id);
      setSyncResults((prev) => ({ ...prev, [v.id]: {} }));
      try {
        const summary = await runSync(v.remoteVaultId, auth.user.id);
        setSyncResults((prev) => ({ ...prev, [v.id]: { summary } }));
      } catch (error) {
        console.error('[sync] échec de la synchronisation :', error);
        setSyncResults((prev) => ({
          ...prev,
          [v.id]: { error: error instanceof Error ? error.message : String(error) },
        }));
      } finally {
        setSyncingVaultId(null);
      }
    },
    [auth.user],
  );

  useEffect(() => {
    if (!updater) return;
    void updater.getVersion().then(setVersion);
    // Récupère l'état déjà connu du process principal avant de s'abonner :
    // la vérification de mise à jour démarre au lancement de l'app, donc
    // les tout premiers événements (checking/downloading...) peuvent être
    // passés avant même que cet écran ne soit monté. Sans ce snapshot,
    // Paramètres afficherait un état par défaut périmé tant qu'aucun
    // nouvel événement n'arrive.
    void updater.getStatus().then(setStatus);
    const unsubscribe = updater.onStatusChange(setStatus);
    return unsubscribe;
  }, [updater]);

  const handleCheckForUpdates = useCallback(async () => {
    if (!updater) return;
    await updater.check();
  }, [updater]);

  const handleInstall = useCallback(async () => {
    if (!updater) return;
    try {
      await updater.quitAndInstall();
    } catch (error) {
      console.error('[updater] échec de l’installation :', error);
      setStatus({ state: 'error', message: String(error) });
    }
  }, [updater]);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <PersonalizationCard />

      {auth.available && (
        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Text style={[styles.cardTitle, { color: theme.text }]}>Compte</Text>
          {auth.loading ? (
            <View style={styles.statusRow}>
              <ActivityIndicator size="small" color={theme.accent} />
              <Text style={{ color: theme.textMuted }}>Vérification de la session…</Text>
            </View>
          ) : auth.user ? (
            <>
              <Text style={[styles.cardValue, { color: theme.textMuted }]}>
                Connecté·e : {auth.user.email ?? auth.user.id}
              </Text>
              <Pressable
                onPress={() => void auth.signOut()}
                style={[styles.button, { backgroundColor: theme.accent }]}
              >
                <Text style={styles.buttonText}>Se déconnecter</Text>
              </Pressable>
            </>
          ) : (
            <Pressable
              onPress={() => void auth.signInWithGoogle()}
              style={[styles.button, { backgroundColor: theme.accent }]}
            >
              <Text style={styles.buttonText}>Se connecter avec Google</Text>
            </Pressable>
          )}
          {auth.error && <Text style={styles.error}>⚠️ {auth.error}</Text>}
        </View>
      )}

      {vault && (
        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Text style={[styles.cardTitle, { color: theme.text }]}>Coffres</Text>

          {vaultList.length === 0 && (
            <Text style={[styles.cardValue, { color: theme.textMuted }]}>Aucun coffre pour l’instant.</Text>
          )}

          {vaultList.map((v) => {
            const isActive = v.id === activeVaultId;
            const isRenaming = renamingVaultId === v.id;
            return (
              <View key={v.id} style={[styles.vaultRow, { borderColor: theme.border }]}>
                <Pressable
                  onPress={() => !isActive && void runVaultAction(() => switchVault(v.id))}
                  style={styles.vaultRowMain}
                >
                  <Text style={styles.vaultCheck}>{isActive ? '✅' : '🗄️'}</Text>
                  {isRenaming ? (
                    <TextInput
                      autoFocus
                      value={renameDraft}
                      onChangeText={setRenameDraft}
                      onSubmitEditing={() => void submitRenameVault()}
                      onBlur={() => void submitRenameVault()}
                      style={[styles.vaultRenameInput, { color: theme.text, borderColor: theme.accent }]}
                    />
                  ) : (
                    <View>
                      <Text style={{ color: theme.text, fontWeight: isActive ? '600' : '400' }}>
                        {v.name}
                      </Text>
                      <Text style={[styles.vaultPathText, { color: theme.textMuted }]} numberOfLines={1}>
                        {v.path}
                      </Text>
                    </View>
                  )}
                </Pressable>
                {!isRenaming && (
                  <Pressable onPress={() => startRenameVault(v)} style={styles.vaultRowAction}>
                    <Text style={{ color: theme.textMuted }}>✏️</Text>
                  </Pressable>
                )}
                <Pressable onPress={() => void runVaultAction(() => removeVault(v.id))} style={styles.vaultRowAction}>
                  <Text style={{ color: theme.textMuted }}>✕</Text>
                </Pressable>
              </View>
            );
          })}

          {auth.user &&
            vaultList.map((v) => {
              const isSyncing = syncingVaultId === v.id;
              const result = syncResults[v.id];
              return (
                <View key={`sync-${v.id}`} style={styles.syncRow}>
                  <Text style={[styles.vaultPathText, { color: theme.textMuted }]} numberOfLines={1}>
                    ☁️ {v.name}
                  </Text>
                  {!v.cloudLinked ? (
                    <Pressable
                      onPress={() => void handleLinkVault(v)}
                      style={[styles.syncButton, { backgroundColor: theme.accent }]}
                    >
                      <Text style={styles.buttonText}>Lier ce coffre au cloud</Text>
                    </Pressable>
                  ) : (
                    <Pressable
                      onPress={() => !isSyncing && void handleSyncVault(v)}
                      style={[styles.syncButton, { backgroundColor: theme.accent, opacity: isSyncing ? 0.6 : 1 }]}
                    >
                      {isSyncing ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <Text style={styles.buttonText}>Synchroniser maintenant</Text>
                      )}
                    </Pressable>
                  )}
                  {result?.summary && (
                    <Text style={[styles.vaultPathText, { color: theme.textMuted }]}>
                      {result.summary.pushed} envoyée(s), {result.summary.pulled} reçue(s),{' '}
                      {result.summary.conflicts} conflit(s)
                      {result.summary.errors.length > 0
                        ? ` — ${result.summary.errors.length} erreur(s)`
                        : ''}
                    </Text>
                  )}
                  {result?.error && <Text style={styles.error}>⚠️ {result.error}</Text>}
                </View>
              );
            })}

          {vaultActionError && <Text style={styles.error}>⚠️ {vaultActionError}</Text>}

          <View style={styles.vaultButtonsRow}>
            <Pressable
              onPress={() => void runVaultAction(addExistingVault)}
              style={[styles.button, { backgroundColor: theme.accent }]}
            >
              <Text style={styles.buttonText}>Ajouter un dossier existant</Text>
            </Pressable>
            <Pressable
              onPress={() => setShowCreateForm((prev) => !prev)}
              style={[styles.button, { backgroundColor: theme.accent }]}
            >
              <Text style={styles.buttonText}>Nouveau coffre</Text>
            </Pressable>
          </View>

          {showCreateForm && (
            <View style={styles.vaultButtonsRow}>
              <TextInput
                autoFocus
                value={createDraft}
                onChangeText={setCreateDraft}
                onSubmitEditing={() => void submitCreateVault()}
                placeholder="Nom du nouveau coffre…"
                placeholderTextColor={theme.textMuted}
                style={[styles.input, { color: theme.text, borderColor: theme.border }]}
              />
              <Pressable
                onPress={() => void submitCreateVault()}
                style={[styles.button, { backgroundColor: theme.accent }]}
              >
                <Text style={styles.buttonText}>Créer</Text>
              </Pressable>
            </View>
          )}
        </View>
      )}

      {updater && (
        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Text style={[styles.cardTitle, { color: theme.text }]}>Mises à jour</Text>
          <Text style={[styles.cardValue, { color: theme.textMuted }]}>
            Version installée : {version ?? '…'}
          </Text>

          {status.state === 'idle' && (
            <View style={styles.statusRow}>
              <ActivityIndicator size="small" color={theme.accent} />
              <Text style={{ color: theme.textMuted }}>Initialisation…</Text>
            </View>
          )}

          {status.state === 'checking' && (
            <View style={styles.statusRow}>
              <ActivityIndicator size="small" color={theme.accent} />
              <Text style={{ color: theme.textMuted }}>Vérification…</Text>
            </View>
          )}

          {status.state === 'up-to-date' && (
            <>
              <Text style={{ color: theme.textMuted }}>✅ À jour.</Text>
              <Pressable
                onPress={() => void handleCheckForUpdates()}
                style={[styles.button, { backgroundColor: theme.accent }]}
              >
                <Text style={styles.buttonText}>Vérifier les mises à jour</Text>
              </Pressable>
            </>
          )}

          {status.state === 'downloading' && (
            <View style={styles.statusRow}>
              <ActivityIndicator size="small" color={theme.accent} />
              <Text style={{ color: theme.textMuted }}>
                Téléchargement de la v{status.version ?? '?'}… {status.percent}%
              </Text>
            </View>
          )}

          {status.state === 'ready' && (
            <>
              <Text style={{ color: theme.textMuted }}>
                🎉 Version {status.version} prête à installer.
              </Text>
              <Pressable
                onPress={() => void handleInstall()}
                style={[styles.button, { backgroundColor: theme.accent }]}
              >
                <Text style={styles.buttonText}>Redémarrer et installer</Text>
              </Pressable>
            </>
          )}

          {status.state === 'error' && (
            <>
              <Text style={styles.error}>⚠️ {status.message}</Text>
              <Pressable
                onPress={() => void handleCheckForUpdates()}
                style={[styles.button, { backgroundColor: theme.accent }]}
              >
                <Text style={styles.buttonText}>Réessayer</Text>
              </Pressable>
            </>
          )}
        </View>
      )}

      {!vault && !updater && (
        <Text style={[styles.muted, { color: theme.textMuted }]}>
          Vault et mises à jour sont disponibles sur la version desktop pour l’instant.
        </Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 24,
    gap: 16,
    maxWidth: 480,
    width: '100%',
    alignSelf: 'center',
  },
  muted: {
    fontSize: 14,
    textAlign: 'center',
    maxWidth: 360,
  },
  card: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    gap: 10,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  cardValue: {
    fontSize: 13,
  },
  button: {
    alignSelf: 'flex-start',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  error: {
    color: '#dc2626',
  },
  vaultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
    borderBottomWidth: 1,
  },
  vaultRowMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  vaultCheck: {
    fontSize: 14,
  },
  vaultPathText: {
    fontSize: 11,
  },
  vaultRenameInput: {
    flex: 1,
    borderBottomWidth: 1,
    paddingVertical: 2,
    fontSize: 14,
  },
  vaultRowAction: {
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  vaultButtonsRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  input: {
    flex: 1,
    minWidth: 160,
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    fontSize: 14,
  },
  syncRow: {
    gap: 6,
    paddingVertical: 6,
    paddingLeft: 8,
  },
  syncButton: {
    alignSelf: 'flex-start',
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 8,
    minWidth: 100,
    alignItems: 'center',
  },
});
