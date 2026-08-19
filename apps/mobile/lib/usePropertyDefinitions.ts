import { useCallback, useEffect, useState } from 'react';

// Accès au schéma global de propriétés (`.123ecriture/properties.json`,
// voir apps/desktop/electron/properties.ts) — partagé par
// PropertiesPanel.tsx, PropertiesBlock.tsx (lecture seule, `list`) et
// settings/PropertiesManagementSection.tsx (CRUD complet), pour ne pas
// recharger/dupliquer la même logique de rafraîchissement à 3 endroits.
export function usePropertyDefinitions() {
  const bridge = typeof window !== 'undefined' ? window.properties : undefined;
  const [definitions, setDefinitions] = useState<PropertyDefinition[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!bridge) return;
    setDefinitions(await bridge.list());
  }, [bridge]);

  useEffect(() => {
    void (async () => {
      try {
        await refresh();
      } catch (err) {
        console.error('[properties] échec du chargement initial :', err);
      }
    })();
  }, [refresh]);

  const runAction = useCallback(async (action: () => Promise<PropertyDefinition[]>) => {
    setError(null);
    try {
      setDefinitions(await action());
    } catch (err) {
      console.error('[properties] échec :', err);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const create = useCallback(
    (name: string, type: PropertyType, options?: string[]) => {
      if (!bridge) return Promise.resolve();
      return runAction(() => bridge.create(name, type, options));
    },
    [bridge, runAction],
  );

  const update = useCallback(
    (id: string, patch: PropertyPatch) => {
      if (!bridge) return Promise.resolve();
      return runAction(() => bridge.update(id, patch));
    },
    [bridge, runAction],
  );

  const remove = useCallback(
    (id: string) => {
      if (!bridge) return Promise.resolve();
      return runAction(() => bridge.remove(id));
    },
    [bridge, runAction],
  );

  return { bridge, definitions, error, create, update, remove };
}
