import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { usePropertyDefinitions } from '../lib/usePropertyDefinitions';
import { usePropertyValues, type PropertyLine } from '../lib/usePropertyValues';
import { TYPE_ICONS, makePropertyDefinition } from '../lib/propertyTypes';
import type { Theme } from '../theme';
import { AddPropertyButton } from './AddPropertyButton';
import { DraftTextField } from './DraftTextField';
import { PropertyValueField } from './PropertyValueField';

// Onglet "Propriétés" de la barre latérale (voir RightSidebar.tsx,
// NotesScreen.tsx) — édition des VALEURS de la note actuellement ouverte,
// façon capture de référence (.claude/References/image-4.png) : une icône
// par ligne, un widget dédié par type (voir PropertyValueField.tsx), et un
// bouton "+" pour ajouter une propriété existante ou en créer une nouvelle.
// Le SCHÉMA global (créer/renommer/changer de type/supprimer une propriété,
// options du type "Options"…) se configure dans Paramètres → Gestion des
// propriétés (settings/PropertiesManagementSection.tsx). Mêmes données que
// PropertiesBlock.tsx via lib/usePropertyValues.ts.
//
// SOURCE DE VÉRITÉ = le frontmatter du fichier (même principe que
// PropertiesBlock) : TOUTES les clés du YAML s'affichent, dans leur ordre
// réel, enregistrées au schéma ou non. created/modified sont matérialisées
// à la sauvegarde (NotesScreen.tsx) et s'affichent en lecture seule.
function formatTimestamp(value: number): string {
  return new Date(value).toLocaleString('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Même règle que PropertiesBlock.formatSystemDate : ISO parsé → français,
// valeur libre → affichée telle quelle.
function formatSystemDate(value: unknown): string {
  if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) {
    return formatTimestamp(Date.parse(value));
  }
  if (value === undefined || value === null || value === '') return '—';
  return String(value);
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
  const { definitions, update, create } = usePropertyDefinitions();
  const { lines, availableToAdd, setValue, addValue, removeValue } = usePropertyValues(
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

  // Définition de repli pour une clé non enregistrée (même choix que
  // PropertiesBlock) : champ texte générique.
  const fallbackDefinition = (line: PropertyLine): PropertyDefinition =>
    line.definition ?? makePropertyDefinition(`raw-${line.name}`, line.name, 'text');

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={[styles.sectionTitle, { color: theme.text }]}>Propriétés</Text>
      {!isMarkdownNote ? (
        <Text style={[styles.muted, { color: theme.textMuted }]}>
          Seules les notes (pas les canvas/graphiques) ont des propriétés.
        </Text>
      ) : (
        <>
          {lines.map((line) => (
            <View key={line.name} style={styles.valueRow}>
              <Text style={{ fontSize: 12 }}>
                {line.isSystemDate ? (line.name === 'created' ? '➕' : '✏️') : TYPE_ICONS[line.definition?.type ?? 'text']}
              </Text>
              {line.isSystemDate ? (
                <Text style={[styles.valueLabel, { color: theme.textMuted }]}>
                  {line.name === 'created' ? 'Créé' : 'Modifié'}
                </Text>
              ) : line.definition ? (
                <DraftTextField
                  initialValue={line.definition.name}
                  onCommit={(value) => {
                    const trimmed = value.trim();
                    const def = line.definition;
                    if (def && trimmed && trimmed !== def.name) void update(def.id, { name: trimmed });
                  }}
                  theme={theme}
                  style={[styles.valueLabelInput, { color: theme.textMuted }]}
                />
              ) : (
                <Text style={[styles.valueLabel, { color: theme.textMuted }]} numberOfLines={1}>
                  {line.name}
                </Text>
              )}
              {line.isSystemDate ? (
                <Text style={[styles.readonlyValue, { color: theme.text }]}>{formatSystemDate(line.value)}</Text>
              ) : (
                <PropertyValueField
                  def={fallbackDefinition(line)}
                  value={line.value}
                  onChange={(value) => setValue(line.name, value)}
                  theme={theme}
                  tree={tree}
                />
              )}
              {!line.isSystemDate && (
                <Text
                  onPress={() => removeValue(line.name)}
                  style={[styles.rowRemove, { color: theme.textMuted }]}
                >
                  ✕
                </Text>
              )}
            </View>
          ))}

          <AddPropertyButton
            available={availableToAdd}
            onAdd={addValue}
            onCreateNew={async (name, type) => {
              await create(name, type, type === 'options' ? [] : undefined);
              addValue(makePropertyDefinition(`new-${name}`, name, type));
            }}
            theme={theme}
          />
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
  valueLabelInput: {
    width: 70,
    fontSize: 12,
    paddingVertical: 2,
    paddingHorizontal: 2,
  },
  readonlyValue: {
    flex: 1,
    fontSize: 12,
  },
  rowRemove: {
    paddingHorizontal: 4,
  },
});
