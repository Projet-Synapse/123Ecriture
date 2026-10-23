import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { useAuth } from '../../lib/sync/AuthContext';
import { setDeviceRemoteLock ,
  createRemoteVault,
  linkVaultToCloud,
  listRemoteVaults,
  renameRemoteVault,
} from '../../lib/sync/cloud';
import { useSyncStatus } from '../../lib/sync/SyncStatusContext';
import { formatLastCycle, formatLastSeen } from '../../lib/sync/devices';
import type { RemoteVaultSummary, SyncSummary } from '../../lib/sync/syncTypes';
import { useVaults } from '../../lib/sync/VaultsContext';
import { usePreferences } from '../../preferences/PreferencesContext';
import { ConfirmDialog } from '../dialogs/ConfirmDialog';
import { MergeLinkDialog, type MergeChoice } from '../dialogs/MergeLinkDialog';
import { loadSyncSettings, saveSyncSettings } from '../../lib/sync/syncSettings';
import { SettingsToggle } from './SettingsToggle';
import { settingsStyles as s } from './settingsStyles';
import { errorMessage } from '../../lib/errorMessage';

// ✒️ 123ECRITURE — components/settings/AccountSyncSection.tsx — le compte et les coffres + sync cloud
//////////////////////////////////////////////////////////////////////////////
//
// Section "Compte et synchronisation" de Paramètres : Compte
// (Google/Supabase) et Coffres multiples + sync cloud. Trois cartes :
// Compte (session), Coffres distants (ce que le COMPTE possède dans le
// cloud), Coffres locaux (registre de l'appareil + boutons de sync).
//
// Invariants du fichier :
//   • Dépend de ponts exposés uniquement par Electron desktop
//     (window.auth/window.vaults — voir apps/desktop/electron/preload.ts) ;
//     sur web/mobile, la section explique pourquoi elle est vide plutôt
//     que de disparaître silencieusement.
//   • Le statut de synchro vient du contexte partagé (SyncStatusContext) :
//     source de vérité pour le coffre ACTIF, la même que l'indicateur
//     global de AppShell.tsx. Les autres coffres liés gardent leur propre
//     state local — le contexte ne suit que "le" coffre courant.
//   • Le moteur de sync opère TOUJOURS sur le coffre ACTIF : synchroniser
//     un coffre non actif sans basculer d'abord lirait/écrirait dans le
//     dossier du coffre actif (contamination croisée). Toujours : bascule
//     d'abord, sync ensuite — zéro contournement du pont.
//   • Retrait d'un coffre = confirmation (le disque n'est pas effacé, mais
//     un ✕ frôlé délierait la liaison cloud) ; déconnexion d'un coffre
//     distant = confirmation DESTRUCTIVE avec avertissement explicite
//     (le contenu local est supprimé, la corbeille OS n'est pas utilisée).
//   • Le coffre distant est une donnée du COMPTE (modèle Obsidian Sync) :
//     il peut être créé sans machine, retrouvé sur un nouvel appareil, et
//     un coffre local peut se raccorder à un distant existant sans
//     aucune écriture cloud.
//
// SOMMAIRE :
//   1. AccountSyncSection — les états et les handlers
//   2. Le rendu — Compte, Coffres distants, Coffres locaux
//   3. Les styles
//
//////////////////////////////////////////////////////////////////////////////

//////// 1. AccountSyncSection — les états et les handlers ////////////////////////////////

export function AccountSyncSection() {
  const { theme, preferences, setAutoSyncEnabled } = usePreferences();
  const auth = useAuth();
  const {
    vaults: vaultList,
    activeVaultId,
    switchVault,
    addExistingVault,
    retrieveRemoteVault,
    createVault,
    renameVault,
    removeVault,
    disconnectVault,
    setCloudLink,
    vaultFolderIssues,
    relocateVault,
  } = useVaults();
  const vault = typeof window !== 'undefined' ? window.vault : undefined;
  // Android 100 % cloud (v0.4.96) : aucun dossier local, aucune
  // déconnexion destructive ; les anciens coffres non liés sont « à
  // importer » (lecture seule de l'ancien dossier).
  const syncStatus = useSyncStatus();
  const cloudOnly = typeof window !== 'undefined' && window.vaults?.cloudOnly === true;
  const [importState, setImportState] = useState<{ id: string; text: string; busy: boolean } | null>(null);
  const [cloudStatus, setCloudStatus] = useState<string | null>(null);
  useEffect(() => {
    if (!cloudOnly || !vault?.cloudSync) return;
    let alive = true;
    const refresh = () =>
      void vault.cloudSync!
        .status()
        .then((st) => {
          if (!alive) return;
          const parts = [`${st.files} fichier(s) dans le cloud`, `${st.cached} disponible(s) hors ligne`];
          parts.push(st.pending > 0 ? `${st.pending} modification(s) en attente d’envoi` : 'tout est envoyé');
          if (st.conflicts.length > 0) parts.push(`${st.conflicts.length} conflit(s) — copies « (conflit …) » créées`);
          setCloudStatus(parts.join(' · '));
        })
        .catch(() => alive && setCloudStatus(null));
    refresh();
    const t = setInterval(refresh, 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [cloudOnly, vault, activeVaultId, syncStatus.status]);
  // Statut partagé (voir SyncStatusContext.tsx) — source de vérité pour le
  // coffre ACTIF, la même que l'indicateur global de AppShell.tsx. Les
  // autres coffres liés (non actifs) gardent leur propre state local
  // ci-dessous : le contexte ne suit que "le" coffre courant, comme
  // l'indicateur global qui n'a de sens que pour un seul coffre à la fois.

  const [vaultActionError, setVaultActionError] = useState<string | null>(null);
  const [renamingVaultId, setRenamingVaultId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createDraft, setCreateDraft] = useState('');
  // Retirer un coffre n'efface rien sur le disque (vaults.ts ne filtre que
  // le registre), mais un ✕ frôlé délierait aussi sa liaison cloud — d'où
  // la même confirmation que la suppression de liste de tâches
  // (ConfirmDialog), plutôt qu'un retrait immédiat au simple clic.
  const [confirmRemoveVault, setConfirmRemoveVault] = useState<VaultRegistryEntry | null>(null);
  // Déconnexion d'un coffre distant (destructive : supprime le contenu
  // déposé) — même patron de confirmation que le retrait, mais avec un
  // avertissement explicite car la corbeille OS n'est pas utilisée.
  const [confirmDisconnectVault, setConfirmDisconnectVault] = useState<VaultRegistryEntry | null>(null);

  // Connexion email/mot de passe (voir AuthContext) — formulaire déplié à la
  // demande sous le bouton Google, pour ne pas surcharger la carte Compte.
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [emailDraft, setEmailDraft] = useState('');
  const [passwordDraft, setPasswordDraft] = useState('');
  const [authBusy, setAuthBusy] = useState(false);

  // Coffres distants du compte (listRemoteVaults — lecture seule). null =
  // pas encore chargé (distinct de [] = aucun). Rechargé après chaque
  // liaison/création pour que la carte reste la source de vérité.
  const [remoteVaults, setRemoteVaults] = useState<RemoteVaultSummary[] | null>(null);
  const [remoteVaultsError, setRemoteVaultsError] = useState<string | null>(null);
  const [retrievingRemoteId, setRetrievingRemoteId] = useState<string | null>(null);
  // Coffre local pour lequel le sélecteur « se connecter à un existant » est
  // déplié (les distants déjà reliés à un AUTRE coffre local en sont exclus).
  const [pickingRemoteForVaultId, setPickingRemoteForVaultId] = useState<string | null>(null);
  // Renommage d'un coffre distant (le nom est cosmétique, l'id reste la clé
  // de liaison — le renommage se répercute sur tous les appareils).
  const [renamingRemoteId, setRenamingRemoteId] = useState<string | null>(null);
  const [renamingRemoteDraft, setRenamingRemoteDraft] = useState('');
  const [renamingRemoteBusy, setRenamingRemoteBusy] = useState(false);
  // Verrou à distance d'un appareil : busy par deviceId.
  const [lockBusyId, setLockBusyId] = useState<string | null>(null);

  const runVaultAction = useCallback(async (action: () => Promise<unknown>) => {
    setVaultActionError(null);
    try {
      await action();
    } catch (error) {
      console.error('[vaults] échec :', error);
      setVaultActionError(errorMessage(error));
    }
  }, []);

  // Verrou à distance d'un appareil (urgence) : pose/lève le verrou cloud
  // qui interdit tout cycle sur la machine ciblée.
  const handleDeviceLock = useCallback(
    async (deviceId: string, locked: boolean) => {
      if (!remoteVaults) return;
      const vaultId = remoteVaults.find((r) => r.devices.some((d) => d.deviceId === deviceId))?.id;
      if (!vaultId) return;
      setLockBusyId(deviceId);
      setRemoteVaultsError(null);
      try {
        await setDeviceRemoteLock(vaultId, deviceId, locked, locked ? 'Verrouillé depuis Paramètres' : undefined);
        setRemoteVaults(await listRemoteVaults());
      } catch (error) {
        console.error('[vaults] verrou à distance :', error);
        setRemoteVaultsError(errorMessage(error));
      } finally {
        setLockBusyId(null);
      }
    },
    [remoteVaults],
  );

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

  const loadRemoteVaults = useCallback(() => {
    listRemoteVaults()
      .then((list) => {
        setRemoteVaults(list);
        setRemoteVaultsError(null);
      })
      .catch((error) => {
        console.error('[sync] échec du listage des coffres distants :', error);
        setRemoteVaultsError(errorMessage(error));
      });
  }, []);

  // Renomme un COFFRE DISTANT (le nom est cosmétique, l'id reste la clé de
  // liaison — le renommage se répercute sur tous les appareils au prochain
  // chargement de la carte). Erreurs affichées sous la carte.
  const submitRenameRemoteVault = useCallback(
    async (id: string, name: string) => {
      const trimmed = name.trim();
      if (!trimmed || renamingRemoteBusy) return;
      setRenamingRemoteBusy(true);
      try {
        await renameRemoteVault(id, trimmed);
        setRenamingRemoteId(null);
        loadRemoteVaults();
      } catch (error) {
        console.error('[vaults] échec du renommage :', error);
        setRemoteVaultsError(errorMessage(error));
      } finally {
        setRenamingRemoteBusy(false);
      }
    },
    [renamingRemoteBusy, loadRemoteVaults],
  );

  // Recharge aussi quand le nombre de coffres liés change : la liaison
  // automatique (VaultsContext) crée des coffres distants en arrière-plan,
  // la carte doit refléter ces apparitions sans attendre un rafraîchissement
  // manuel.
  const linkedVaultCount = vaultList.filter((v) => v.cloudLinked).length;
  // Pas de réinitialisation synchrone au logout (règle lint setState-in-
  // effect) : la carte « Coffres distants » n'est rendue QUE connecté·e
  // (auth.user && vault), une liste périmée hors session ne s'affiche jamais.
  useEffect(() => {
    if (!auth.user) return;
    loadRemoteVaults();
  }, [auth.user, linkedVaultCount, loadRemoteVaults]);

  // Import UNIQUE d'un ancien coffre SAF non lié (Android cloud) — voir
  // lib/storage/cloud/legacyImport.ts (lecture seule de l'ancien dossier).
  const handleImportLegacy = useCallback(
    async (v: VaultRegistryEntry) => {
      if (!auth.user || !window.vaults?.importLegacy) {
        setVaultActionError('Connecte-toi d’abord à ton compte pour importer ce coffre.');
        return;
      }
      setImportState({ id: v.id, text: 'Lecture de l’ancien dossier…', busy: true });
      try {
        const report = await window.vaults.importLegacy(v.id, auth.user.id, (done, total) =>
          setImportState({ id: v.id, text: `Import : ${done}/${total} fichiers`, busy: true }),
        );
        if (!report) {
          setImportState({ id: v.id, text: 'Import annulé (dossier non choisi). Rien n’a été modifié.', busy: false });
          return;
        }
        const bits = [`${report.imported} fichier(s) importé(s)`];
        if (report.skippedExisting) bits.push(`${report.skippedExisting} déjà présent(s)`);
        if (report.skippedTooLarge.length) bits.push(`${report.skippedTooLarge.length} trop volumineux (> 50 Mo) ignoré(s)`);
        if (report.failed.length) bits.push(`${report.failed.length} illisible(s)`);
        if (report.pending) bits.push(`${report.pending} en attente d’envoi${report.offline ? ' (hors ligne)' : ''}`);
        setImportState({ id: v.id, text: `✅ ${bits.join(' · ')}. L’ancien dossier est intact.`, busy: false });
        loadRemoteVaults();
      } catch (error) {
        setImportState({ id: v.id, text: `⚠️ ${errorMessage(error)}`, busy: false });
      }
    },
    [auth.user, loadRemoteVaults],
  );

  const handleLinkVault = useCallback(
    async (v: VaultRegistryEntry) => {
      if (!auth.user) return;
      try {
        const remoteVaultId = await linkVaultToCloud(v.id, v.name, auth.user.id);
        await setCloudLink(v.id, { linked: true, remoteVaultId });
        loadRemoteVaults();
      } catch (error) {
        console.error('[sync] échec de la liaison au cloud :', error);
        setVaultActionError(errorMessage(error));
      }
    },
    [auth.user, setCloudLink, loadRemoteVaults],
  );

  // Raccordement d'un coffre local à un coffre distant DÉJÀ existant (cas
  // « nouvel appareil » ou « dossier recréé ») : aucune écriture côté cloud,
  // la référence vit dans le registre local — voir docs/ARCHITECTURE.md §6.
  // Dossier local EXISTANT → dialogue de fusion (aperçu + fusionner /
  // garder le local / garder le distant / annuler) AVANT toute liaison.
  const [pendingMerge, setPendingMerge] = useState<{ vault: VaultRegistryEntry; remoteId: string } | null>(null);
  const handleConnectExisting = useCallback(async (v: VaultRegistryEntry, remoteId: string) => {
    setPickingRemoteForVaultId(null);
    setPendingMerge({ vault: v, remoteId });
  }, []);
  const confirmMerge = useCallback(
    async (choice: MergeChoice) => {
      const pending = pendingMerge;
      setPendingMerge(null);
      if (!pending) return;
      const current = loadSyncSettings();
      saveSyncSettings({ ...current, linkPreference: { ...current.linkPreference, [pending.remoteId]: choice } });
      await runVaultAction(() => setCloudLink(pending.vault.id, { linked: true, remoteVaultId: pending.remoteId }));
    },
    [pendingMerge, runVaultAction, setCloudLink],
  );
  const loadMergePreview = useCallback(async () => {
    const remote = remoteVaults?.find((r) => r.id === pendingMerge?.remoteId);
    let local: number | null = null;
    if (pendingMerge && pendingMerge.vault.id === activeVaultId) {
      try {
        local = (await window.sync?.hashVaultTree?.())?.length ?? null;
      } catch {
        local = null;
      }
    }
    return { local, remote: remote?.fileCount ?? null };
  }, [remoteVaults, pendingMerge, activeVaultId]);

  // Connexion d'un coffre distant SUR CET APPAREIL, dans cet ordre :
  // 1) « Connecter » ci-dessous, 2) l'app demande OÙ placer les fichiers,
  // 3) un SOUS-DOSSIER au nom du coffre distant est créé à cet endroit (le
  // coffre garde son nom original, aucun mélange possible entre coffres
  // placés au même endroit) et le distant y dépose TOUT son contenu
  // (première synchro immédiate).
  const handleRetrieveRemote = useCallback(
    async (remote: RemoteVaultSummary) => {
      setRetrievingRemoteId(remote.id);
      setVaultActionError(null);
      try {
        const added = await retrieveRemoteVault(remote);
        if (!added) return;
        await syncStatus.runSync('manuel');
      } catch (error) {
        console.error('[sync] échec de la connexion du coffre distant :', error);
        setVaultActionError(errorMessage(error));
      } finally {
        setRetrievingRemoteId(null);
      }
    },
    [retrieveRemoteVault, syncStatus],
  );

  const submitEmailAuth = useCallback(
    async (mode: 'signin' | 'signup') => {
      const email = emailDraft.trim();
      if (!email || !passwordDraft) return;
      setAuthBusy(true);
      try {
        if (mode === 'signin') await auth.signInWithEmail(email, passwordDraft);
        else await auth.signUpWithEmail(email, passwordDraft);
      } finally {
        setAuthBusy(false);
      }
    },
    [auth, emailDraft, passwordDraft],
  );

  // Création d'un coffre distant DEPUIS LE COMPTE (modèle « le coffre
  // distant est une donnée du compte ») : aucune machine n'est impliquée —
  // le coffre apparaît vide dans la liste, chaque appareil s'y connecte
  // ensuite (« Connecter sur cet appareil… ») en choisissant son chemin,
  // et la synchro est bidirectionnelle partout, comme Obsidian Sync.
  const [showCreateRemoteForm, setShowCreateRemoteForm] = useState(false);
  const [createRemoteDraft, setCreateRemoteDraft] = useState('');
  const [creatingRemote, setCreatingRemote] = useState(false);
  const submitCreateRemoteVault = useCallback(async () => {
    if (!auth.user) return;
    const name = createRemoteDraft.trim();
    if (!name) return;
    setShowCreateRemoteForm(false);
    setCreateRemoteDraft('');
    setCreatingRemote(true);
    setRemoteVaultsError(null);
    try {
      await createRemoteVault(name, auth.user.id);
      loadRemoteVaults();
    } catch (error) {
      console.error('[sync] échec de la création du coffre distant :', error);
      setRemoteVaultsError(errorMessage(error));
    } finally {
      setCreatingRemote(false);
    }
  }, [auth.user, createRemoteDraft, loadRemoteVaults]);

  const handleSyncVault = useCallback(
    async (v: VaultRegistryEntry) => {
      if (!auth.user || !v.remoteVaultId) return;
      // Le moteur de sync (ponts vault/sync) opère TOUJOURS sur le coffre
      // ACTIF : synchroniser un coffre non actif sans basculer d'abord
      // échangerait avec le bon coffre distant mais lirait/écrirait dans le
      // dossier du coffre actif — contamination croisée (deux coffres
      // échangés contre le même dossier). Toujours : bascule d'abord, sync
      // ensuite — même chemin qu'à la main, zéro contournement du pont.
      if (v.id !== activeVaultId) {
        await runVaultAction(() => switchVault(v.id));
      }
      await syncStatus.runSync('manuel');
    },
    [auth.user, activeVaultId, syncStatus, switchVault, runVaultAction],
  );

//////// 2. Le rendu — Compte, Coffres distants, Coffres locaux ///////////////////////////

  if (!auth.available && !vault) {
    return (
      <Text style={[s.muted, { color: theme.textMuted }]}>
        Compte et coffres sont disponibles sur la version desktop pour l’instant.
      </Text>
    );
  }

  return (
    <View style={styles.stack}>
      {auth.available && (
        <View style={[s.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Text style={[s.cardTitle, { color: theme.text }]}>Compte</Text>
          {auth.loading ? (
            <View style={s.statusRow}>
              <ActivityIndicator size="small" color={theme.accent} />
              <Text style={{ color: theme.textMuted }}>Vérification de la session…</Text>
            </View>
          ) : auth.user ? (
            <>
              <Text style={[s.cardValue, { color: theme.textMuted }]}>
                Connecté·e : {auth.user.email ?? auth.user.id}
              </Text>
              <Pressable onPress={() => void auth.signOut()} style={[s.button, { backgroundColor: theme.accent }]}>
                <Text style={s.buttonText}>Se déconnecter</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Pressable
                onPress={() => void auth.signInWithGoogle()}
                style={[s.button, { backgroundColor: theme.accent }]}
              >
                <Text style={s.buttonText}>Se connecter avec Google</Text>
              </Pressable>
              <Pressable onPress={() => setShowEmailForm((prev) => !prev)} style={styles.emailToggle}>
                <Text style={[styles.emailToggleText, { color: theme.accent }]}>
                  {showEmailForm ? 'Masquer la connexion par email' : 'Se connecter avec un email'}
                </Text>
              </Pressable>
              {showEmailForm && (
                <View style={styles.emailForm}>
                  <TextInput
                    value={emailDraft}
                    onChangeText={setEmailDraft}
                    placeholder="adresse@email.fr"
                    placeholderTextColor={theme.textMuted}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="email-address"
                    style={[s.input, { color: theme.text, borderColor: theme.border }]}
                  />
                  <TextInput
                    value={passwordDraft}
                    onChangeText={setPasswordDraft}
                    placeholder="Mot de passe"
                    placeholderTextColor={theme.textMuted}
                    secureTextEntry
                    style={[s.input, { color: theme.text, borderColor: theme.border }]}
                  />
                  <View style={styles.vaultButtonsRow}>
                    <Pressable
                      onPress={() => void submitEmailAuth('signin')}
                      disabled={authBusy}
                      style={[s.button, { backgroundColor: theme.accent, opacity: authBusy ? 0.6 : 1 }]}
                    >
                      {authBusy ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <Text style={s.buttonText}>Se connecter</Text>
                      )}
                    </Pressable>
                    <Pressable
                      onPress={() => void submitEmailAuth('signup')}
                      disabled={authBusy}
                      style={[styles.emailSignUpButton, { borderColor: theme.accent, opacity: authBusy ? 0.6 : 1 }]}
                    >
                      <Text style={{ color: theme.accent }}>Créer un compte</Text>
                    </Pressable>
                  </View>
                </View>
              )}
            </>
          )}
          {auth.notice && <Text style={[styles.noticeText, { color: theme.textMuted }]}>✉️ {auth.notice}</Text>}
          {auth.error && <Text style={{ color: theme.danger }}>⚠️ {auth.error}</Text>}
        </View>
      )}

      {/* Coffres distants — ce que le COMPTE possède dans le cloud, quel que
          soit l'appareil (modèle inspiré d'Obsidian Sync : le coffre distant
          est l'objet central, on s'y connecte, il ne « disparaît » pas avec
          la machine qui l'a créé). Permet de raccrocher un coffre local à un
          distant existant et de récupérer un coffre sur un nouvel appareil. */}
      {auth.user && vault && (
        <View style={[s.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Text style={[s.cardTitle, { color: theme.text }]}>Coffres distants</Text>
          {remoteVaultsError && <Text style={{ color: theme.danger }}>⚠️ {remoteVaultsError}</Text>}
          {!remoteVaultsError && remoteVaults === null && (
            <View style={s.statusRow}>
              <ActivityIndicator size="small" color={theme.accent} />
              <Text style={{ color: theme.textMuted }}>Chargement…</Text>
            </View>
          )}
          {remoteVaults?.length === 0 && (
            <Text style={[s.cardValue, { color: theme.textMuted }]}>
              Aucun coffre distant pour l’instant — créez-en un ci-dessous, ou reliez un coffre local existant.
            </Text>
          )}
          {remoteVaults?.map((r) => {
            const linkedLocal = vaultList.find((lv) => lv.cloudLinked && lv.remoteVaultId === r.id) ?? null;
            const isRetrieving = retrievingRemoteId === r.id;
            return (
              <View key={r.id} style={[styles.remoteRow, { borderBottomColor: theme.border }]}>
                <Text style={{ color: theme.text }}>
                  ☁️ {r.name} — {r.fileCount > 0 ? `${r.fileCount} fichier(s)` : 'vide'}
                </Text>
                <Text style={[styles.vaultPathText, { color: theme.textMuted }]}>
                  {linkedLocal ? `connecté à « ${linkedLocal.name} » sur cet appareil` : 'non connecté sur cet appareil'}
                </Text>
                {/* Origine du coffre (demande v0.4.13 : distinguer les coffres
                    « qui proviennent de mon ordinateur LORDI » de ceux créés
                    ailleurs) — écrit une fois à la création, jamais
                    réécrit au re-lien depuis une autre machine. */}
                {r.createdByDevice && (
                  <Text style={[styles.vaultPathText, { color: theme.textMuted }]}>🏠 provient de {r.createdByDevice}</Text>
                )}
                {/* Appareils ayant synchronisé ce coffre (table
                    vault_devices, heartbeat à chaque synchro) — « qui est
                    connecté et vu quand », du plus récent au plus ancien.
                    Le suffixe court (4 hex) distingue deux machines qui
                    porteraient le même nom. v0.4.71 : version de l'app +
                    résumé du dernier cycle de CHAQUE appareil
                    (observabilité croisée — invisibles tant que la migration
                    SQL correspondante n'est pas appliquée). */}
                {r.devices.length > 0 && (
                  <View style={styles.deviceList}>
                    {r.devices.map((device) => (
                      <View key={device.deviceId}>
                        <Text style={[styles.vaultPathText, { color: theme.textMuted }]}>
                          {device.locked ? '🔒' : '💻'} {device.name} ({device.deviceId.slice(0, 4)})
                          {device.appVersion ? ` · v${device.appVersion}` : ''} · vu {formatLastSeen(device.lastSeenAt)}
                        </Text>
                        {formatLastCycle(device) && (
                          <Text style={[styles.vaultPathText, { color: theme.textMuted }]}>
                            ⏱ {formatLastCycle(device)}
                          </Text>
                        )}
                        {device.locked && device.lockReason ? (
                          <Text style={{ color: theme.danger, fontSize: 12 }}>🔒 {device.lockReason}</Text>
                        ) : null}
                        {/* v0.4.76 — verrou à distance (urgence) : un appareil
                            verrouillé n'exécute plus aucun cycle cloud. */}
                        <Pressable
                          disabled={lockBusyId === device.deviceId}
                          onPress={() => void handleDeviceLock(device.deviceId, !device.locked)}
                          style={[s.modeButton, { borderColor: theme.border, alignSelf: 'flex-start', marginTop: 4 }]}
                        >
                          <Text style={{ color: theme.text, fontSize: 12 }}>
                            {lockBusyId === device.deviceId
                              ? '…'
                              : device.locked
                                ? '🔓 Déverrouiller'
                                : '🔒 Verrouiller'}
                          </Text>
                        </Pressable>
                      </View>
                    ))}
                  </View>
                )}
                {/* Renommage inline (demande utilisateur : nommer les coffres
                    distants d'après leur contenu réel pour lever les
                    ambiguïtés). Le nom est cosmétique, l'id reste la clé. */}
                {renamingRemoteId === r.id ? (
                  <View style={s.statusRow}>
                    <TextInput
                      value={renamingRemoteDraft}
                      onChangeText={setRenamingRemoteDraft}
                      onSubmitEditing={() => void submitRenameRemoteVault(r.id, renamingRemoteDraft)}
                      placeholder="Nouveau nom…"
                      placeholderTextColor={theme.textMuted}
                      style={[styles.vaultRenameInput, { color: theme.text, borderColor: theme.border }]}
                      autoFocus
                    />
                    <Pressable
                      onPress={() => void submitRenameRemoteVault(r.id, renamingRemoteDraft)}
                      disabled={renamingRemoteBusy}
                      style={[styles.syncButton, { backgroundColor: theme.accent, opacity: renamingRemoteBusy ? 0.6 : 1 }]}
                    >
                      <Text style={s.buttonText}>OK</Text>
                    </Pressable>
                    <Pressable onPress={() => setRenamingRemoteId(null)}>
                      <Text style={{ color: theme.textMuted }}>Annuler</Text>
                    </Pressable>
                  </View>
                ) : (
                  <Pressable onPress={() => { setRenamingRemoteId(r.id); setRenamingRemoteDraft(r.name); }}>
                    <Text style={{ color: theme.accent, fontSize: 12 }}>✏️ Renommer</Text>
                  </Pressable>
                )}
                {!linkedLocal && (
                  <Pressable
                    onPress={() => !isRetrieving && void handleRetrieveRemote(r)}
                    style={[styles.syncButton, { backgroundColor: theme.accent, opacity: isRetrieving ? 0.6 : 1 }]}
                  >
                    {isRetrieving ? (
                      <View style={s.statusRow}>
                        <ActivityIndicator size="small" color="#fff" />
                        <Text style={s.buttonText}>Dépôt des fichiers…</Text>
                      </View>
                    ) : (
                      <Text style={s.buttonText}>Connecter sur cet appareil…</Text>
                    )}
                  </Pressable>
                )}
              </View>
            );
          })}

          {/* Création directe d'un coffre distant DANS LE COMPTE (v0.4.14) :
              le coffre est une donnée du compte, créé sans machine — vide au
              départ, il se remplit dès qu'un appareil connecté synchronise. */}
          <Pressable onPress={() => setShowCreateRemoteForm((prev) => !prev)} style={styles.emailToggle}>
            <Text style={[styles.emailToggleText, { color: theme.accent }]}>
              {showCreateRemoteForm ? 'Masquer le formulaire' : '➕ Nouveau coffre distant…'}
            </Text>
          </Pressable>
          {showCreateRemoteForm && (
            <View style={styles.vaultButtonsRow}>
              <TextInput
                autoFocus
                value={createRemoteDraft}
                onChangeText={setCreateRemoteDraft}
                onSubmitEditing={() => void submitCreateRemoteVault()}
                placeholder="Nom du coffre dans le compte…"
                placeholderTextColor={theme.textMuted}
                style={[s.input, { color: theme.text, borderColor: theme.border, flex: 1 }]}
              />
              <Pressable
                onPress={() => void submitCreateRemoteVault()}
                disabled={creatingRemote}
                style={[s.button, { backgroundColor: theme.accent, opacity: creatingRemote ? 0.6 : 1 }]}
              >
                {creatingRemote ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={s.buttonText}>Créer</Text>
                )}
              </Pressable>
            </View>
          )}
        </View>
      )}

      {vault && (
        <View style={[s.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Text style={[s.cardTitle, { color: theme.text }]}>{cloudOnly ? 'Coffres sur cet appareil' : 'Coffres locaux'}</Text>
          {cloudOnly && (
            <Text style={[styles.vaultPathText, { color: theme.textMuted }]}>
              Sur Android, tes coffres vivent dans le cloud (cache privé pour la lecture et l’écriture hors ligne).
              Les anciens dossiers du téléphone ne sont plus utilisés ni modifiés.
            </Text>
          )}

          {vaultList.length === 0 && (
            <Text style={[s.cardValue, { color: theme.textMuted }]}>Aucun coffre local pour l’instant.</Text>
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
                      <Text style={{ color: theme.text, fontWeight: isActive ? '600' : '400' }}>{v.name}</Text>
                      <Text style={[styles.vaultPathText, { color: theme.textMuted }]} numberOfLines={1}>
                        {cloudOnly
                          ? v.remoteVaultId
                            ? '☁️ Coffre cloud'
                            : '📦 Ancien dossier du téléphone — à importer'
                          : v.path}
                      </Text>
                    </View>
                  )}
                </Pressable>
                {!isRenaming && (
                  <Pressable onPress={() => startRenameVault(v)} style={styles.vaultRowAction}>
                    <Text style={{ color: theme.textMuted }}>✏️</Text>
                  </Pressable>
                )}
                <Pressable
                  onPress={() => setConfirmRemoveVault(v)}
                  style={styles.vaultRowAction}
                  accessibilityLabel={`Retirer le coffre ${v.name}`}
                >
                  <Text style={{ color: theme.textMuted }}>✕</Text>
                </Pressable>
              </View>
            );
          })}

          {auth.user &&
            vaultList.map((v) => {
              // Toute synchro passe désormais par le contexte partagé (le
              // coffre visé devient actif d'abord — voir handleSyncVault) :
              // un seul état, celui de l'indicateur global.
              const isSyncing = syncStatus.status === 'syncing';
              const result: { summary?: SyncSummary; error?: string } = {
                summary: syncStatus.lastSummary ?? undefined,
                error: syncStatus.lastError ?? undefined,
              };
              return (
                <View key={`sync-${v.id}`} style={styles.syncRow}>
                  <Text style={[styles.vaultPathText, { color: theme.textMuted }]} numberOfLines={1}>
                    ☁️ {v.name}
                  </Text>
                  {/* Coffre déplacé (v0.4.16) : l'emplacement enregistré est
                      mort ou vide d'identité — la synchro est bloquée tant
                      que le nouvel emplacement n'est pas désigné, sinon tout
                      le distant serait « ressuscité » à l'ancien chemin. */}
                  {!cloudOnly && vaultFolderIssues[v.id] && (
                    <View style={styles.relocateBlock}>
                      <Text style={{ color: theme.danger }}>
                        ⚠️{' '}
                        {vaultFolderIssues[v.id] === 'missing'
                          ? 'Dossier introuvable à son emplacement enregistré (déplacé ou renommé ?)'
                          : "Le dossier enregistré ne contient plus ce coffre (déplacé ?) — la synchro est suspendue."}
                      </Text>
                      <Pressable
                        onPress={() => void runVaultAction(() => relocateVault(v.id))}
                        style={[styles.relocateButton, { borderColor: theme.accent }]}
                      >
                        <Text style={{ color: theme.accent }}>Retrouver le dossier…</Text>
                      </Pressable>
                    </View>
                  )}
                  {cloudOnly && !v.remoteVaultId ? (
                    <View>
                      <Pressable
                        onPress={() => void handleImportLegacy(v)}
                        disabled={importState?.busy}
                        style={[styles.syncButton, { backgroundColor: theme.accent, opacity: importState?.busy ? 0.6 : 1 }]}
                      >
                        <Text style={s.buttonText}>Importer dans le cloud…</Text>
                      </Pressable>
                      <Text style={[styles.vaultPathText, { color: theme.textMuted }]}>
                        Copie unique de l’ancien dossier vers un nouveau coffre cloud. Le dossier est seulement lu :
                        rien n’y est écrit ni supprimé.
                      </Text>
                      {importState?.id === v.id && (
                        <Text style={[styles.vaultPathText, { color: theme.text }]}>{importState.text}</Text>
                      )}
                    </View>
                  ) : !v.cloudLinked && !cloudOnly ? (
                    <View style={styles.linkButtonsRow}>
                      <Pressable
                        onPress={() => void handleLinkVault(v)}
                        style={[styles.syncButton, { backgroundColor: theme.accent }]}
                      >
                        <Text style={s.buttonText}>Créer un coffre distant</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => setPickingRemoteForVaultId((prev) => (prev === v.id ? null : v.id))}
                        style={[styles.syncButton, styles.linkSecondaryButton, { borderColor: theme.accent }]}
                      >
                        <Text style={{ color: theme.accent }}>Se connecter à un existant…</Text>
                      </Pressable>
                    </View>
                  ) : (
                    <View style={styles.linkButtonsRow}>
                      <Pressable
                        onPress={() => !isSyncing && void handleSyncVault(v)}
                        style={[styles.syncButton, { backgroundColor: theme.accent, opacity: isSyncing ? 0.6 : 1 }]}
                      >
                        {isSyncing ? (
                          <ActivityIndicator size="small" color="#fff" />
                        ) : (
                          <Text style={s.buttonText}>Synchroniser maintenant</Text>
                        )}
                      </Pressable>
                      {!cloudOnly && <Pressable
                        onPress={() => setConfirmDisconnectVault(v)}
                        style={[styles.syncButton, styles.linkSecondaryButton, { borderColor: theme.danger }]}
                      >
                        <Text style={{ color: theme.danger }}>Déconnecter…</Text>
                      </Pressable>}
                    </View>
                  )}
                  {cloudOnly && v.id === activeVaultId && cloudStatus && (
                    <Text style={[styles.vaultPathText, { color: theme.textMuted }]}>{cloudStatus}</Text>
                  )}
                  {importState?.id === v.id && v.remoteVaultId && (
                    <Text style={[styles.vaultPathText, { color: theme.text }]}>{importState.text}</Text>
                  )}
                  {result?.summary && v.id === activeVaultId && (
                    <Text style={[styles.vaultPathText, { color: theme.textMuted }]}>
                      {result.summary.pushed} envoyée(s), {result.summary.pulled} reçue(s),{' '}
                      {result.summary.deleted} supprimée(s), {result.summary.conflicts} conflit(s)
                      {result.summary.errors.length > 0 ? ` — ${result.summary.errors.length} erreur(s)` : ''}
                    </Text>
                  )}
                  {result?.error && <Text style={{ color: theme.danger }}>⚠️ {result.error}</Text>}
                  {pickingRemoteForVaultId === v.id && (
                    <View style={styles.remotePicker}>
                      {(remoteVaults ?? [])
                        .filter(
                          (r) =>
                            !vaultList.some((lv) => lv.id !== v.id && lv.cloudLinked && lv.remoteVaultId === r.id),
                        )
                        .map((r) => (
                          <Pressable
                            key={r.id}
                            onPress={() => void handleConnectExisting(v, r.id)}
                            style={styles.remotePickerRow}
                          >
                            <Text style={{ color: theme.text }}>☁️ {r.name}</Text>
                          </Pressable>
                        ))}
                      {(remoteVaults ?? []).length === 0 && (
                        <Text style={[styles.vaultPathText, { color: theme.textMuted }]}>
                          Aucun coffre distant existant — créez-en un avec le premier bouton.
                        </Text>
                      )}
                    </View>
                  )}
                </View>
              );
            })}

          {/* Synchro automatique — voir SyncStatusContext.tsx pour le
              déclenchement réel (démarrage + intervalle). Visible dès qu'un
              compte est connecté, même sans coffre lié pour l'instant :
              c'est une préférence globale, pas propre à un coffre — elle
              s'appliquera dès qu'un coffre sera lié. */}
          {auth.user && (
            <View style={styles.autoSyncBlock}>
              <SettingsToggle
                label="Synchroniser automatiquement"
                value={preferences.autoSyncEnabled}
                onChange={(value) => void setAutoSyncEnabled(value)}
                theme={theme}
              />
              <Text style={[styles.autoSyncHint, { color: theme.textMuted }]}>
                Synchro continue : chaque modification locale part vers le compte en quelques secondes, et les
                changements des autres appareils arrivent en moins d’une minute. Une seule vérité : le coffre
                distant du compte.
              </Text>
            </View>
          )}

          {vaultActionError && <Text style={{ color: theme.danger }}>⚠️ {vaultActionError}</Text>}

          {!cloudOnly && <View style={styles.vaultButtonsRow}>
            <Pressable
              onPress={() => void runVaultAction(addExistingVault)}
              style={[s.button, { backgroundColor: theme.accent }]}
            >
              <Text style={s.buttonText}>Ajouter un dossier existant</Text>
            </Pressable>
            <Pressable
              onPress={() => setShowCreateForm((prev) => !prev)}
              style={[s.button, { backgroundColor: theme.accent }]}
            >
              <Text style={s.buttonText}>Nouveau coffre</Text>
            </Pressable>
          </View>}

          {showCreateForm && (
            <View style={styles.vaultButtonsRow}>
              <TextInput
                autoFocus
                value={createDraft}
                onChangeText={setCreateDraft}
                onSubmitEditing={() => void submitCreateVault()}
                placeholder="Nom du nouveau coffre…"
                placeholderTextColor={theme.textMuted}
                style={[s.input, { color: theme.text, borderColor: theme.border }]}
              />
              <Pressable onPress={() => void submitCreateVault()} style={[s.button, { backgroundColor: theme.accent }]}>
                <Text style={s.buttonText}>Créer</Text>
              </Pressable>
            </View>
          )}
        </View>
      )}

      {/* Confirmation de retrait de coffre — `onSettled` referme dans tous
          les cas (succès OU échec, l'erreur restant visible via
          vaultActionError), même montage que TasksScreen.tsx. */}
      {pendingMerge && (
        <MergeLinkDialog
          theme={theme}
          vaultName={pendingMerge.vault.name}
          remoteName={remoteVaults?.find((r) => r.id === pendingMerge.remoteId)?.name ?? 'coffre distant'}
          loadPreview={loadMergePreview}
          onChoose={(c) => void confirmMerge(c)}
          onCancel={() => setPendingMerge(null)}
        />
      )}
      {confirmRemoveVault && (
        <ConfirmDialog
          theme={theme}
          title={`Retirer « ${confirmRemoveVault.name} » ?`}
          message="Le coffre sera retiré de la liste (ses fichiers restent sur le disque, rien n'est effacé). Un coffre lié au cloud devra être relié pour resynchroniser."
          confirmLabel="Retirer"
          onConfirm={() => removeVault(confirmRemoveVault.id)}
          onCancel={() => setConfirmRemoveVault(null)}
          onSettled={() => setConfirmRemoveVault(null)}
        />
      )}

      {/* Déconnexion d'un coffre distant — DESTRUCTIVE (suppression du
          contenu déposé), d'où l'avertissement explicite demandé par
          l'utilisatrice avant toute confirmation. Le cloud reste intact :
          la donnée de référence vit dans le coffre distant. */}
      {confirmDisconnectVault && (
        <ConfirmDialog
          theme={theme}
          title={`Déconnecter « ${confirmDisconnectVault.name} » ?`}
          message="⚠️ Action destructive : tout le contenu du dossier de ce coffre sera supprimé de cet appareil (fichiers et sous-dossiers, hors réglages .123ecriture/.obsidian), et le coffre sera retiré de la liste locale. Le coffre distant et ses fichiers restent intacts dans le cloud : vous pourrez vous y reconnecter plus tard pour tout récupérer."
          confirmLabel="Déconnecter et supprimer"
          onConfirm={() => void runVaultAction(() => disconnectVault(confirmDisconnectVault.id))}
          onCancel={() => setConfirmDisconnectVault(null)}
          onSettled={() => setConfirmDisconnectVault(null)}
        />
      )}
    </View>
  );
}

//////// 3. Les styles ////////////////////////////////////////////////////////////////////

const styles = StyleSheet.create({
  stack: {
    gap: 16,
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
  autoSyncBlock: {
    gap: 2,
    paddingTop: 4,
  },
  autoSyncHint: {
    fontSize: 11,
    marginLeft: 30,
  },
  emailToggle: {
    paddingVertical: 4,
    alignSelf: 'flex-start',
  },
  emailToggleText: {
    fontSize: 13,
  },
  emailForm: {
    gap: 8,
  },
  emailSignUpButton: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1,
  },
  noticeText: {
    fontSize: 12,
  },
  remoteRow: {
    gap: 4,
    paddingVertical: 6,
    borderBottomWidth: 1,
  },
  deviceList: {
    gap: 2,
    paddingLeft: 12,
  },
  linkButtonsRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  linkSecondaryButton: {
    borderWidth: 1,
    backgroundColor: 'transparent',
  },
  remotePicker: {
    gap: 2,
    paddingLeft: 12,
  },
  remotePickerRow: {
    paddingVertical: 6,
  },
  relocateBlock: {
    gap: 6,
    paddingVertical: 4,
  },
  relocateButton: {
    alignSelf: 'flex-start',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 6,
    borderWidth: 1,
  },
});
