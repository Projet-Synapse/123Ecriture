import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

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
  // Emplacements suspects (desktop, v0.4.16) : id -> 'missing' (dossier
  // disparu) | 'no-identity' (dossier témoin sans identité = coffre déplacé).
  vaultFolderIssues: Record<string, 'missing' | 'no-identity'>;
  // Retrouve un coffre déplacé (sélecteur natif + validation d'identité) ;
  // false = annulé par l'utilisatrice.
  relocateVault: (id: string) => Promise<boolean>;
};

const VaultsReactContext = createContext<VaultsContextValue | null>(null);

export function VaultsProvider({ children }: { children: ReactNode }) {
  const bridge = typeof window !== 'undefined' ? window.vaults : undefined;
  const [vaultList, setVaultList] = useState<VaultRegistryEntry[]>([]);
  const [activeVaultId, setActiveVaultId] = useState<string | null>(null);
  // Emplacements suspects, recalculés à chaque changement de liste (les
  // bridges sans checkVaultFolders — web/natif — restent vides : rien à
  // surveiller de ce genre là-bas pour l'instant).
  const [vaultFolderIssues, setVaultFolderIssues] = useState<Record<string, 'missing' | 'no-identity'>>({});
  const refreshFolderIssues = useCallback(() => {
    if (!bridge?.checkVaultFolders) return;
    bridge
      .checkVaultFolders()
      .then((all) => {
        const issues: Record<string, 'missing' | 'no-identity'> = {};
        for (const [id, status] of Object.entries(all)) {
          if (status !== 'ok') issues[id] = status;
        }
        setVaultFolderIssues(issues);
      })
      .catch((error) => console.error('[vaults] vérification des emplacements échouée :', error));
  }, [bridge]);
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
    refreshFolderIssues();
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
  }, [bridge, refreshFolderIssues]);

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

  // Retrouve un coffre déplacé : sélecteur natif, validation d'identité et
  // mise à jour du chemin côté pont (vaults.ts relocateVault). Retourne
  // false si l'utilisatrice annule le sélecteur.
  const relocateVault = useCallback(
    async (id: string): Promise<boolean> => {
      if (!bridge?.relocateVault) {
        throw new Error('Retrouver le dossier est disponible sur la version desktop.');
      }
      const list = await bridge.relocateVault(id);
      if (!list) return false;
      setVaultList(list);
      setActiveVaultId(await bridge.getActive());
      refreshFolderIssues();
      return true;
    },
    [bridge, refreshFolderIssues],
  );

  const setCloudLink = useCallback(
    async (id: string, payload: { linked: boolean; remoteVaultId?: string | null }) => {
      if (!bridge) return;
      setVaultList(await bridge.setCloudLink(id, payload));
    },
    [bridge],
  );

  // Connexion d'un coffre distant SUR CET APPAREIL, dans l'ordre demandé par
  // l'utilisatrice (v0.4.11) : 1) « Connecter » (Paramètres → Coffres
  // distants), 2) l'app demande OÙ placer les fichiers, 3) un SOUS-DOSSIER
  // au NOM du coffre distant est créé à cet endroit (jamais de mélange de
  // contenus : deux coffres placés au même endroit vivent côte à côte, et le
  // coffre garde son nom original même si le dossier est dédoublonné « X 2 »)
  // puis lié au distant — le dépôt du contenu suit via syncStatus.runSync()
  // côté UI. Retourne l'entrée créée, ou null si la dialogue a été annulée.
  // (v0.4.14 : plus de garde « guetteur » — la liaison automatique a été
  // retirée, un coffre local ne devient JAMAIS un coffre distant sans action
  // explicite : modèle « le coffre distant est une donnée du compte ».)
  const retrieveRemoteVault = useCallback(
    async (remote: { id: string; name: string }): Promise<VaultRegistryEntry | null> => {
      if (!bridge) return null;
      const added = await createVault(
        remote.name,
        `Où placer les fichiers de « ${remote.name} » ?`,
        remote.name,
      );
      if (!added) return null;
      await setCloudLink(added.id, { linked: true, remoteVaultId: remote.id });
      return added;
    },
    [bridge, createVault, setCloudLink],
  );

  useEffect(() => {
    refreshFolderIssues();
  }, [vaultList, refreshFolderIssues]);

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
      vaultFolderIssues,
      relocateVault,
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
      vaultFolderIssues,
      relocateVault,
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
