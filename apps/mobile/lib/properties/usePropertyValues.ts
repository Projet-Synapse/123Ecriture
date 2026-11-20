import { useCallback, useMemo } from 'react';

import { frontmatterBlockOf, parseFrontmatter, reorderFrontmatterData, replaceFrontmatterData, type FrontmatterData } from './frontmatter';
import { defaultValueForType } from './propertyTypes';

// ✒️ 123ECRITURE — lib/properties/usePropertyValues.ts — édition des valeurs de propriétés d'une note
//////////////////////////////////////////////////////////////////////////////
//
// Logique partagée d'édition des VALEURS de propriétés d'une note
// (lecture/écriture de son frontmatter) — utilisée par PropertiesPanel.tsx
// (barre latérale) ET PropertiesBlock.tsx (bloc en haut de note), pour
// rester synchronisées sur les mêmes données sans dupliquer
// parseFrontmatter/replaceFrontmatterData à deux endroits (voir
// lib/properties/frontmatter.ts).
//
// Invariants du fichier :
//   • Le FRONTMATTER est la source de vérité (les trois modes détiennent
//     les mêmes informations) : `lines` expose TOUTES les clés présentes
//     entre les ---, dans leur ordre réel du fichier — pas seulement
//     celles déclarées dans le schéma. Une clé inconnue comme `tags`
//     s'affiche donc partout, avec un champ texte tant qu'aucune
//     définition du même nom n'existe dans Paramètres → Gestion des
//     propriétés.
//   • Les clés système `created`/`modified` (matérialisées à la
//     sauvegarde, voir NotesScreen.tsx) sont marquées `isSystemDate` :
//     lecture seule dans les vues, puisque leur valeur est réécrite par
//     l'app.
//   • reorder conserve les clés absentes de la liste demandée (jamais de
//     perte de donnée sur une liste périmée, voir
//     reorderFrontmatterData).
//
// SOMMAIRE :
//   1. PropertyLine — une ligne du frontmatter vue par l'UI
//   2. usePropertyValues — lecture/écriture/réordonnancement
//
//////////////////////////////////////////////////////////////////////////////

//////// 1. PropertyLine — une ligne du frontmatter vue par l'UI /////////////

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

//////// 2. usePropertyValues — lecture/écriture/réordonnancement ////////////

export function usePropertyValues(
  content: string,
  onChangeContent: (text: string) => void,
  definitions: PropertyDefinition[],
  getContent?: () => string,
) {
  // Parse YAML seulement quand le BLOC change (pas à chaque frappe dans le
  // corps) : clé de mémo = le bloc brut, découpé sans parser.
  const block = frontmatterBlockOf(content);
  const { data } = useMemo(() => parseFrontmatter(block), [block]);

  // replaceFrontmatterData (et non serializeFrontmatter(data, body)) : seul
  // le bloc est réécrit — BOM, fins de ligne CRLF et corps du fichier
  // restent identiques à l'octet près.
  const commitData = useCallback(
    (nextData: FrontmatterData) => {
      onChangeContent(replaceFrontmatterData(getContent ? getContent() : content, nextData));
    },
    [onChangeContent, content, getContent],
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
