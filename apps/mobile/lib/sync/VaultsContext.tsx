import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { useAuth } from './AuthContext';
import { errorMessage } from '../errorMessage';
import { pickVaultsToAutoLink } from './autoLink';
import { linkVaultToCloud } from './syncEngine';

// Registre des coffres (vaults) multiples — voir
// docs/ARCHITECTURE.md §5/§6 et apps/desktop/electron/vaults.js. Même schéma
// que preferences/PreferencesContext.tsx : lit/persiste via un pont optionnel
// (window.vaults, exposé uniquement côté Electron desktop pour l'instant) et
// se dégrade proprement (liste vide, aucun crash) quand ce pont est absent —
// sur web/mobile natif, Notes/Tâches affichent déjà leur propre message
// "disponible sur desktop pour l'instant" dans ce cas.
//
// Centraliser ce state ICI (plutôt que dans NotesScreen/TasksScreen comme
// avant) permet à un changement de coffre déclenché n'importe où dans l'app
// (barre latérale, Paramètres) de rafraîchir tous les écrans qui en
// dépendent — aucun mécanisme de ce genre n'existait avant l'introduction
// des coffres multiples.

type VaultsContextValue = {
  vaults: VaultRegistryEntry[];
  activeVaultId: string | null;
  activeVault: VaultRegistryEntry | null;
  activeVaultPath: string | null;
  loading: boolean;
  switchVault: (id: string) => Promise<void>;
  addExistingVault: () => Promise<VaultRegistryEntry | null>;
  createVault: (name: string) => Promise<void>;
  renameVault: (id: string, name: string) => Promise<void>;
  removeVault: (id: string) => Promise<void>;
  setCloudLink: (id: string, payload: { linked: boolean; remoteVaultId?: string | null }) => Promise<void>;
  // Liaison automatique au compte (voir l'effet ci-dessous) : dernière
  // erreur rencontrée, affichée en discret dans Paramètres, et relance
  // manuelle — un échec ne bloque jamais l'usage local du coffre.
  autoLinkError: string | null;
  retryAutoLink: () => void;
};

const VaultsReactContext = createContext<VaultsContextValue | null>(null);

export function VaultsProvider({ children }: { children: ReactNode }) {
  const bridge = typeof window !== 'undefined' ? window.vaults : undefined;
  const [vaultList, setVaultList] = useState<VaultRegistryEntry[]>([]);
  const [activeVaultId, setActiveVaultId] = useState<string | null>(null);
  // Initialisé selon la présence du pont (pas dans l'effet ci-dessous) :
  // sans pont, il n'y a jamais de chargement à attendre, `loading` doit donc
  // démarrer à `false` directement plutôt que d'être corrigé après coup par
  // un setState synchrone en tête d'effet.
  const [loading, setLoading] = useState(() => Boolean(bridge));

  useEffect(() => {
    if (!bridge) return;
    let cancelled = false;
    void (async () => {
      try {
        const [list, active] = await Promise.all([bridge.list(), bridge.getActive()]);
        if (cancelled) return;
        setVaultList(list);
        setActiveVaultId(active);
      } catch (error) {
        console.error('[vaults] échec du chargement initial :', error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    const unsubscribe = bridge.onChanged((list) => {
      setVaultList(list);
      // Le process principal ne renvoie pas l'id actif avec l'évènement
      // "changed" (juste la liste) — on le retrouve dans la liste elle-même
      // plutôt que de refaire un aller-retour IPC à chaque mutation.
      void bridge.getActive().then(setActiveVaultId);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [bridge]);

  const switchVault = useCallback(
    async (id: string) => {
      if (!bridge) return;
      setVaultList(await bridge.switch(id));
      // Id actif EFFECTIF, pas supposé : en web, switch peut échouer
      // silencieusement (permission du dossier refusée dans la boîte de
      // dialogue — webVaultRegistry.activate renvoie false sans activer).
      // Mettre l'id demandé sans vérifier afficherait un coffre actif
      // fantôme dont tous les accès fichiers échoueraient ensuite.
      setActiveVaultId(await bridge.getActive());
    },
    [bridge],
  );

  const addExistingVault = useCallback(async (): Promise<VaultRegistryEntry | null> => {
    if (!bridge) return null;
    // Renvoie l'entrée AJOUTÉE (diff avant/après) : « Récupérer dans un
    // dossier… » (Paramètres → Coffres distants) enchaîne choix du dossier →
    // liaison cloud sans avoir à deviner laquelle des lignes vient
    // d'apparaître. null = boîte de dialogue annulée (liste inchangée).
    const before = new Set(vaultList.map((v) => v.id));
    const list = await bridge.addExisting();
    setVaultList(list);
    setActiveVaultId(await bridge.getActive());
    return list.find((v) => !before.has(v.id)) ?? null;
  }, [bridge, vaultList]);

  const createVault = useCallback(
    async (name: string) => {
      if (!bridge) return;
      setVaultList(await bridge.createNew(name));
      setActiveVaultId(await bridge.getActive());
    },
    [bridge],
  );

  const renameVault = useCallback(
    async (id: string, name: string) => {
      if (!bridge) return;
      setVaultList(await bridge.rename(id, name));
    },
    [bridge],
  );

  const removeVault = useCallback(
    async (id: string) => {
      if (!bridge) return;
      setVaultList(await bridge.remove(id));
      setActiveVaultId(await bridge.getActive());
    },
    [bridge],
  );

  const setCloudLink = useCallback(
    async (id: string, payload: { linked: boolean; remoteVaultId?: string | null }) => {
      if (!bridge) return;
      setVaultList(await bridge.setCloudLink(id, payload));
    },
    [bridge],
  );

  // Liaison automatique au compte : connecté·e, TOUT coffre du registre est
  // une donnée du compte — présent avant la connexion OU ajouté ensuite,
  // quel que soit le chemin d'entrée (« Ajouter un dossier existant »,
  // « Nouveau coffre », « Choisir un dossier » des écrans vides : tous
  // aboutissent au même registre, que l'ajout passe par ce contexte ou
  // directement par le pont vault.chooseFolder). AuthProvider est
  // au-dessus de VaultsProvider (App.tsx), useAuth est donc disponible ici.
  const auth = useAuth();
  const [autoLinkError, setAutoLinkError] = useState<string | null>(null);
  // Force une reprise de l'effet après un échec (ses dépendances ne changent
  // pas sinon : un échec n'écrit rien dans le registre).
  const [autoLinkNonce, setAutoLinkNonce] = useState(0);
  const autoLinkInFlight = useRef<Set<string>>(new Set());
  const userId = auth.user?.id ?? null;

  useEffect(() => {
    if (!userId || !bridge) return;
    const targets = pickVaultsToAutoLink(vaultList, autoLinkInFlight.current);
    if (targets.length === 0) return;
    targets.forEach((v) => autoLinkInFlight.current.add(v.id));
    void (async () => {
      let lastError: string | null = null;
      for (const v of targets) {
        try {
          const remoteVaultId = await linkVaultToCloud(v.id, v.name, userId);
          await setCloudLink(v.id, { linked: true, remoteVaultId });
        } catch (error) {
          console.error('[vaults] échec de la liaison automatique :', error);
          lastError = errorMessage(error);
        } finally {
          autoLinkInFlight.current.delete(v.id);
        }
      }
      setAutoLinkError(lastError);
    })();
    // autoLinkNonce : volontairement absent des deps de nettoyage — il ne
    // sert qu'à relancer, jamais à interrompre un tour en cours.
     
  }, [userId, bridge, vaultList, setCloudLink, autoLinkNonce]);

  const retryAutoLink = useCallback(() => {
    setAutoLinkError(null);
    setAutoLinkNonce((n) => n + 1);
  }, []);

  const activeVault = vaultList.find((v) => v.id === activeVaultId) ?? null;

  const value = useMemo<VaultsContextValue>(
    () => ({
      vaults: vaultList,
      activeVaultId,
      activeVault,
      activeVaultPath: activeVault?.path ?? null,
      loading,
      switchVault,
      addExistingVault,
      createVault,
      renameVault,
      removeVault,
      setCloudLink,
      autoLinkError,
      retryAutoLink,
    }),
    [
      vaultList,
      activeVaultId,
      activeVault,
      loading,
      switchVault,
      addExistingVault,
      createVault,
      renameVault,
      removeVault,
      setCloudLink,
      autoLinkError,
      retryAutoLink,
    ],
  );

  return <VaultsReactContext.Provider value={value}>{children}</VaultsReactContext.Provider>;
}

export function useVaults(): VaultsContextValue {
  const ctx = useContext(VaultsReactContext);
  if (!ctx) {
    throw new Error('useVaults() doit être appelé sous <VaultsProvider>');
  }
  return ctx;
}
