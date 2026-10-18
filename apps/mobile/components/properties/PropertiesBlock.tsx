import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { usePropertyDefinitions } from '../../lib/properties/usePropertyDefinitions';
import { usePropertyValues, type PropertyLine } from '../../lib/properties/usePropertyValues';
import { makePropertyDefinition } from '../../lib/properties/propertyTypes';
import type { Theme } from '../../theme';
import { AddPropertyButton } from './AddPropertyButton';
import { DraftTextField } from '../editors/DraftTextField';
import { PropertyValueField } from './PropertyValueField';

// ✒️ 123ECRITURE — components/properties/PropertiesBlock.tsx — le bloc « Propriétés » de la note
//////////////////////////////////////////////////////////////////////////////
//
// Bloc "Propriétés" rendu DANS la note (modes Intermédiaire et Aperçu) :
// une ligne = clé à gauche, valeur à droite, aussi large que possible,
// rendu façon Obsidian. Mêmes données que PropertiesPanel.tsx via
// lib/usePropertyValues.ts.
//
// Invariants du fichier :
//   • Pas d'icône par ligne, pas de sélecteur de type visible : le TYPE se
//     gère uniquement dans Paramètres → Gestion des propriétés.
//   • Le nom de la clé reste cliquable pour le renommer (migration
//     globale via usePropertyDefinitions.update) ; la valeur utilise le
//     widget dédié PropertyValueField.
//   • SOURCE DE VÉRITÉ = le frontmatter : toutes les clés du YAML
//     s'affichent, enregistrées au schéma ou non ; une clé inconnue reçoit
//     une définition de repli texte générique. created/modified sont
//     matérialisées à la sauvegarde (NotesScreen.tsx) et restent en
//     lecture seule.
//   • Le bloc fait partie du SCROLL de la note (pas de carte fixe en haut)
//     et se replie via son en-tête.
//
// SOMMAIRE :
//   1. Les helpers de formatage (horodatage, date système)
//   2. PropertiesBlock — le bloc repliable clé/valeur
//   3. Les styles
//
//////////////////////////////////////////////////////////////////////////////

//////// 1. Les helpers de formatage (horodatage, date système) ///////////////////////////
function formatTimestamp(value: number): string {
  return new Date(value).toLocaleString('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatSystemDate(value: unknown): string {
  if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) {
    return formatTimestamp(Date.parse(value));
  }
  if (value === undefined || value === null || value === '') return '—';
  return String(value);
}

type Props = {
  theme: Theme;
  activeNote: VaultEntry;
  content: string;
  onChangeContent: (text: string) => void;
  tree: VaultTreeNode[];
  interactive?: boolean;
};

//////// 2. PropertiesBlock — le bloc repliable clé/valeur ////////////////////////////////

export function PropertiesBlock({ theme, activeNote, content, onChangeContent, tree, interactive = false }: Props) {
  const { definitions, update, create } = usePropertyDefinitions();
  const { lines, availableToAdd, setValue, addValue, removeValue } = usePropertyValues(
    content,
    onChangeContent,
    definitions,
  );
  const [collapsed, setCollapsed] = useState(false);

  void interactive;

  const fallbackDefinition = (line: PropertyLine): PropertyDefinition =>
    line.definition ?? makePropertyDefinition(`raw-${line.name}`, line.name, 'text');

  return (
    <View style={[styles.card, { borderColor: theme.border }]}>
      <Pressable style={styles.titleRow} onPress={() => setCollapsed((v) => !v)}>
        <Text style={[styles.title, { color: theme.textMuted }]}>Propriétés</Text>
        <Text style={{ color: theme.textMuted, fontSize: 11 }}>{collapsed ? '▸' : '▾'}</Text>
      </Pressable>

      {!collapsed && (
        <View>
          {lines.map((line) => (
            <View
              key={line.name}
              style={[styles.row, { borderBottomColor: `${theme.border}88` }]}
            >
              {line.isSystemDate ? (
                <Text style={[styles.key, { color: theme.textMuted }]} numberOfLines={1}>
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
                  style={[styles.keyInput, { color: theme.textMuted }]}
                />
              ) : (
                <Text style={[styles.key, { color: theme.textMuted }]} numberOfLines={1}>
                  {line.name}
                </Text>
              )}
              {line.isSystemDate ? (
                <Text style={[styles.value, { color: theme.textMuted }]} numberOfLines={1}>
                  {formatSystemDate(line.value)}
                </Text>
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
              await create(name, type, type === 'options' || type === 'multi-options' ? [] : undefined);
              addValue(makePropertyDefinition(`new-${name}`, name, type));
            }}
            theme={theme}
          />
        </View>
      )}
    </View>
  );
}

//////// 3. Les styles ////////////////////////////////////////////////////////////////////

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
    zIndex: 1,
    gap: 0,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 8,
  },
  title: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  // Style Obsidian : clé à gauche largeur fixe, valeur flex — chaque ligne
  // séparée par un filet discret (dernière ligne sans bordure).
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  key: {
    width: 100,
    fontSize: 13,
  },
  keyInput: {
    width: 100,
    fontSize: 13,
    paddingVertical: 2,
    paddingHorizontal: 0,
  },
  value: {
    flex: 1,
    fontSize: 13,
  },
  rowRemove: {
    paddingHorizontal: 4,
    fontSize: 12,
  },
});
