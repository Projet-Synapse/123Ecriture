import { useCallback, useMemo } from 'react';

import { parseFrontmatter, reorderFrontmatterData, serializeFrontmatter, type FrontmatterData } from './frontmatter';
import { defaultValueForType } from './propertyTypes';

// Logique partagée d'édition des VALEURS de propriétés d'une note (lecture/
// écriture de son frontmatter) — utilisée par PropertiesPanel.tsx (barre
// latérale) ET PropertiesBlock.tsx (bloc en haut de note), pour rester
// synchronisées sur les mêmes données sans dupliquer parseFrontmatter/
// serializeFrontmatter à deux endroits (voir lib/frontmatter.ts).
//
// Le FRONTMATTER est la source de vérité (demande utilisateur : « les trois
// modes doivent détenir les mêmes informations ») : `lines` expose TOUTES
// les clés présentes entre les ---, dans leur ordre réel du fichier — pas
// seulement celles déclarées dans le schéma (une clé inconnue comme `tags`
// s'affiche donc partout, avec un champ texte tant qu'aucune définition du
// même nom n'existe dans Paramètres → Gestion des propriétés). Les clés
// système `created`/`modified` (matérialisées à la sauvegarde, voir
// NotesScreen.tsx) sont marquées `isSystemDate` : lecture seule dans les
// vues, puisque leur valeur est réécrite par l'app.
export type PropertyLine = {
  name: string;
  value: unknown;
  // Définition du schéma portant EXACTEMENT ce nom (widget typé, renommage
  // global possible) — null si la clé n'est pas encore enregistrée.
  definition: PropertyDefinition | null;
  // `created`/`modified` : gérées par l'app à la sauvegarde → affichage en
  // lecture seule (une édition manuelle serait écrasée).
  isSystemDate: boolean;
};

export function usePropertyValues(
  content: string,
  onChangeContent: (text: string) => void,
  definitions: PropertyDefinition[],
) {
  const { data, body } = useMemo(() => parseFrontmatter(content), [content]);

  const commitData = useCallback(
    (nextData: FrontmatterData) => {
      onChangeContent(serializeFrontmatter(nextData, body));
    },
    [onChangeContent, body],
  );

  const usedNames = useMemo(() => new Set(Object.keys(data)), [data]);

  // TOUTES les clés du frontmatter, dans l'ordre réel du fichier (ordre
  // d'insertion de l'objet parsé) — enrichies de la définition du schéma
  // quand il en existe une portant exactement ce nom.
  const lines = useMemo<PropertyLine[]>(
    () =>
      Object.entries(data).map(([name, value]) => ({
        name,
        value,
        definition: definitions.find((def) => def.name === name) ?? null,
        isSystemDate: name === 'created' || name === 'modified',
      })),
    [data, definitions],
  );

  const availableToAdd = useMemo(
    () => definitions.filter((def) => !usedNames.has(def.name)),
    [definitions, usedNames],
  );

  const setValue = useCallback(
    (name: string, value: unknown) => commitData({ ...data, [name]: value }),
    [data, commitData],
  );

  const addValue = useCallback(
    (def: PropertyDefinition) => commitData({ ...data, [def.name]: defaultValueForType(def.type) }),
    [data, commitData],
  );

  const removeValue = useCallback(
    (name: string) => {
      const next = { ...data };
      delete next[name];
      commitData(next);
    },
    [data, commitData],
  );

  // Réordonnancement (glisser-déposer du bloc en mode Intermédiaire) —
  // réécrit le frontmatter dans le nouvel ordre, donc le mode Source suit.
  // reorderFrontmatterData conserve les clés absentes de la liste (jamais
  // de perte de donnée sur une liste périmée).
  const reorder = useCallback(
    (orderedNames: string[]) => commitData(reorderFrontmatterData(data, orderedNames)),
    [data, commitData],
  );

  return { data, lines, availableToAdd, setValue, addValue, removeValue, reorder };
}
