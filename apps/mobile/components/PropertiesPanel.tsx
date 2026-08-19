import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { parseFrontmatter } from '../lib/frontmatter';
import { usePropertyDefinitions } from '../lib/usePropertyDefinitions';
import { usePropertyValues } from '../lib/usePropertyValues';
import { TYPE_ICONS } from '../lib/propertyTypes';
import type { Theme } from '../theme';
import { AddPropertyButton } from './AddPropertyButton';
import { PropertyValueField } from './PropertyValueField';

// Onglet "Propriétés" de la barre latérale (voir RightSidebar.tsx,
// NotesScreen.tsx) — édition des VALEURS de la note actuellement ouverte,
// façon capture de référence (.claude/References/image-4.png) : une icône
// par ligne, un widget dédié par type (voir PropertyValueField.tsx), et un
// bouton "+" pour ajouter une propriété existante plutôt qu'un champ texte
// libre. Le SCHÉMA global (créer/renommer/changer de type/supprimer une
// propriété, options du type "Options"…) se configure maintenant dans
// Paramètres → Gestion des propriétés (voir
// settings/PropertiesManagementSection.tsx) — ce panneau ne fait plus que
// consommer ce schéma. Même données/logique que PropertiesBlock.tsx (bloc
// en haut de note) via lib/usePropertyValues.ts.
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
  activeNote: VaultEntry | null;
  content: string;
  onChangeContent: (text: string) => void;
  tree?: VaultTreeNode[];
};

export function PropertiesPanel({ theme, activeNote, content, onChangeContent, tree }: Props) {
  const propertiesBridge = typeof window !== 'undefined' ? window.properties : undefined;
  const { definitions } = usePropertyDefinitions();
  const { data, definitionsUsedOnNote, availableToAdd, setValue, addValue, removeValue } = usePropertyValues(
    content,
    onChangeContent,
    definitions,
  );

  if (!propertiesBridge) {
    return (
      <View style={styles.container}>
        <Text style={[styles.muted, { color: theme.textMuted }]}>
          Disponible sur la version desktop pour l’instant.
        </Text>
      </View>
    );
  }

  const isMarkdownNote = activeNote?.kind === 'markdown';
  const createdRaw = parseFrontmatter(content).data.created;
  const createdLabel =
    typeof createdRaw === 'string' && !Number.isNaN(Date.parse(createdRaw))
      ? formatTimestamp(Date.parse(createdRaw))
      : '—';

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={[styles.sectionTitle, { color: theme.text }]}>Propriétés</Text>
      {!isMarkdownNote ? (
        <Text style={[styles.muted, { color: theme.textMuted }]}>
          Seules les notes (pas les canvas/graphiques) ont des propriétés.
        </Text>
      ) : (
        <>
          <View style={styles.valueRow}>
            <Text style={{ fontSize: 12 }}>➕</Text>
            <Text style={[styles.valueLabel, { color: theme.textMuted }]}>Créé</Text>
            <Text style={[styles.readonlyValue, { color: theme.text }]}>{createdLabel}</Text>
          </View>
          <View style={styles.valueRow}>
            <Text style={{ fontSize: 12 }}>✏️</Text>
            <Text style={[styles.valueLabel, { color: theme.textMuted }]}>Modifié</Text>
            <Text style={[styles.readonlyValue, { color: theme.text }]}>
              {activeNote ? formatTimestamp(activeNote.modifiedAt) : '—'}
            </Text>
          </View>

          {definitionsUsedOnNote.map((def) => (
            <View key={def.id} style={styles.valueRow}>
              <Text style={{ fontSize: 12 }}>{TYPE_ICONS[def.type]}</Text>
              <Text style={[styles.valueLabel, { color: theme.textMuted }]} numberOfLines={1}>
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
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 12,
    gap: 8,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
  },
  muted: {
    fontSize: 12,
    lineHeight: 18,
  },
  valueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  valueLabel: {
    width: 70,
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
