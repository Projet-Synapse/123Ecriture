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
  addExistingVault: () => Promise<void>;
  createVault: (name: string) => Promise<void>;
  renameVault: (id: string, name: string) => Promise<void>;
  removeVault: (id: string) => Promise<void>;
  setCloudLink: (id: string, payload: { linked: boolean; remoteVaultId?: string | null }) => Promise<void>;
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
      setActiveVaultId(id);
    },
    [bridge],
  );

  const addExistingVault = useCallback(async () => {
    if (!bridge) return;
    setVaultList(await bridge.addExisting());
    setActiveVaultId(await bridge.getActive());
  }, [bridge]);

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
