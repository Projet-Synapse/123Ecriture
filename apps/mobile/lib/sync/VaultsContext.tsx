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
  // `title` optionnel : question affichée par le sélecteur de dossier natif
  // (« Où placer les fichiers de « X » ? » lors de la connexion d'un coffre
  // distant) — voir VaultsBridge.addExisting.
  addExistingVault: (title?: string) => Promise<VaultRegistryEntry | null>;
  // `title` : question du sélecteur ; `vaultName` : nom affiché ≠ dossier
  // (voir VaultsBridge.createNew). Renvoie l'entrée créée (null = annulée).
  createVault: (name: string, title?: string, vaultName?: string) => Promise<VaultRegistryEntry | null>;
  // Connexion d'un coffre distant : demande l'emplacement, crée le
  // sous-dossier au nom du distant, lie au distant EXISTANT (jamais de
  // nouvelle ligne `vaults`). null = dialogue annulée.
  retrieveRemoteVault: (remote: { id: string; name: string }) => Promise<VaultRegistryEntry | null>;
  renameVault: (id: string, name: string) => Promise<void>;
  removeVault: (id: string) => Promise<void>;
  setCloudLink: (id: string, payload: { linked: boolean; remoteVaultId?: string | null }) => Promise<void>;
  // Déconnexion d'un coffre distant : supprime le contenu déposé du dossier
  // puis retire le coffre de la liste (destructif, confirmé côté UI).
  disconnectVault: (id: string) => Promise<void>;
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

  const addExistingVault = useCallback(async (title?: string): Promise<VaultRegistryEntry | null> => {
    if (!bridge) return null;
    // Renvoie l'entrée AJOUTÉE (diff avant/après) : « Connecter » sur un
    // coffre distant (Paramètres → Coffres distants) enchaîne choix du
    // dossier → liaison cloud sans avoir à deviner laquelle des lignes vient
    // d'apparaître. null = boîte de dialogue annulée (liste inchangée).
    const before = new Set(vaultList.map((v) => v.id));
    const list = await bridge.addExisting(title);
    setVaultList(list);
    setActiveVaultId(await bridge.getActive());
    return list.find((v) => !before.has(v.id)) ?? null;
  }, [bridge, vaultList]);

  // `vaultName` : nom affiché ≠ dossier (connexion d'un coffre distant —
  // voir VaultsBridge.createNew). Renvoie l'entrée CRÉÉE (diff avant/après,
  // même contrat que addExistingVault) pour que « Connecter sur cet
  // appareil » puisse enchaîner liaison + dépôt ; null = dialogue annulée.
  const createVault = useCallback(
    async (name: string, title?: string, vaultName?: string): Promise<VaultRegistryEntry | null> => {
      if (!bridge) return null;
      const before = new Set(vaultList.map((v) => v.id));
      const list = await bridge.createNew(name, title, vaultName);
      setVaultList(list);
      setActiveVaultId(await bridge.getActive());
      return list.find((v) => !before.has(v.id)) ?? null;
    },
    [bridge, vaultList],
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

  // Déconnexion d'un coffre distant (action DESTRUCTIVE, toujours confirmée
  // côté UI avant l'appel) : le contenu déposé dans le dossier disparaît,
  // le coffre est retiré de la liste locale — le coffre distant et ses
  // fichiers restent intacts dans le cloud (c'est le sens d'une
  // « déconnexion »). On vide AVANT de retirer l'entrée : si la suppression
  // échoue, le coffre reste listé et l'erreur est visible, plutôt qu'un
  // dossier fantôme plein mais orphelin. Le retrait d'entrée est aussi ce
  // qui évite à la liaison automatique de re-lier immédiatement le coffre
  // (elle ne voit jamais d'état intermédiaire « délié mais présent »).
  const disconnectVault = useCallback(
    async (id: string) => {
      if (!bridge) return;
      if (!bridge.clearVaultContent) {
        throw new Error('Déconnexion indisponible sur cette plateforme.');
      }
      await bridge.clearVaultContent(id);
      await removeVault(id);
    },
    [bridge, removeVault],
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
  // pas sinon : un échec n'écrit rien dans le registre) — ou après une
  // connexion de coffre distant (voir retrieveRemoteVault).
  const [autoLinkNonce, setAutoLinkNonce] = useState(0);
  const autoLinkInFlight = useRef<Set<string>>(new Set());
  const userId = auth.user?.id ?? null;

  // Vrai pendant une « connexion de coffre distant » ENTIÈRE (création du
  // dossier → liaison au distant choisi) : le guetteur doit se taire durant
  // cette fenêtre — le coffre fraîchement créé sera relié au distant
  // EXISTANT choisi, et sans ce drapeau le guetteur (déclenché par le
  // setVaultList de la création) créerait une ligne `vaults` orpheline
  // AVANT notre setCloudLink. Posé AVANT createVault : aucun rendu ne peut
  // s'intercaler, contrairement à un Set d'ids rempli après coup.
  const retrieveActive = useRef(false);

  useEffect(() => {
    if (!userId || !bridge || retrieveActive.current) return;
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

  // Connexion d'un coffre distant SUR CET APPAREIL, dans l'ordre demandé par
  // l'utilisatrice (v0.4.11) : 1) « Connecter » (Paramètres → Coffres
  // distants), 2) l'app demande OÙ placer les fichiers, 3) un SOUS-DOSSIER
  // au NOM du coffre distant est créé à cet endroit (jamais de mélange de
  // contenus : deux coffres placés au même endroit vivent côte à côte, et le
  // coffre garde son nom original même si le dossier est dédoublonné « X 2 »)
  // puis lié au distant — le dépôt du contenu suit via syncStatus.runSync()
  // côté UI. Retourne l'entrée créée, ou null si la dialogue a été annulée.
  const retrieveRemoteVault = useCallback(
    async (remote: { id: string; name: string }): Promise<VaultRegistryEntry | null> => {
      if (!bridge) return null;
      retrieveActive.current = true;
      try {
        const added = await createVault(
          remote.name,
          `Où placer les fichiers de « ${remote.name} » ?`,
          remote.name,
        );
        if (!added) return null;
        await setCloudLink(added.id, { linked: true, remoteVaultId: remote.id });
        return added;
      } finally {
        // Relance le guetteur : rattrape d'éventuels coffres restés non
        // liés pendant la fenêtre silencieuse (et si la liaison au distant
        // a échoué, le coffre créé retombe sur la liaison auto en secours).
        retrieveActive.current = false;
        setAutoLinkNonce((n) => n + 1);
      }
    },
    [bridge, createVault, setCloudLink],
  );

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
      retrieveRemoteVault,
      renameVault,
      removeVault,
      disconnectVault,
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
      retrieveRemoteVault,
      renameVault,
      removeVault,
      disconnectVault,
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
