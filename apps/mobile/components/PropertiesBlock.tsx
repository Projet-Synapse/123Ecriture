import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { parseFrontmatter } from '../lib/frontmatter';
import { usePropertyDefinitions } from '../lib/usePropertyDefinitions';
import { usePropertyValues } from '../lib/usePropertyValues';
import { TYPE_ICONS } from '../lib/propertyTypes';
import type { Theme } from '../theme';
import { AddPropertyButton } from './AddPropertyButton';
import { DraftTextField } from './DraftTextField';
import { PropertyValueField } from './PropertyValueField';

// Bloc "Propriétés" affiché en haut/au fil de la note en mode Intermédiaire
// et Aperçu (voir NotesScreen.tsx — pas en mode Source, où le YAML brut du
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
  const { definitions, update } = usePropertyDefinitions();
  const { data, definitionsUsedOnNote, availableToAdd, setValue, addValue, removeValue } = usePropertyValues(
    content,
    onChangeContent,
    definitions,
  );
  // Repliable — voir NotesScreen.tsx : en mode Intermédiaire, cette carte
  // reste fixe au-dessus de CodeMirror (qui gère son propre scroll interne,
  // impossible à imbriquer ici sans risquer de casser l'éditeur, voir les
  // "écarts pragmatiques" de docs/ARCHITECTURE.md sur ce composant) — le
  // repli permet au moins de lui rendre de la place pendant la frappe sans
  // avoir à toucher au modèle de scroll de CodeMirror.
  const [collapsed, setCollapsed] = useState(false);

  const createdRaw = parseFrontmatter(content).data.created;
  const createdLabel =
    typeof createdRaw === 'string' && !Number.isNaN(Date.parse(createdRaw))
      ? formatTimestamp(Date.parse(createdRaw))
      : '—';

  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <Pressable style={styles.titleRow} onPress={() => setCollapsed((v) => !v)}>
        <Text style={[styles.title, { color: theme.textMuted }]}>Propriétés</Text>
        <Text style={{ color: theme.textMuted, fontSize: 11 }}>{collapsed ? '▸' : '▾'}</Text>
      </Pressable>

      {!collapsed && (
        <>
          <View style={styles.row}>
            <Text style={{ fontSize: 12 }}>➕</Text>
            <Text style={[styles.label, { color: theme.textMuted }]}>Créé</Text>
            <Text style={[styles.readonlyValue, { color: theme.text }]}>{createdLabel}</Text>
          </View>
          <View style={styles.row}>
            <Text style={{ fontSize: 12 }}>✏️</Text>
            <Text style={[styles.label, { color: theme.textMuted }]}>Modifié</Text>
            <Text style={[styles.readonlyValue, { color: theme.text }]}>
              {formatTimestamp(activeNote.modifiedAt)}
            </Text>
          </View>

          {definitionsUsedOnNote.map((def) => (
            <View key={def.id} style={styles.row}>
              <Text style={{ fontSize: 12 }}>{TYPE_ICONS[def.type]}</Text>
              {/* Renomme la propriété dans le SCHÉMA global (voir Paramètres →
                  Gestion des propriétés) — se répercute donc partout où elle
                  est utilisée, pas seulement sur cette note (voir le commentaire
                  d'en-tête d'apps/desktop/electron/properties.ts : la valeur déjà
                  écrite dans le frontmatter de chaque note garde l'ANCIEN nom de
                  clé tant que la note elle-même n'est pas réécrite — renommer ici
                  ne migre donc pas silencieusement le contenu déjà sur disque). */}
              <DraftTextField
                initialValue={def.name}
                onCommit={(value) => {
                  const trimmed = value.trim();
                  if (trimmed && trimmed !== def.name) void update(def.id, { name: trimmed });
                }}
                theme={theme}
                style={[styles.labelInput, { color: theme.textMuted }]}
              />
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
    // Espace sous la carte AVANT la barre d'outils de l'éditeur (voir
    // NotesScreen.tsx, `<EditorToolbar>` juste après ce composant) —
    // sans ça le bouton "+" (et son popover d'ajout, qui s'ouvre vers le
    // bas) touchait/chevauchait visuellement la barre d'outils juste en
    // dessous (bug rapporté).
    marginBottom: 12,
    // Nécessaire pour que le popover du bouton "+" (position: 'absolute',
    // voir AddPropertyButton.tsx) puisse s'étendre au-delà du bord bas de
    // cette carte sans être rogné par elle.
    zIndex: 1,
    gap: 8,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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
  labelInput: {
    width: 90,
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
