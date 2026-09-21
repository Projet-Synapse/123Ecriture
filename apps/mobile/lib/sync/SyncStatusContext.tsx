import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';

import { useAuth } from './AuthContext';
import { runSync as runSyncEngine, type SyncSummary } from './syncEngine';
import { supabase } from './supabaseClient';
import { useVaults } from './VaultsContext';
import { usePreferences } from '../../preferences/PreferencesContext';
import { errorMessage } from '../errorMessage';

// Statut de synchro PARTAGÉ entre l'indicateur global (AppShell.tsx, en-tête
// visible sur toutes les plateformes) et l'écran Paramètres → Compte et
// synchronisation (AccountSyncSection.tsx). Avant ce contexte, ce statut
// était un state local à AccountSyncSection : invisible ailleurs et
// réinitialisé à chaque montage de l'écran. Centraliser ici permet aussi de
// porter la synchro AUTOMATIQUE en option (voir effet plus bas), qui doit
// pouvoir se déclencher même quand Paramètres n'est pas affiché.
//
// Ne touche à AUCUNE logique de diff/conflit (lib/sync/diff.ts, intouché) —
// ce fichier ne fait qu'orchestrer QUAND `runSync` (syncEngine.ts) est
// appelé et où son résultat est affiché, exactement comme le faisait déjà
// AccountSyncSection avant ce changement.

export type SyncStatus = 'idle' | 'syncing' | 'success' | 'error';

type SyncStatusContextValue = {
  status: SyncStatus;
  // epoch ms du dernier succès (avec ou sans conflit) — `null` tant qu'aucun
  // cycle n'a réussi depuis le lancement de l'app.
  lastSyncedAt: number | null;
  // Résumé humain du dernier résultat, succès OU erreur — ce que
  // l'indicateur global et Paramètres affichent tous les deux tel quel.
  lastResultSummary: string | null;
  // Nombre de conflits du dernier cycle réussi — distingue "synchronisé
  // proprement" de "synchronisé, mais des conflits ont été résolus" pour
  // l'indicateur global (voir AppShell.tsx).
  lastConflicts: number;
  // Détail structuré du dernier résultat, réutilisé tel quel par
  // AccountSyncSection.tsx pour son affichage par coffre (même format que
  // l'ancien state local `syncResults[vaultId]`) sans reformater
  // `lastResultSummary`.
  lastSummary: SyncSummary | null;
  lastError: string | null;
  // Vrai seulement si une session est active ET que le coffre ACTUELLEMENT
  // ACTIF est lié au cloud — condition déjà utilisée par
  // AccountSyncSection.tsx (auth.user + v.remoteVaultId) pour décider quand
  // proposer "Synchroniser maintenant" ; réutilisée ici pour que
  // l'indicateur global (AppShell.tsx) n'affiche RIEN tant que rien n'est
  // configuré, plutôt qu'un "Non synchronisé" permanent qui n'aurait pas de
  // sens.
  cloudSyncConfigured: boolean;
  // Synchronise le coffre ACTIF (celui de `cloudSyncConfigured`). Ne fait
  // rien si aucun coffre actif n'est lié au cloud, ou si une synchro est
  // déjà en cours (protège aussi bien un double-clic que le chevauchement
  // manuel/auto).
  runSync: (trigger?: string) => Promise<void>;
};

const SyncStatusReactContext = createContext<SyncStatusContextValue | null>(null);

// Délai avant le PREMIER cycle auto au lancement de l'app — laisse le temps
// au reste de l'app (vault actif, session Supabase) de finir de se charger
// sans faire concurrence au démarrage perçu par l'utilisatrice.
const AUTO_SYNC_STARTUP_DELAY_MS = 5000;

// v0.4.29 : canal broadcast de propagation temps réel + marqueur de session.
// Volontairement au niveau du MODULE (pas des refs React) : une seule
// instance de ce contexte existe par app, et le linter React interdit les
// mutations de refs hors effets — ici, l'effet écrit et runSync lit, sans
// passer par le rendu.
const SESSION_TAG = Math.random().toString(36).slice(2);
let activeBroadcastChannel: RealtimeChannel | null = null;

function summarizeSuccess(summary: SyncSummary): string {
  const base = `${summary.pushed} envoyée(s), ${summary.pulled} reçue(s), ${summary.deleted} supprimée(s), ${summary.conflicts} conflit(s)`;
  return summary.errors.length > 0 ? `${base} — ${summary.errors.length} erreur(s)` : base;
}

export function SyncStatusProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const { activeVault } = useVaults();
  const { preferences } = usePreferences();

  const [status, setStatus] = useState<SyncStatus>('idle');
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [lastResultSummary, setLastResultSummary] = useState<string | null>(null);
  const [lastConflicts, setLastConflicts] = useState(0);
  const [lastSummary, setLastSummary] = useState<SyncSummary | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);

  const userId = auth.user?.id ?? null;
  const remoteVaultId = activeVault?.cloudLinked ? activeVault.remoteVaultId : null;
  const cloudSyncConfigured = Boolean(userId && remoteVaultId);

  // Empêche un cycle auto de démarrer par-dessus un cycle déjà en cours
  // (manuel ou auto) — un ref plutôt qu'un dérivé de `status` : `runSync`
  // doit voir l'état le plus frais possible au moment de l'appel, pas celui
  // capturé à la dernière fermeture de useCallback.
  const syncingRef = useRef(false);

  // Même exigence de fraîcheur pour userId/remoteVaultId : un appelant peut
  // détenir une version ANTÉRIEURE de `runSync` (closure créée avant que le
  // coffre actif change) — cas réel v0.4.10 : « Connecter sur cet appareil »
  // enchaîne addExistingVault → setCloudLink → runSync dans une même
  // closure ; sans ref, runSync lirait l'ANCIEN coffre actif (celui d'avant
  // la connexion) et ne synchroniserait pas le coffre récupéré. Mis à jour
  // en effet (pas pendant le rendu) pour rester correct en rendu concurrent.
  const latestRef = useRef({ userId, remoteVaultId });
  useEffect(() => {
    latestRef.current = { userId, remoteVaultId };
  }, [userId, remoteVaultId]);

  // Déclencheur du cycle pour le journal (« manuel », « automatique (60 s) »,
  // « surveillance du dossier », « retour à l'app »…) — passé au moteur via
  // un ref pour que chaque appelant garde sa propre version de runSync.
  // v0.4.28 : l'identifiant distant n'est PLUS transmis au moteur — il le
  // déduit lui-même du coffre ACTIF (voir runSync, syncEngine.ts) ; ce ref
  // périmé pendant une bascule était la source de la contamination croisée.
  const triggerRef = useRef<string>('automatique');
  const runSync = useCallback(async (trigger?: string) => {
    if (trigger) triggerRef.current = trigger;
    const { userId: currentUserId, remoteVaultId: currentRemoteVaultId } = latestRef.current;
    if (!currentUserId || !currentRemoteVaultId || syncingRef.current) return;
    syncingRef.current = true;
    // La surveillance du dossier se tait pendant le cycle : les écritures
    // du pull ne doivent pas redéclencher une synchro (boucle).
    await window.sync?.watchPause?.().catch(() => undefined);
    setStatus('syncing');
    try {
      const summary = await runSyncEngine(currentUserId, triggerRef.current);
      setLastSummary(summary);
      if (summary.errors.length > 0) {
        setStatus('error');
        setLastError(summary.errors[0]);
        setLastResultSummary(summarizeSuccess(summary));
      } else {
        setStatus('success');
        setLastError(null);
        setLastSyncedAt(Date.now());
        setLastConflicts(summary.conflicts);
        setLastResultSummary(summarizeSuccess(summary));
      }
      // v0.4.29 : annoncer aux autres appareils du compte qu'un cycle a
      // change le cloud — ils lanceront un cycle ~3 s plus tard au lieu
      // d'attendre le leur (propagation quasi instantanee, broadcast
      // Realtime). Best-effort : une emission perdue retombe sur le cycle.
      if (summary.pushed > 0 || summary.deleted > 0 || summary.conflicts > 0) {
        void activeBroadcastChannel?.send({
          type: 'broadcast',
          event: 'sync',
          payload: {
            from: SESSION_TAG,
            vaultId: currentRemoteVaultId,
            pushed: summary.pushed,
            deleted: summary.deleted,
          },
        });
      }
    } catch (error) {
      console.error('[sync] échec de la synchronisation :', error);
      const message = errorMessage(error);
      setStatus('error');
      setLastSummary(null);
      setLastError(message);
      setLastResultSummary(message);
    } finally {
      await window.sync?.watchResume?.().catch(() => undefined);
      syncingRef.current = false;
    }
  }, []);

  // Synchro automatique (Paramètres → Compte et synchronisation → "Synchro-
  // niser automatiquement") : STRICTEMENT rien si la préférence est fausse
  // (défaut) — un seul cycle après le délai de démarrage. PAS de cycle
  // périodique ensuite : la sync est ÉVÉNEMENTIELLE (demande utilisateur :
  // plus de loop minute polluant le journal à vide). Les déclencheurs :
  // - surveillance du dossier (les changements locaux, ~2 s après écriture) ;
  // - broadcast temps réel (les changements distants, ~3 s après un push
  //   d'un autre appareil) ;
  // - retour au premier plan de la fenêtre (rattrape ce qui aurait pu être
  //   manqué pendant l'inactivité).
  // Le cycle de démarrage rattrape de toute façon tout ce qui aurait pu
  // être manqué pendant que l'app était fermée.
  useEffect(() => {
    if (!preferences.autoSyncEnabled || !cloudSyncConfigured) return;
    const startupTimeout = setTimeout(() => void runSync('démarrage'), AUTO_SYNC_STARTUP_DELAY_MS);
    return () => clearTimeout(startupTimeout);
  }, [preferences.autoSyncEnabled, cloudSyncConfigured, runSync]);

  // Un cycle au retour du premier plan : après une période d'inactivité
  // (app en arrière-plan, le watcher s'exécute quand même — mais un
  // événement perdu n'aurait personne pour le rattraper ici), le retour de
  // l'utilisatrice est le moment le plus sûr pour rattraper.
  useEffect(() => {
    if (!preferences.autoSyncEnabled || !cloudSyncConfigured) return;
    const onFocus = () => void runSync('retour au premier plan');
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', onFocus);
      return () => window.removeEventListener('focus', onFocus);
    }
  }, [preferences.autoSyncEnabled, cloudSyncConfigured, runSync]);

  // Synchro continue (v0.4.20) : le dossier du coffre actif est surveillé —
  // chaque modification de contenu déclenche une synchro ~2 s après la
  // dernière écriture (un cycle déjà en cours verra la modification).
  useEffect(() => {
    const sync = typeof window !== 'undefined' ? window.sync : undefined;
    if (!preferences.autoSyncEnabled || !cloudSyncConfigured || !sync?.onLocalChanged) return;
    void sync.watchRestart?.().catch(() => undefined);
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = sync.onLocalChanged(() => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => void runSync('surveillance du dossier'), 2000);
    });
    return () => {
      if (debounce) clearTimeout(debounce);
      unsubscribe();
    };
  }, [preferences.autoSyncEnabled, cloudSyncConfigured, runSync]);

  // Relance la surveillance quand le coffre actif change (le watcher est
  // lié au chemin du dossier côté processus principal).
  useEffect(() => {
    if (!preferences.autoSyncEnabled || !cloudSyncConfigured) return;
    void window.sync?.watchRestart?.().catch(() => undefined);
  }, [preferences.autoSyncEnabled, cloudSyncConfigured, remoteVaultId]);

  // Réception TEMPS RÉEL (v0.4.29) : Realtime BROADCAST entre appareils du
  // même compte — quand un appareil pousse des changements, il l'annonce sur
  // le canal du compte et les autres lancent un cycle ~3 s plus tard.
  // Pourquoi broadcast et plus postgres_changes (tenté en v0.4.26) : l'écoute
  // de la base accepte nos abonnements mais ne diffuse JAMAIS les événements
  // pour notre schéma privé (publication + replica identity testés sans
  // effet — vécu) ; le broadcast, lui, passe par le websocket Realtime sans
  // dépendre du WAL : c'est le canal de propagation instantanée, le « flux
  // continu » demandé par l'utilisatrice. Le cycle de 20 s reste en filet de
  // sécurité, et le focus de la fenêtre déclenche aussi un cycle.
  // L'émission se fait dans runSync (après un cycle qui a changé le cloud) ;
  // sessionTag identifie cette session pour ignorer ses propres annonces.
  useEffect(() => {
    if (!preferences.autoSyncEnabled || !userId || !supabase) return;
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const scheduleSync = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => void runSync('annonce temps réel'), 3000);
    };
    const channel = supabase
      .channel(`sync-activity-${userId}`, { config: { broadcast: { self: false } } })
      .on('broadcast', { event: 'sync' }, (payload: { payload?: { from?: string; vaultId?: string } }) => {
        const info = payload.payload ?? {};
        if (info.from === SESSION_TAG) return;
        // Seul le coffre ACTIF se synchronise : ignorer les annonces des
        // autres coffres (ils se synchroniseront à leur activation).
        if (info.vaultId && info.vaultId !== latestRef.current.remoteVaultId) return;
        scheduleSync();
      })
      .subscribe();
    activeBroadcastChannel = channel;
    const onFocus = () => scheduleSync();
    window.addEventListener('focus', onFocus);
    return () => {
      if (debounce) clearTimeout(debounce);
      window.removeEventListener('focus', onFocus);
      activeBroadcastChannel = null;
      if (supabase) void supabase.removeChannel(channel);
    };
  }, [preferences.autoSyncEnabled, userId, runSync]);

  const value = useMemo<SyncStatusContextValue>(
    () => ({
      status,
      lastSyncedAt,
      lastResultSummary,
      lastConflicts,
      lastSummary,
      lastError,
      cloudSyncConfigured,
      runSync,
    }),
    [status, lastSyncedAt, lastResultSummary, lastConflicts, lastSummary, lastError, cloudSyncConfigured, runSync],
  );

  return <SyncStatusReactContext.Provider value={value}>{children}</SyncStatusReactContext.Provider>;
}

export function useSyncStatus(): SyncStatusContextValue {
  const ctx = useContext(SyncStatusReactContext);
  if (!ctx) {
    throw new Error('useSyncStatus() doit être appelé sous <SyncStatusProvider>');
  }
  return ctx;
}
