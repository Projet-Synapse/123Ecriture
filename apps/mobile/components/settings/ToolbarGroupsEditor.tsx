import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { ToolbarActionId } from '../../lib/notesToolbarActions';
import type { Theme } from '../../theme';
import { settingsStyles as s } from './settingsStyles';

// Éditeur des GROUPES de la barre d'outils Notes (v0.4.43, demande
// 2026-10-05) — remplace la liste plate pour la carte Notes : les groupes
// sont des conteneurs créés avec « + Nouveau groupe », nommables, réglables
// dépliants ou non, et les boutons s'y DÉPLACENT par glisser-déposer.
// PC/web : HTML5 draggable (même échappatoire que l'arborescence).
// Tactile : appui sur un bouton = le saisir, appui sur une destination = le
// déposer (le glisser continu tactile viendra avec le chantier DnD natif).
// Un bouton hors groupe = masqué de la barre, proposé dans la réserve en bas
// (choix façon Obsidian, validé 2026-10-05).



type Props = {
  groups: NotesToolbarGroup[];
  descriptions: Record<string, string>;
  onChange: (groups: NotesToolbarGroup[]) => void;
  theme: Theme;
};

export function ToolbarGroupsEditor({ groups, descriptions, onChange, theme }: Props) {
  const [picking, setPicking] = useState<string | null>(null); // bouton saisi (tactile)
  const [dragOver, setDragOver] = useState<string | null>(null); // cible de dépôt

  const label = (id: string) => descriptions[id] ?? id;

  const setGroup = (groupId: string, patch: Partial<NotesToolbarGroup>) =>
    onChange(groups.map((g) => (g.id === groupId ? { ...g, ...patch } : g)));

  const addButton = (groupId: string, buttonId: string, index?: number) =>
    onChange(
      groups.map((g) => {
        if (g.id !== groupId) return { ...g, buttons: g.buttons.filter((b: string) => b !== buttonId) };
        const buttons = g.buttons.filter((b: string) => b !== buttonId);
        buttons.splice(index ?? buttons.length, 0, buttonId as ToolbarActionId);
        return { ...g, buttons };
      }),
    );

  const dropButton = (groupId: string, buttonId: ToolbarActionId) => {
    onChange(
      groups.map((g) =>
        g.id === groupId ? { ...g, buttons: [...g.buttons.filter((b) => b !== buttonId), buttonId] } : g,
      ),
    );
    setPicking(null);
  };

  const addGroup = () => {
    const id = `groupe-${Date.now()}`;
    onChange([...groups, { id, label: `Groupe ${groups.length + 1}`, collapsible: false, buttons: [] }]);
  };

  const deleteGroup = (groupId: string) => onChange(groups.filter((g) => g.id !== groupId));

  // Dépose un bouton saisi (tactile) dans un groupe
  const dropPicked = (groupId: string, index?: number) => {
    if (!picking) return;
    addButton(groupId, picking as ToolbarActionId, index);
    setPicking(null);
  };

  const chip = (buttonId: string, fromGroup: string | null, index?: number) => {
    const isPicked = picking === buttonId;
    return (
      <Pressable
        key={buttonId + String(index ?? '')}
        onPress={() => {
          // Tactile : 1er appui saisit, 2e appui sur une destination dépose
          if (picking === buttonId) setPicking(null);
          else setPicking(buttonId);
        }}
        // Web : HTML5 drag & drop
        // @ts-expect-error -- `draggable` est transmis tel quel jusqu'au DOM
        // par react-native-web (voir VaultTreeView.tsx), absent des types RN.
        draggable
        onDragStart={(event: { dataTransfer: { setData: (t: string, v: string) => void } }) => {
          const payload = JSON.stringify({ buttonId, fromGroup });
          (event as unknown as { dataTransfer: { setData: (t: string, v: string) => void; effectAllowed: string } }).dataTransfer.setData(
            'text/plain',
            payload,
          );
          (event as unknown as { dataTransfer: { effectAllowed: string } }).dataTransfer.effectAllowed = 'move';
        }}
        style={[
          styles.chip,
          { borderColor: theme.border },
          isPicked && { backgroundColor: `${theme.accent}33`, borderColor: theme.accent },
        ]}
      >
        <Text style={{ color: theme.text, fontSize: 12 }}>
          {label(buttonId)}
          {fromGroup ? '' : ' ·'}
        </Text>
      </Pressable>
    );
  };

  return (
    <View style={s.toolbarList}>
      {groups.map((group) => (
        <View
          key={group.id}
          style={[
            styles.groupCard,
            { borderColor: dragOver === group.id ? theme.accent : theme.border },
          ]}
          // Web : dépôt HTML5 (le dragStart des chips porte l'identité)
          // @ts-expect-error props web-only transmis au DOM par rn-web
          onDragOver={(event: { preventDefault: () => void; dataTransfer: { getData: (t: string) => string } }) => {
            event.preventDefault();
            setDragOver(group.id);
          }}
          onDragLeave={() => setDragOver((current) => (current === group.id ? null : current))}
          onDrop={(event: { preventDefault: () => void; dataTransfer: { getData: (t: string) => string } }) => {
            event.preventDefault();
            setDragOver(null);
            try {
              const payload = JSON.parse(event.dataTransfer.getData('text/plain')) as { buttonId: string };
              addButton(group.id, payload.buttonId as ToolbarActionId);
            } catch {
              // dépôt hors protocole : ignoré
            }
          }}
        >
          <View style={styles.groupHeader}>
            <TextInput
              value={group.label}
              onChangeText={(text) => setGroup(group.id, { label: text })}
              style={[styles.groupName, { color: theme.text, borderColor: theme.border }]}
            />
            <Pressable
              onPress={() => setGroup(group.id, { collapsible: !group.collapsible })}
              style={[styles.groupToggle, { borderColor: theme.border }, group.collapsible && { backgroundColor: theme.accent }]}
              accessibilityLabel={group.collapsible ? 'Groupe dépliant' : 'Groupe déplié'}
            >
              <Text style={{ color: group.collapsible ? '#fff' : theme.text, fontSize: 11 }}>
                {group.collapsible ? 'dépliant' : 'ouvert'}
              </Text>
            </Pressable>
            <Pressable onPress={() => deleteGroup(group.id)} accessibilityLabel="Supprimer le groupe">
              <Text style={{ color: theme.danger }}>✕</Text>
            </Pressable>
          </View>
          <View style={styles.chipRow}>
            {group.buttons.map((buttonId: string, index: number) => (
              <View key={buttonId} style={styles.chipWrap}>
                {picking && picking !== buttonId && (
                  <Pressable
                    accessibilityLabel={`Déposer ${label(picking)} avant ${label(buttonId)}`}
                    onPress={() => dropPicked(group.id, index)}
                    style={styles.dropSlot}
                  >
                    <Text style={{ color: theme.textMuted, fontSize: 10 }}>⤶</Text>
                  </Pressable>
                )}
                {chip(buttonId, group.id, index)}
              </View>
            ))}
            {picking && (
              <Pressable onPress={() => dropPicked(group.id)} style={styles.dropSlot}>
                <Text style={{ color: theme.textMuted, fontSize: 10 }}>ici ⤓</Text>
              </Pressable>
            )}
            {group.buttons.length === 0 && !picking && (
              <Text style={{ color: theme.textMuted, fontSize: 12 }}>Groupe vide — glisse des boutons ici.</Text>
            )}
          </View>
          {picking && !group.buttons.includes(picking as ToolbarActionId) && (
            <Pressable onPress={() => dropButton(group.id, picking as ToolbarActionId)} accessibilityLabel={`Déposer ${label(picking)} dans ${group.label}`}>
              <Text style={{ color: theme.accent, fontSize: 12 }}>+ déposer « {label(picking)} » dans {group.label}</Text>
            </Pressable>
          )}
        </View>
      ))}

      <Pressable onPress={addGroup} style={[styles.addGroupButton, { borderColor: theme.border }]}>
        <Text style={{ color: theme.accent, fontWeight: '600' }}>+ Nouveau groupe</Text>
      </Pressable>

      <Text style={{ color: theme.textMuted, fontSize: 12, marginTop: 4 }}>Boutons disponibles (hors barre)</Text>
      <View style={styles.chipRow}>
        {(() => {
          const placed = new Set(groups.flatMap((g) => g.buttons));
          const all = Object.keys(descriptions);
          const pool = all.filter((id) => !placed.has(id as ToolbarActionId));
          if (pool.length === 0) return <Text style={{ color: theme.textMuted, fontSize: 12 }}>Tous les boutons sont placés.</Text>;
          return pool.map((buttonId) => chip(buttonId as ToolbarActionId, null));
        })()}
      </View>
      {picking && (
        <Text style={{ color: theme.textMuted, fontSize: 12 }}>
          « {label(picking)} » saisi — touche un groupe (ou un emplacement) pour le déposer ; retouche-le pour annuler.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  groupCard: { borderWidth: 1, borderRadius: 10, padding: 10, gap: 8 },
  groupHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  groupName: { flex: 1, borderWidth: 1, borderRadius: 6, paddingVertical: 4, paddingHorizontal: 8, fontSize: 13 },
  groupToggle: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chipWrap: { flexDirection: 'row', alignItems: 'center' },
  chip: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  dropSlot: { borderWidth: 1, borderStyle: 'dashed', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 4 },
  addGroupButton: { borderWidth: 1, borderRadius: 8, paddingVertical: 8, alignItems: 'center' },
});
