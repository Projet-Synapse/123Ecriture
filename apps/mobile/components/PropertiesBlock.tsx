import { StyleSheet, Text, View } from 'react-native';

import { parseFrontmatter } from '../lib/frontmatter';
import { usePropertyDefinitions } from '../lib/usePropertyDefinitions';
import { usePropertyValues } from '../lib/usePropertyValues';
import { TYPE_ICONS } from '../lib/propertyTypes';
import type { Theme } from '../theme';
import { AddPropertyButton } from './AddPropertyButton';
import { PropertyValueField } from './PropertyValueField';

// Bloc "Propriétés" affiché EN HAUT de la note en mode Intermédiaire et
// Aperçu (voir NotesScreen.tsx — pas en mode Source, où le YAML brut du
// frontmatter reste directement éditable tel quel), façon capture de
// référence (.claude/References/image-4.png). Même logique/données que
// PropertiesPanel.tsx (barre latérale), via lib/usePropertyValues.ts — les
// deux surfaces restent synchronisées puisqu'elles lisent/écrivent le même
// frontmatter de la note active.
function formatTimestamp(value: number): string {
  return new Date(value).toLocaleString('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

type Props = {
  theme: Theme;
  activeNote: VaultEntry;
  content: string;
  onChangeContent: (text: string) => void;
  tree: VaultTreeNode[];
};

export function PropertiesBlock({ theme, activeNote, content, onChangeContent, tree }: Props) {
  const { definitions } = usePropertyDefinitions();
  const { data, definitionsUsedOnNote, availableToAdd, setValue, addValue, removeValue } = usePropertyValues(
    content,
    onChangeContent,
    definitions,
  );

  const createdRaw = parseFrontmatter(content).data.created;
  const createdLabel =
    typeof createdRaw === 'string' && !Number.isNaN(Date.parse(createdRaw))
      ? formatTimestamp(Date.parse(createdRaw))
      : '—';

  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <Text style={[styles.title, { color: theme.textMuted }]}>Propriétés</Text>

      <View style={styles.row}>
        <Text style={{ fontSize: 12 }}>➕</Text>
        <Text style={[styles.label, { color: theme.textMuted }]}>Créé</Text>
        <Text style={[styles.readonlyValue, { color: theme.text }]}>{createdLabel}</Text>
      </View>
      <View style={styles.row}>
        <Text style={{ fontSize: 12 }}>✏️</Text>
        <Text style={[styles.label, { color: theme.textMuted }]}>Modifié</Text>
        <Text style={[styles.readonlyValue, { color: theme.text }]}>{formatTimestamp(activeNote.modifiedAt)}</Text>
      </View>

      {definitionsUsedOnNote.map((def) => (
        <View key={def.id} style={styles.row}>
          <Text style={{ fontSize: 12 }}>{TYPE_ICONS[def.type]}</Text>
          <Text style={[styles.label, { color: theme.textMuted }]} numberOfLines={1}>
            {def.name}
          </Text>
          <PropertyValueField
            def={def}
            value={data[def.name]}
            onChange={(value) => setValue(def.name, value)}
            theme={theme}
            tree={tree}
          />
          <Text onPress={() => removeValue(def.name)} style={[styles.rowRemove, { color: theme.textMuted }]}>
            ✕
          </Text>
        </View>
      ))}

      <AddPropertyButton available={availableToAdd} onAdd={addValue} theme={theme} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginHorizontal: 16,
    marginTop: 12,
    gap: 8,
  },
  title: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  label: {
    width: 90,
    fontSize: 12,
  },
  readonlyValue: {
    flex: 1,
    fontSize: 12,
  },
  rowRemove: {
    paddingHorizontal: 4,
  },
});
