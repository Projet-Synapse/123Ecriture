import { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { errorMessage } from '../../lib/errorMessage';
import { setRemoteRowsDeleted } from '../../lib/sync/deviceGateway';
import { restoreRemoteFile } from '../../lib/sync/cloud';
import { confirmMassDeletions, keepMassDeletions } from '../../lib/sync/massDeletionReview';
import { clearPendingReviewSyncBlock, loadPendingReview, type PendingReview } from '../../lib/sync/pendingReview';
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
  // Retour visuel des décisions sur les suppressions massives (en cours /
  // fait / erreur) — affiché même quand l'alerte a disparu (succès).
  const [massNotice, setMassNotice] = useState<{ kind: 'running' | 'done' | 'warning' | 'error'; text: string } | null>(null);
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

  // Levée du disjoncteur : la file est RELUE (jamais l'état affiché, qui
  // peut dater de 2,5 s) — seul le bloc est retiré, rien d'autre écrasé.
  const leverDisjoncteur = () =>
    run(async () => {
      if (typeof window === 'undefined' || !window.vault) throw new Error('Pont vault absent.');
      await clearPendingReviewSyncBlock(window.vault);
    });

  // Décisions sur les suppressions massives (voir massDeletionReview.ts) :
  //   • HORS cycle (runSyncExclusive) et sur la file RELUE ;
  //   • décision PERSISTÉE d'abord, cloud ensuite — un échec réseau ne
  //     l'annule pas, le moteur l'applique au cycle suivant ;
  //   • un cycle est relancé aussitôt pour solder la base de synchro.
  const confirmerSuppressionsMassives = async () => {
    if (typeof window === 'undefined' || !window.vault) {
      setMassNotice({ kind: 'error', text: 'Pont vault absent.' });
      return;
    }
    if (!remoteVaultId) {
      setMassNotice({ kind: 'error', text: 'Aucun coffre distant lié — validation impossible depuis cet appareil.' });
      return;
    }
    const vault = window.vault;
    const count = review?.suspiciousDeletions?.count ?? 0;
    setBusy(true);
    setError(null);
    setMassNotice({ kind: 'running', text: `⏳ Confirmation de ${count} suppression(s)…` });
    try {
      // Décision seulement : le cycle relancé ci-dessous applique chaque
      // suppression après relecture du disque et contrôle de version — un
      // fichier présent ici ou modifié ailleurs n'est jamais effacé.
      const outcome = await syncStatus.runSyncExclusive(() => confirmMassDeletions({ vault }));
      await reload();
      setMassNotice({
        kind: 'done',
        text: `✅ ${outcome.count} suppression(s) confirmée(s) — appliquée(s) au cycle de synchro en cours, sauf pour les fichiers encore présents ici.`,
      });
      void syncStatus.runSync('confirmation des suppressions');
    } catch (e) {
      setMassNotice({ kind: 'error', text: `❌ Confirmation impossible : ${errorMessage(e)}` });
      await reload();
    } finally {
      setBusy(false);
    }
  };

  const annulerSuppressionsMassives = async () => {
    if (typeof window === 'undefined' || !window.vault) {
      setMassNotice({ kind: 'error', text: 'Pont vault absent.' });
      return;
    }
    const vault = window.vault;
    setBusy(true);
    setError(null);
    setMassNotice({ kind: 'running', text: '⏳ Restauration demandée…' });
    try {
      const { count } = await syncStatus.runSyncExclusive(() => keepMassDeletions({ vault }));
      await reload();
      setMassNotice({ kind: 'done', text: `♻️ ${count} fichier(s) conservé(s) — rapatriement depuis le cloud en cours.` });
      void syncStatus.runSync('restauration des fichiers manquants');
    } catch (e) {
      setMassNotice({ kind: 'error', text: `❌ Restauration impossible : ${errorMessage(e)}` });
      await reload();
    } finally {
      setBusy(false);
    }
  };

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

  const noticeColor =
    massNotice?.kind === 'error' ? theme.danger : massNotice?.kind === 'done' ? theme.text : theme.textMuted;
  const noticeView = massNotice && (
    <Text accessibilityLiveRegion="polite" style={{ color: noticeColor, fontSize: 12, fontWeight: '600' }}>
      {massNotice.text}
    </Text>
  );
  if (!review) return null;
  const hasBlocked = Boolean(review.syncBlocked);
  const hasMass = Boolean(review.suspiciousDeletions);
  const hasRemote = (review.remoteDeletions ?? []).length > 0;
  if (!hasBlocked && !hasMass && !hasRemote) {
    // Décision tranchée : l'alerte a disparu, le résultat reste visible.
    if (!massNotice) return null;
    return (
      <View style={[s.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <Text style={[s.cardTitle, { color: theme.text }]}>🛡️ Revue de sécurité</Text>
        {noticeView}
      </View>
    );
  }

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

      {!hasMass && noticeView}

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
          {noticeView}
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
                {r.renamedTo ? `renommé en ${r.renamedTo} sur ` : 'supprimé sur '}
                {r.deletedByDevice ?? 'un autre appareil'}
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
