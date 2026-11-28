import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { ColorField } from '../properties/ColorField';
import {
  GRAPH_GROUP_COLORS,
  MAX_GRAPH_GROUPS,
  createGraphGroup,
  moveGraphGroup,
  type GraphGroup,
} from '../../lib/graph/graphGroups';
import type { Theme } from '../../theme';

// ✒️ 123ECRITURE — components/editors/GraphGroupsEditor.tsx — section « Groupes » de la vue graphique
//////////////////////////////////////////////////////////////////////////////
//
// Comme le panneau de réglages du graphe d'Obsidian : une ligne par groupe
// (champ de requête, pastille de couleur → roue des couleurs, ✕ pour
// supprimer) et un bouton « Nouveau groupe ». Des flèches ▲▼ changent la
// priorité (le premier groupe qui correspond gagne).
//
// Invariants du fichier :
//   • Le champ de requête garde SON texte en local et ne le propage qu'après
//     une pause de frappe (350 ms) ou à la sortie du champ : chaque
//     propagation écrit les préférences (et les répliquent dans le coffre) et
//     ré-évalue le groupe — pas à chaque touche.
//   • Le texte local n'est écrasé par la valeur reçue que si elle vient
//     d'AILLEURS (synchro, autre appareil), jamais par l'écho de sa propre
//     propagation (sinon la frappe en cours serait rognée).
//
//////////////////////////////////////////////////////////////////////////////

const COMMIT_DELAY_MS = 350;

function GroupRow({
  group,
  index,
  total,
  count,
  theme,
  onChange,
  onRemove,
  onMove,
}: {
  group: GraphGroup;
  index: number;
  total: number;
  count: number;
  theme: Theme;
  onChange: (patch: Partial<Pick<GraphGroup, 'query' | 'color'>>) => void;
  onRemove: () => void;
  onMove: (delta: number) => void;
}) {
  const [draft, setDraft] = useState(group.query);
  const committed = useRef(group.query);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Le minuteur peut partir d'un rendu ancien : il passe par la DERNIÈRE
  // fonction reçue, sinon il écraserait un changement de couleur fait entre-temps.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  useEffect(() => {
    if (group.query !== committed.current) {
      committed.current = group.query;
      setDraft(group.query);
    }
  }, [group.query]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const commit = (text: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (text === committed.current) return;
    committed.current = text;
    onChangeRef.current({ query: text });
  };

  return (
    <View style={{ gap: 4 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <TextInput
          value={draft}
          onChangeText={(text) => {
            setDraft(text);
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(() => commit(text), COMMIT_DELAY_MS);
          }}
          onBlur={() => commit(draft)}
          placeholder="Entrer une requête…"
          placeholderTextColor={theme.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel={`Requête du groupe ${index + 1}`}
          style={[styles.input, { color: theme.text, borderColor: theme.border }]}
        />
        <ColorField
          compact
          label={`Couleur du groupe ${index + 1}`}
          value={group.color}
          presets={GRAPH_GROUP_COLORS}
          onValueChange={(hex) => onChange({ color: hex })}
          theme={theme}
        />
        <Pressable
          onPress={onRemove}
          accessibilityRole="button"
          accessibilityLabel={`Supprimer le groupe ${index + 1}`}
          hitSlop={6}
          style={styles.iconButton}
        >
          <Text style={{ color: theme.textMuted, fontSize: 14 }}>✕</Text>
        </Pressable>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 2 }}>
        <Pressable
          onPress={() => onMove(-1)}
          disabled={index === 0}
          accessibilityRole="button"
          accessibilityLabel={`Remonter le groupe ${index + 1}`}
          hitSlop={6}
          style={{ opacity: index === 0 ? 0.3 : 1 }}
        >
          <Text style={{ color: theme.textMuted, fontSize: 12 }}>▲</Text>
        </Pressable>
        <Pressable
          onPress={() => onMove(1)}
          disabled={index === total - 1}
          accessibilityRole="button"
          accessibilityLabel={`Descendre le groupe ${index + 1}`}
          hitSlop={6}
          style={{ opacity: index === total - 1 ? 0.3 : 1 }}
        >
          <Text style={{ color: theme.textMuted, fontSize: 12 }}>▼</Text>
        </Pressable>
        <Text style={{ color: theme.textMuted, fontSize: 11 }}>
          {group.query.trim() ? `${count} fichier${count > 1 ? 's' : ''}` : 'requête vide'}
        </Text>
      </View>
    </View>
  );
}

export function GraphGroupsEditor({
  groups,
  counts,
  onChange,
  theme,
}: {
  groups: GraphGroup[];
  // Nœuds dont le groupe de même rang est le premier gagnant.
  counts: number[];
  onChange: (groups: GraphGroup[]) => void;
  theme: Theme;
}) {
  return (
    <View style={{ gap: 10 }}>
      <Text style={{ color: theme.text, fontSize: 13, fontWeight: '600' }}>Groupes</Text>
      {groups.length === 0 && (
        <Text style={{ color: theme.textMuted, fontSize: 12 }}>
          Colore les fichiers qui correspondent à une requête (path:, file:, tag:, [propriété]…). Le premier groupe qui correspond l’emporte.
        </Text>
      )}
      {groups.map((group, index) => (
        <GroupRow
          key={group.id}
          group={group}
          index={index}
          total={groups.length}
          count={counts[index] ?? 0}
          theme={theme}
          onChange={(patch) => onChange(groups.map((g) => (g.id === group.id ? { ...g, ...patch } : g)))}
          onRemove={() => onChange(groups.filter((g) => g.id !== group.id))}
          onMove={(delta) => onChange(moveGraphGroup(groups, index, delta))}
        />
      ))}
      <Pressable
        onPress={() => onChange([...groups, createGraphGroup(groups)])}
        disabled={groups.length >= MAX_GRAPH_GROUPS}
        accessibilityRole="button"
        style={[styles.addButton, { backgroundColor: theme.accent, opacity: groups.length >= MAX_GRAPH_GROUPS ? 0.5 : 1 }]}
      >
        <Text style={{ color: '#ffffff', fontSize: 13, fontWeight: '600' }}>Nouveau groupe</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  input: {
    flex: 1,
    minWidth: 0,
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    fontSize: 13,
  },
  iconButton: {
    width: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addButton: {
    alignSelf: 'flex-start',
    borderRadius: 8,
    paddingVertical: 7,
    paddingHorizontal: 14,
  },
});
