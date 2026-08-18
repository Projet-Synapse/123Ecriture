import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { parseFrontmatter, serializeFrontmatter, type FrontmatterData } from '../lib/frontmatter';
import type { Theme } from '../theme';
import { DraftTextField } from './DraftTextField';

// Onglet "Propriétés" de la barre latérale (voir RightSidebar.tsx,
// NotesScreen.tsx) — deux sections : les VALEURS de la note actuellement
// ouverte (lues/écrites dans son frontmatter, voir lib/frontmatter.ts) et
// la GESTION du schéma global (créer/renommer/changer de type/supprimer une
// propriété, `.123ecriture/properties.json` via apps/desktop/electron/
// properties.js). Renommer/changer le type/supprimer une définition ne
// touche QUE le schéma, jamais les valeurs déjà écrites dans les notes
// (voir le commentaire d'en-tête de properties.js).
const TYPE_LABELS: Record<PropertyType, string> = {
  text: 'Texte',
  list: 'Liste',
  number: 'Nombre',
  checkbox: 'Case à cocher',
  date: 'Date',
  datetime: 'Date et heure',
};

const TYPE_ORDER: PropertyType[] = ['text', 'list', 'number', 'checkbox', 'date', 'datetime'];

function defaultValueForType(type: PropertyType): unknown {
  if (type === 'checkbox') return false;
  if (type === 'number') return 0;
  if (type === 'list') return [];
  return '';
}

function formatValueForInput(type: PropertyType, value: unknown): string {
  if (type === 'list') return Array.isArray(value) ? value.join(', ') : String(value ?? '');
  if (value === null || value === undefined) return '';
  return String(value);
}

function parseInputForType(type: PropertyType, text: string): unknown {
  if (type === 'number') {
    const parsed = Number(text.trim());
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (type === 'list') {
    return text
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }
  return text;
}

type Props = {
  theme: Theme;
  activeNote: VaultEntry | null;
  content: string;
  onChangeContent: (text: string) => void;
};

export function PropertiesPanel({ theme, activeNote, content, onChangeContent }: Props) {
  const propertiesBridge = typeof window !== 'undefined' ? window.properties : undefined;
  const contextMenuBridge = typeof window !== 'undefined' ? window.contextMenu : undefined;

  const [definitions, setDefinitions] = useState<PropertyDefinition[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<PropertyType>('text');

  const refresh = useCallback(async () => {
    if (!propertiesBridge) return;
    setDefinitions(await propertiesBridge.list());
  }, [propertiesBridge]);

  useEffect(() => {
    void (async () => {
      try {
        await refresh();
      } catch (err) {
        console.error('[properties] échec du chargement initial :', err);
      }
    })();
  }, [refresh]);

  const runAction = useCallback(async (action: () => Promise<PropertyDefinition[]>) => {
    setError(null);
    try {
      setDefinitions(await action());
    } catch (err) {
      console.error('[properties] échec :', err);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const { data, body } = useMemo(() => parseFrontmatter(content), [content]);

  const commitData = useCallback(
    (nextData: FrontmatterData) => {
      onChangeContent(serializeFrontmatter(nextData, body));
    },
    [onChangeContent, body],
  );

  const usedNames = useMemo(() => new Set(Object.keys(data)), [data]);
  const availableToAdd = definitions.filter((def) => !usedNames.has(def.name));

  const showAddValuePicker = useCallback(() => {
    if (!contextMenuBridge || availableToAdd.length === 0) return;
    void contextMenuBridge.show(availableToAdd.map((def) => ({ id: def.id, label: def.name }))).then((id) => {
      const def = availableToAdd.find((d) => d.id === id);
      if (!def) return;
      commitData({ ...data, [def.name]: defaultValueForType(def.type) });
    });
  }, [contextMenuBridge, availableToAdd, data, commitData]);

  const removeValue = useCallback(
    (name: string) => {
      const next = { ...data };
      delete next[name];
      commitData(next);
    },
    [data, commitData],
  );

  const showTypePicker = useCallback(
    (onSelect: (type: PropertyType) => void) => {
      if (!contextMenuBridge) return;
      void contextMenuBridge
        .show(TYPE_ORDER.map((type) => ({ id: type, label: TYPE_LABELS[type] })))
        .then((choice) => {
          if (choice) onSelect(choice as PropertyType);
        });
    },
    [contextMenuBridge],
  );

  const submitCreateProperty = useCallback(async () => {
    const name = newName.trim();
    if (!name || !propertiesBridge) return;
    setNewName('');
    await runAction(() => propertiesBridge.create(name, newType));
  }, [newName, newType, propertiesBridge, runAction]);

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
  const definitionsUsedOnNote = definitions.filter((def) => usedNames.has(def.name));

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={[styles.sectionTitle, { color: theme.text }]}>Propriétés de cette note</Text>
      {!isMarkdownNote ? (
        <Text style={[styles.muted, { color: theme.textMuted }]}>
          Seules les notes (pas les canvas/graphiques) ont des propriétés.
        </Text>
      ) : (
        <>
          {definitionsUsedOnNote.length === 0 && (
            <Text style={[styles.muted, { color: theme.textMuted }]}>Aucune propriété sur cette note.</Text>
          )}
          {definitionsUsedOnNote.map((def) => (
            <View key={def.id} style={styles.valueRow}>
              <Text style={[styles.valueLabel, { color: theme.textMuted }]} numberOfLines={1}>
                {def.name}
              </Text>
              {def.type === 'checkbox' ? (
                <Pressable
                  onPress={() => commitData({ ...data, [def.name]: !data[def.name] })}
                  style={[styles.checkbox, { borderColor: theme.border }]}
                >
                  <Text style={{ color: theme.accent }}>{data[def.name] ? '☑' : '☐'}</Text>
                </Pressable>
              ) : (
                <DraftTextField
                  initialValue={formatValueForInput(def.type, data[def.name])}
                  onCommit={(text) => commitData({ ...data, [def.name]: parseInputForType(def.type, text) })}
                  placeholder={
                    def.type === 'date' ? 'AAAA-MM-JJ' : def.type === 'datetime' ? 'AAAA-MM-JJ HH:MM' : ''
                  }
                  theme={theme}
                  style={[styles.valueInput, { color: theme.text, borderColor: theme.border }]}
                />
              )}
              <Pressable onPress={() => removeValue(def.name)} style={styles.rowRemove}>
                <Text style={{ color: theme.textMuted }}>✕</Text>
              </Pressable>
            </View>
          ))}
          {availableToAdd.length > 0 && (
            <Pressable onPress={showAddValuePicker} style={styles.addButton}>
              <Text style={{ color: theme.accent, fontSize: 12 }}>+ Ajouter une propriété</Text>
            </Pressable>
          )}
        </>
      )}

      <View style={[styles.divider, { backgroundColor: theme.border }]} />

      <Text style={[styles.sectionTitle, { color: theme.text }]}>Gérer les propriétés</Text>
      {error && <Text style={styles.error}>⚠️ {error}</Text>}
      {definitions.length === 0 && (
        <Text style={[styles.muted, { color: theme.textMuted }]}>Aucune propriété définie pour l’instant.</Text>
      )}
      {definitions.map((def) => (
        <View key={def.id} style={styles.defRow}>
          <DraftTextField
            initialValue={def.name}
            onCommit={(value) => {
              const trimmed = value.trim();
              if (trimmed) void runAction(() => propertiesBridge.update(def.id, { name: trimmed }));
            }}
            theme={theme}
            style={[styles.defNameInput, { color: theme.text, borderColor: theme.border }]}
          />
          <Pressable
            onPress={() => showTypePicker((type) => void runAction(() => propertiesBridge.update(def.id, { type })))}
            style={[styles.typeChip, { borderColor: theme.border }]}
          >
            <Text style={{ color: theme.textMuted, fontSize: 11 }}>{TYPE_LABELS[def.type]}</Text>
          </Pressable>
          <Pressable onPress={() => void runAction(() => propertiesBridge.remove(def.id))} style={styles.rowRemove}>
            <Text style={{ color: theme.textMuted }}>🗑️</Text>
          </Pressable>
        </View>
      ))}

      <View style={styles.createRow}>
        <TextInput
          value={newName}
          onChangeText={setNewName}
          onSubmitEditing={() => void submitCreateProperty()}
          placeholder="Nouvelle propriété…"
          placeholderTextColor={theme.textMuted}
          style={[styles.createInput, { color: theme.text, borderColor: theme.border }]}
        />
        <Pressable onPress={() => showTypePicker(setNewType)} style={[styles.typeChip, { borderColor: theme.border }]}>
          <Text style={{ color: theme.textMuted, fontSize: 11 }}>{TYPE_LABELS[newType]}</Text>
        </Pressable>
        <Pressable
          onPress={() => void submitCreateProperty()}
          style={[styles.createButton, { backgroundColor: theme.accent }]}
        >
          <Text style={styles.createButtonText}>Créer</Text>
        </Pressable>
      </View>
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
  error: {
    color: '#dc2626',
    fontSize: 12,
  },
  divider: {
    height: 1,
    marginVertical: 8,
  },
  valueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  valueLabel: {
    width: 80,
    fontSize: 12,
  },
  valueInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 6,
    paddingVertical: 4,
    paddingHorizontal: 6,
    fontSize: 12,
  },
  checkbox: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 6,
    paddingVertical: 4,
    alignItems: 'center',
  },
  rowRemove: {
    paddingHorizontal: 4,
  },
  addButton: {
    paddingVertical: 4,
  },
  defRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  defNameInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 6,
    paddingVertical: 4,
    paddingHorizontal: 6,
    fontSize: 12,
  },
  typeChip: {
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  createRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  createInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 6,
    paddingVertical: 4,
    paddingHorizontal: 6,
    fontSize: 12,
  },
  createButton: {
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  createButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
});
