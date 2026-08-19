import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { collectPathOptions } from '../lib/vaultTree';
import { formatValueForInput, parseInputForType } from '../lib/propertyTypes';
import type { Theme } from '../theme';
import { DraftTextField } from './DraftTextField';

// Éditeur de VALEUR pour une propriété, un widget par type — remplace
// l'ancien champ texte unique partagé par tous les types (voir capture de
// référence .claude/References/image-4.png : chaque type a son propre
// contrôle, pas une simple édition de texte). Partagé par
// PropertiesPanel.tsx (barre latérale) et PropertiesBlock.tsx (bloc en haut
// de note).
type Props = {
  def: PropertyDefinition;
  value: unknown;
  onChange: (value: unknown) => void;
  theme: Theme;
  // Nécessaire uniquement pour le type 'path' (navigation dans le vault) —
  // absent ailleurs, le champ retombe alors sur une saisie texte libre.
  tree?: VaultTreeNode[];
};

export function PropertyValueField({ def, value, onChange, theme, tree }: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [filter, setFilter] = useState('');
  // Calculé pour tous les types (pas seulement 'path') afin de garder un
  // nombre de hooks constant d'un rendu à l'autre — un `useMemo` posé après
  // un `return` conditionnel enfreindrait les Rules of Hooks dès qu'une
  // même instance change de `def.type`.
  const pathOptions = useMemo(() => (tree ? collectPathOptions(tree) : []), [tree]);

  if (def.type === 'checkbox') {
    return (
      <Pressable onPress={() => onChange(!value)} style={[styles.checkbox, { borderColor: theme.border }]}>
        <Text style={{ color: theme.accent }}>{value ? '☑' : '☐'}</Text>
      </Pressable>
    );
  }

  if (def.type === 'path') {
    const filtered = pathOptions.filter(
      (o) => filter.trim() === '' || o.relPath.toLowerCase().includes(filter.trim().toLowerCase()),
    );
    return (
      <View style={styles.pickerWrap}>
        <Pressable
          onPress={() => setPickerOpen((v) => !v)}
          style={[styles.pathButton, { borderColor: theme.border }]}
        >
          <Text style={{ color: value ? theme.text : theme.textMuted, fontSize: 12 }} numberOfLines={1}>
            {typeof value === 'string' && value ? value : 'Choisir un chemin…'}
          </Text>
        </Pressable>
        {pickerOpen && (
          <View style={[styles.popover, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <TextInput
              value={filter}
              onChangeText={setFilter}
              placeholder="Filtrer…"
              placeholderTextColor={theme.textMuted}
              style={[styles.filterInput, { color: theme.text, borderColor: theme.border }]}
              autoFocus
            />
            <View style={styles.popoverList}>
              {value ? (
                <Pressable
                  onPress={() => {
                    onChange('');
                    setPickerOpen(false);
                  }}
                  style={styles.popoverRow}
                >
                  <Text style={{ color: theme.textMuted, fontSize: 12 }}>✕ Effacer</Text>
                </Pressable>
              ) : null}
              {filtered.map((option) => (
                <Pressable
                  key={option.relPath}
                  onPress={() => {
                    onChange(option.relPath);
                    setPickerOpen(false);
                    setFilter('');
                  }}
                  style={[styles.popoverRow, { paddingLeft: 8 + option.depth * 12 }]}
                >
                  <Text style={{ color: theme.text, fontSize: 12 }} numberOfLines={1}>
                    {option.kind === 'folder' ? '📁' : '📄'} {option.label}
                  </Text>
                </Pressable>
              ))}
              {filtered.length === 0 && (
                <Text style={[styles.muted, { color: theme.textMuted }]}>Aucun résultat.</Text>
              )}
            </View>
          </View>
        )}
      </View>
    );
  }

  if (def.type === 'options') {
    const options = def.options ?? [];
    return (
      <View style={styles.pickerWrap}>
        <Pressable
          onPress={() => setPickerOpen((v) => !v)}
          style={[styles.pathButton, { borderColor: theme.border }]}
        >
          <Text style={{ color: value ? theme.text : theme.textMuted, fontSize: 12 }} numberOfLines={1}>
            {typeof value === 'string' && value ? value : 'Choisir une option…'}
          </Text>
        </Pressable>
        {pickerOpen && (
          <View style={[styles.popover, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <View style={styles.popoverList}>
              {value ? (
                <Pressable
                  onPress={() => {
                    onChange('');
                    setPickerOpen(false);
                  }}
                  style={styles.popoverRow}
                >
                  <Text style={{ color: theme.textMuted, fontSize: 12 }}>✕ Aucune</Text>
                </Pressable>
              ) : null}
              {options.map((option) => (
                <Pressable
                  key={option}
                  onPress={() => {
                    onChange(option);
                    setPickerOpen(false);
                  }}
                  style={styles.popoverRow}
                >
                  <Text style={{ color: theme.text, fontSize: 12 }}>{option}</Text>
                </Pressable>
              ))}
              {options.length === 0 && (
                <Text style={[styles.muted, { color: theme.textMuted }]}>
                  Aucune option configurée (Paramètres → Gestion des propriétés).
                </Text>
              )}
            </View>
          </View>
        )}
      </View>
    );
  }

  return (
    <DraftTextField
      initialValue={formatValueForInput(def.type, value)}
      onCommit={(text) => onChange(parseInputForType(def.type, text))}
      placeholder={def.type === 'date' ? 'AAAA-MM-JJ' : def.type === 'datetime' ? 'AAAA-MM-JJ HH:MM' : ''}
      theme={theme}
      style={[styles.valueInput, { color: theme.text, borderColor: theme.border }]}
    />
  );
}

const styles = StyleSheet.create({
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
  pickerWrap: {
    flex: 1,
    position: 'relative',
  },
  pathButton: {
    borderWidth: 1,
    borderRadius: 6,
    paddingVertical: 4,
    paddingHorizontal: 6,
  },
  popover: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    marginTop: 4,
    borderWidth: 1,
    borderRadius: 8,
    padding: 6,
    gap: 4,
    zIndex: 20,
    // Ombre légère pour se détacher visuellement du contenu en dessous
    // (le popover flotte au-dessus, pas dans le flux normal).
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  filterInput: {
    borderWidth: 1,
    borderRadius: 6,
    paddingVertical: 4,
    paddingHorizontal: 6,
    fontSize: 12,
  },
  popoverList: {
    maxHeight: 200,
  },
  popoverRow: {
    paddingVertical: 6,
    paddingHorizontal: 6,
    borderRadius: 4,
  },
  muted: {
    fontSize: 11,
    padding: 6,
  },
});
