//////////
// ✒️ 123ECRITURE — SyncReviewSection.tsx
// CARTE « REVUE DE SÉCURITÉ » (v0.4.76) : tout ce que le moteur a BLOQUÉ
// attend ici une décision humaine — jamais d'application silencieuse
//////////

// INTRODUCTION — Demande de Catelina : la gestion des suppressions se fait
// par ELLE ou par un opérateur, JAMAIS de façon silencieuse. Cette carte
// n'apparaît dans Paramètres → Journal de synchronisation QUE s'il y a
// quelque chose à trancher : disjoncteur ouvert, suppressions massives
// suspectes, suppressions distantes en attente. Tant que la revue n'est pas
// tranchée, les fichiers concernés restent EN PLACE et la synchro reste
// bloquée pour eux (ni perte, ni propagation).
//
// SOMMAIRE :
//   1. 📥 Chargement de la file + actions
//   2. 🖥️ Rendu (disjoncteur / suppressions massives / suppressions distantes)

import { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { errorMessage } from '../../lib/errorMessage';
import { setRemoteRowsDeleted } from '../../lib/sync/deviceGateway';
import { loadPendingReview, savePendingReview, type PendingReview } from '../../lib/sync/pendingReview';
import { useVaults } from '../../lib/sync/VaultsContext';
import { usePreferences } from '../../preferences/PreferencesContext';
import { settingsStyles as s } from './settingsStyles';

//////// 1. 📥 CHARGEMENT DE LA FILE + ACTIONS ///////////

export function SyncReviewSection() {
  const { theme } = usePreferences();
  const { activeVault } = useVaults();
  const [review, setReview] = useState<PendingReview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remoteVaultId = activeVault?.remoteVaultId ?? null;

  const reload = useCallback(async () => {
    if (typeof window === 'undefined' || !window.vault) return;
    setReview(await loadPendingReview(window.vault).catch(() => null));
  }, []); // rechargé aussi par l'effet ci-dessous


  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (typeof window === 'undefined' || !window.vault) return;
      const loaded = await loadPendingReview(window.vault).catch(() => null);
      if (!cancelled) setReview(loaded);
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

  const supprimerVraiment = (relPath: string) =>
    run(async () => {
      if (typeof window === 'undefined' || !window.vault) throw new Error('Pont vault absent.');
      await window.vault.delete(relPath, { silent: true });
      const remaining = (review?.remoteDeletions ?? []).filter((r) => r.path !== relPath);
      await savePendingReview(window.vault, { ...(review ?? {}), remoteDeletions: remaining });
    });

  const restaurerDansCloud = (relPath: string) =>
    run(async () => {
      if (!remoteVaultId) throw new Error('Aucun coffre distant lié — restauration impossible.');
      await setRemoteRowsDeleted(remoteVaultId, [relPath], false);
      const remaining = (review?.remoteDeletions ?? []).filter((r) => r.path !== relPath);
      if (typeof window === 'undefined' || !window.vault) throw new Error('Pont vault absent.');
      await savePendingReview(window.vault, { ...(review ?? {}), remoteDeletions: remaining });
    });

  //////// 2. 🖥️ RENDU ///////////

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
          {(review.remoteDeletions ?? []).map((r) => (
            <View key={r.path} style={{ gap: 2 }}>
              <Text style={{ color: theme.textMuted, fontSize: 12 }}>· {r.path}{r.modified ? ' (modifié ici ⚠)' : ''}</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Pressable
                  disabled={busy}
                  onPress={() => void supprimerVraiment(r.path)}
                  style={[s.modeButton, { borderColor: theme.border, alignSelf: 'flex-start' }]}
                >
                  <Text style={{ color: theme.text }}>🗑️ Supprimer vraiment</Text>
                </Pressable>
                <Pressable
                  disabled={busy}
                  onPress={() => void restaurerDansCloud(r.path)}
                  style={[s.modeButton, { borderColor: theme.border, alignSelf: 'flex-start' }]}
                >
                  <Text style={{ color: theme.text }}>♻️ Restaurer dans le cloud</Text>
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
