import { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { errorMessage } from '../../lib/errorMessage';
import { setRemoteRowsDeleted } from '../../lib/sync/deviceGateway';
import { restoreRemoteFile } from '../../lib/sync/cloud';
import { loadPendingReview, savePendingReview, type PendingReview } from '../../lib/sync/pendingReview';
import {
  approveRemoteDeletions,
  describeFailures,
  refuseRemoteDeletions,
  type DecisionDeps,
} from '../../lib/sync/remoteDeletionDecisions';
import { useSyncStatus } from '../../lib/sync/SyncStatusContext';
import { useVaults } from '../../lib/sync/VaultsContext';
import { usePreferences } from '../../preferences/PreferencesContext';
import { settingsStyles as s } from './settingsStyles';

// ✒️ 123ECRITURE — components/settings/SyncReviewSection.tsx — la revue de sécurité de la synchro
//////////////////////////////////////////////////////////////////////////////
//
// CARTE « REVUE DE SÉCURITÉ » : tout ce que le moteur a BLOQUÉ attend ici
// une décision humaine — jamais d'application silencieuse. La gestion des
// suppressions se fait par l'utilisatrice ou par un opérateur, JAMAIS de
// façon silencieuse.
//
// Invariants du fichier :
//   • Cette carte n'apparaît dans Paramètres → Journal de synchronisation
//     QUE s'il y a quelque chose à trancher : disjoncteur ouvert,
//     suppressions massives suspectes, suppressions distantes en attente.
//   • Tant que la revue n'est pas tranchée, les fichiers concernés
//     restent EN PLACE et la synchro reste bloquée pour eux (ni perte, ni
//     propagation).
//   • La file est rechargée toutes les 2,5 s tant que l'écran est ouvert,
//     et rechargée après chaque action (run + reload).
//
// SOMMAIRE :
//   1. Le chargement de la file + les actions
//   2. Le rendu (disjoncteur / suppressions massives / suppressions distantes)
//
//////////////////////////////////////////////////////////////////////////////

//////// 1. Le chargement de la file + les actions ////////////////////////////////////////

export function SyncReviewSection() {
  const { theme } = usePreferences();
  const { activeVault } = useVaults();
  const [review, setReview] = useState<PendingReview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const syncStatus = useSyncStatus();

  const remoteVaultId = activeVault?.remoteVaultId ?? null;

  const reload = useCallback(async () => {
    if (typeof window === 'undefined' || !window.vault) return;
    try {
      setReview(await loadPendingReview(window.vault));
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []); // rechargé aussi par l'effet ci-dessous


  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (typeof window === 'undefined' || !window.vault) return;
      try {
        const loaded = await loadPendingReview(window.vault);
        if (!cancelled) setReview(loaded);
      } catch (e) {
        if (!cancelled) setError(errorMessage(e));
      }
    };
    void load();
    const timer = setInterval(() => void load(), 2500);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [activeVault?.id]);

  const run = useCallback(
    async (action: () => Promise<void>) => {
      setBusy(true);
      setError(null);
      try {
        await action();
        await reload();
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        setBusy(false);
      }
    },
    [reload],
  );

  const leverDisjoncteur = () =>
    run(async () => {
      if (typeof window === 'undefined' || !window.vault) throw new Error('Pont vault absent.');
      await savePendingReview(window.vault, { ...(review ?? {}), syncBlocked: undefined });
    });

  const confirmerSuppressionsMassives = () =>
    run(async () => {
      if (!remoteVaultId) throw new Error('Aucun coffre distant lié — validation impossible depuis cet appareil.');
      const paths = review?.suspiciousDeletions?.paths ?? [];
      if (!window.vault) throw new Error('Pont vault absent.');
      // Les fichiers sont déjà absents localement : on pose les tombstones
      // (le cloud avait été protégé par la revue — la confirmation les
      // applique maintenant, en connaissance de cause).
      const supabaseMod = await import('../../lib/sync/deviceGateway');
      await supabaseMod.setRemoteRowsDeleted(remoteVaultId, paths, true);
      await savePendingReview(window.vault, { ...(review ?? {}), suspiciousDeletions: undefined });
    });

  const annulerSuppressionsMassives = () =>
    run(async () => {
      if (typeof window === 'undefined' || !window.vault) throw new Error('Pont vault absent.');
      // Les fichiers manquants seront re-tirés du cloud au prochain cycle
      // (l'état local ne les référence plus comme supprimés).
      await savePendingReview(window.vault, { ...(review ?? {}), suspiciousDeletions: undefined });
    });

  // Décisions sur les suppressions distantes — HORS de tout cycle
  // (runSyncExclusive) : le moteur réécrit la même file.
  const decisionDeps = (): DecisionDeps => {
    if (typeof window === 'undefined' || !window.vault) throw new Error('Pont vault absent.');
    if (!remoteVaultId) throw new Error('Aucun coffre distant lié — décision impossible depuis cet appareil.');
    const vault = window.vault;
    return {
      vault,
      restoreRemote: (relPath) => restoreRemoteFile(remoteVaultId, relPath),
      legacyUndelete: (relPaths) => setRemoteRowsDeleted(remoteVaultId, relPaths, false),
    };
  };
  const approuver = (paths: string[]) =>
    run(async () => {
      const outcome = await syncStatus.runSyncExclusive(() => approveRemoteDeletions(decisionDeps(), paths));
      const failure = describeFailures(outcome);
      if (failure) throw new Error(failure);
    });
  const refuser = (paths: string[]) =>
    run(async () => {
      const outcome = await syncStatus.runSyncExclusive(() => refuseRemoteDeletions(decisionDeps(), paths));
      const failure = describeFailures(outcome);
      if (failure) throw new Error(failure);
    });

  //////// 2. Le rendu (disjoncteur / suppressions massives / suppressions distantes) ///////

  if (!review) return null;
  const hasBlocked = Boolean(review.syncBlocked);
  const hasMass = Boolean(review.suspiciousDeletions);
  const hasRemote = (review.remoteDeletions ?? []).length > 0;
  if (!hasBlocked && !hasMass && !hasRemote) return null;

  return (
    <View style={[s.card, { backgroundColor: theme.surface, borderColor: theme.danger }]}>
      <Text style={[s.cardTitle, { color: theme.text }]}>🛡️ Revue de sécurité</Text>
      <Text style={[s.hint, { color: theme.textMuted }]}>
        Actions du moteur de synchro bloquées par protection — elles attendent ta décision. Rien n’a été perdu.
      </Text>

      {hasBlocked && (
        <View style={{ marginVertical: 8, gap: 6 }}>
          <Text style={{ color: theme.danger, fontWeight: '600' }}>🚫 Synchronisation bloquée (disjoncteur)</Text>
          <Text style={{ color: theme.textMuted, fontSize: 12 }}>
            {String(review.syncBlocked?.samples?.[0] ?? '')}
          </Text>
          <Pressable
            disabled={busy}
            onPress={() => void leverDisjoncteur()}
            style={[s.modeButton, { borderColor: theme.border, alignSelf: 'flex-start' }]}
          >
            <Text style={{ color: theme.text }}>🔓 Lever le disjoncteur et resynchroniser</Text>
          </Pressable>
        </View>
      )}

      {hasMass && (
        <View style={{ marginVertical: 8, gap: 6 }}>
          <Text style={{ color: theme.danger, fontWeight: '600' }}>
            ⚠️ {review.suspiciousDeletions?.count} fichier(s) manquent localement — suppressions en attente
          </Text>
          <Text style={{ color: theme.textMuted, fontSize: 12 }}>
            Si cette suppression massive est VOLONTAIRE, confirme-la. Sinon, annule : les fichiers seront restaurés
            depuis le cloud au prochain cycle.
          </Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pressable
              disabled={busy}
              onPress={() => void confirmerSuppressionsMassives()}
              style={[s.modeButton, { borderColor: theme.danger, alignSelf: 'flex-start' }]}
            >
              <Text style={{ color: theme.danger }}>🗑️ Confirmer les suppressions</Text>
            </Pressable>
            <Pressable
              disabled={busy}
              onPress={() => void annulerSuppressionsMassives()}
              style={[s.modeButton, { borderColor: theme.border, alignSelf: 'flex-start' }]}
            >
              <Text style={{ color: theme.text }}>♻️ Conserver (restaurer)</Text>
            </Pressable>
          </View>
        </View>
      )}

      {hasRemote && (
        <View style={{ marginVertical: 8, gap: 6 }}>
          <Text style={{ color: theme.danger, fontWeight: '600' }}>
            📥 {review.remoteDeletions?.length} suppression(s) venue(s) d’autres appareils — en attente
          </Text>
          <Text style={{ color: theme.textMuted, fontSize: 12 }}>
            Les fichiers restent intacts ici tant que vous n’avez pas décidé. Approuver = corbeille locale ; Refuser = le
            fichier est restauré dans le cloud.
          </Text>
          {(review.remoteDeletions ?? []).length > 1 && (
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              <Pressable
                disabled={busy}
                onPress={() => void approuver((review.remoteDeletions ?? []).map((r) => r.path))}
                style={[s.modeButton, { borderColor: theme.border, alignSelf: 'flex-start' }]}
              >
                <Text style={{ color: theme.text }}>🗑️ Tout approuver</Text>
              </Pressable>
              <Pressable
                disabled={busy}
                onPress={() => void refuser((review.remoteDeletions ?? []).map((r) => r.path))}
                style={[s.modeButton, { borderColor: theme.border, alignSelf: 'flex-start' }]}
              >
                <Text style={{ color: theme.text }}>♻️ Tout refuser</Text>
              </Pressable>
            </View>
          )}
          {(review.remoteDeletions ?? []).map((r) => (
            <View key={r.path} style={{ gap: 2 }}>
              <Text style={{ color: theme.text, fontSize: 13 }}>
                · {r.path}
                {r.modified ? ' (modifié ici ⚠)' : ''}
              </Text>
              <Text style={{ color: theme.textMuted, fontSize: 11 }}>
                supprimé sur {r.deletedByDevice ?? 'un autre appareil'}
                {` · ${new Date(r.deletedAt ?? r.at).toLocaleString()}`}
              </Text>
              <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                <Pressable
                  disabled={busy}
                  onPress={() => void approuver([r.path])}
                  style={[s.modeButton, { borderColor: theme.border, alignSelf: 'flex-start' }]}
                >
                  <Text style={{ color: theme.text }}>🗑️ Approuver (corbeille)</Text>
                </Pressable>
                <Pressable
                  disabled={busy}
                  onPress={() => void refuser([r.path])}
                  style={[s.modeButton, { borderColor: theme.border, alignSelf: 'flex-start' }]}
                >
                  <Text style={{ color: theme.text }}>♻️ Refuser (restaurer)</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </View>
      )}

      {error && <Text style={{ color: theme.danger, fontSize: 12 }}>{error}</Text>}
    </View>
  );
}
