import { useCallback, useMemo } from 'react';

import { parseFrontmatter, serializeFrontmatter, type FrontmatterData } from './frontmatter';
import { defaultValueForType } from './propertyTypes';

// Logique partagée d'édition des VALEURS de propriétés d'une note (lecture/
// écriture de son frontmatter) — utilisée par PropertiesPanel.tsx (barre
// latérale) ET PropertiesBlock.tsx (bloc en haut de note), pour rester
// synchronisées sur les mêmes données sans dupliquer parseFrontmatter/
// serializeFrontmatter à deux endroits (voir lib/frontmatter.ts).
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
  const definitionsUsedOnNote = useMemo(
    () => definitions.filter((def) => usedNames.has(def.name)),
    [definitions, usedNames],
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

  return { data, definitionsUsedOnNote, availableToAdd, setValue, addValue, removeValue };
}
