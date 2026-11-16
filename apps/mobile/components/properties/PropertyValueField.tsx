import { useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { collectPathOptions, flattenNotes } from '../../lib/notes/vaultTree';
import { rememberPropertyValue, usePropertyValueIndex } from '../../lib/properties/propertyValueIndex';
import {
  lastListSegment,
  matchRank,
  openWikilinkQuery,
  suggestPropertyValues,
  type ValueSuggestion,
} from '../../lib/properties/propertyValueSuggestions';
import { formatValueForInput, parseInputForType } from '../../lib/properties/propertyTypes';
import { solidColor } from '../../lib/ui/popover';
import type { Theme } from '../../theme';
import { DraftTextField } from '../editors/DraftTextField';
import { SuggestTextInput } from './SuggestTextInput';

// ✒️ 123ECRITURE — components/properties/PropertyValueField.tsx — le widget d'édition d'une valeur
//////////////////////////////////////////////////////////////////////////////
//
// Éditeur de VALEUR pour une propriété, un widget par type : checkbox,
// path (navigateur de vault), multi-options, bubbles, options, et champ
// texte commité pour le reste (nombre, date…). Partagé par
// PropertiesPanel.tsx (barre latérale) et PropertiesBlock.tsx (bloc en
// haut de note).
//
// Invariants du fichier :
//   • Chaque type a son propre contrôle — jamais un simple champ texte
//     partagé par tous les types.
//   • Nombre de hooks CONSTANT d'un rendu à l'autre : pathOptions est
//     calculé pour tous les types, jamais après un return conditionnel
//     (Rules of Hooks) — une même instance peut changer de `def.type`.
//   • Le brouillon des bulles (type 'bubbles') est commité à la touche
//     Entrée, comme l'ajout de tags façon Obsidian.
//   • `tree` n'est nécessaire que pour le type 'path' : absent ailleurs,
//     le champ retombe sur une saisie texte libre. Il fournit aussi les
//     noms de notes proposés en `[[…]]`.
//   • AUTOCOMPLÉTION (Texte, Liste, Bulles) : valeurs déjà utilisées pour
//     la même propriété dans le coffre, options du schéma, notes dès `[[`
//     — voir lib/properties/propertyValueSuggestions.ts et
//     SuggestTextInput.tsx. Toute valeur validée rejoint l'index.
//
// SOMMAIRE :
//   1. PropertyValueField — le dispatch par type
//   2. Les styles
//
//////////////////////////////////////////////////////////////////////////////

//////// 1. PropertyValueField — le dispatch par type /////////////////////////////////////

// Popovers (chemin, options, multi-options) : fond PLEIN (jamais le
// `surface` translucide d'un fond d'écran) ; flottants sur desktop/web, en
// flux normal sur Android (touchers fiables au doigt).
const isNative = Platform.OS !== 'web';

type Props = {
  def: PropertyDefinition;
  value: unknown;
  onChange: (value: unknown) => void;
  theme: Theme;
  // Nécessaire uniquement pour le type 'path' (navigation dans le vault) —
  // absent ailleurs, le champ retombe alors sur une saisie texte libre.
  tree?: VaultTreeNode[];
};

export function PropertyValueField({ def, value, onChange: onChangeRaw, theme, tree }: Props) {
  const onChange = (next: unknown) => {
    rememberPropertyValue(def.name, next);
    onChangeRaw(next);
  };
  const opaqueSurface = solidColor(theme.surface, solidColor(theme.background, '#ffffff'));
  const popoverPlacement = isNative ? styles.popoverInline : styles.popoverFloating;
  const [pickerOpen, setPickerOpen] = useState(false);
  const [filter, setFilter] = useState('');
  // Brouillon du champ d'ajout des bulles (type 'bubbles') — commit à la
  // touche Entrée (onSubmitEditing), comme l'ajout de tags façon Obsidian.
  const [bubbleDraft, setBubbleDraft] = useState('');
  // Calculé pour tous les types (pas seulement 'path') afin de garder un
  // nombre de hooks constant d'un rendu à l'autre — un `useMemo` posé après
  // un `return` conditionnel enfreindrait les Rules of Hooks dès qu'une
  // même instance change de `def.type`.
  const pathOptions = useMemo(() => (tree ? collectPathOptions(tree) : []), [tree]);
  const noteNames = useMemo(() => (tree ? flattenNotes(tree).map((note) => note.name) : []), [tree]);
  const valueIndex = usePropertyValueIndex();
  const used = valueIndex?.get(def.name.toLowerCase());

  if (def.type === 'checkbox') {
    return (
      <Pressable onPress={() => onChange(!value)} style={[styles.checkbox, { borderColor: theme.border }]}>
        <Text style={{ color: theme.accent }}>{value ? '☑' : '☐'}</Text>
      </Pressable>
    );
  }

  if (def.type === 'path') {
    // Filtre insensible aux accents et aux majuscules (même règle que
    // l'autocomplétion des valeurs).
    const filtered = pathOptions.filter((o) => filter.trim() === '' || matchRank(o.relPath, filter) !== null);
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
          <View style={[styles.popover, popoverPlacement, { backgroundColor: opaqueSurface, borderColor: theme.border }]}>
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

  if (def.type === 'multi-options') {
    // Comme 'options' mais PLUSIEURS choix : chaque ligne bascule son
    // appartenance au tableau de valeurs (☑/☐), la liste reste ouverte pour
    // cumuler les sélections — fermeture explicite via « ✓ Fermer ».
    const options = def.options ?? [];
    const selected: string[] = Array.isArray(value) ? value.map(String) : [];
    return (
      <View style={styles.pickerWrap}>
        <Pressable
          onPress={() => setPickerOpen((v) => !v)}
          style={[styles.pathButton, { borderColor: theme.border }]}
        >
          <Text style={{ color: selected.length ? theme.text : theme.textMuted, fontSize: 12 }} numberOfLines={1}>
            {selected.length ? selected.join(', ') : 'Choisir des options…'}
          </Text>
        </Pressable>
        {pickerOpen && (
          <View style={[styles.popover, popoverPlacement, { backgroundColor: opaqueSurface, borderColor: theme.border }]}>
            <View style={styles.popoverList}>
              {options.map((option) => (
                <Pressable
                  key={option}
                  onPress={() => {
                    onChange(
                      selected.includes(option)
                        ? selected.filter((item) => item !== option)
                        : [...selected, option],
                    );
                  }}
                  style={styles.popoverRow}
                >
                  <Text style={{ color: theme.text, fontSize: 12 }}>
                    {selected.includes(option) ? '☑' : '☐'} {option}
                  </Text>
                </Pressable>
              ))}
              {options.length === 0 && (
                <Text style={[styles.muted, { color: theme.textMuted }]}>
                  Aucune option configurée (Paramètres → Gestion des propriétés).
                </Text>
              )}
            </View>
            <Pressable
              onPress={() => setPickerOpen(false)}
              style={[styles.popoverRow, { borderTopWidth: 1, borderTopColor: theme.border }]}
            >
              <Text style={{ color: theme.textMuted, fontSize: 12 }}>✓ Fermer</Text>
            </Pressable>
          </View>
        )}
      </View>
    );
  }

  if (def.type === 'bubbles') {
    // Bulles : chaque valeur est une pilule supprimable d'un clic, le
    // champ « + Ajouter » en empile de nouvelles (Entrée) — le rendu des
    // tags/aliases, façon Obsidian.
    const items: string[] = Array.isArray(value) ? value.map(String) : [];
    const commitDraft = () => {
      const trimmed = bubbleDraft.trim();
      if (trimmed && !items.includes(trimmed)) onChange([...items, trimmed]);
      setBubbleDraft('');
    };
    return (
      <View style={[styles.bubblesWrap, { borderColor: theme.border }]}>
        {items.length > 0 && (
          <View style={styles.bubblesRow}>
            {items.map((item) => (
              <Pressable
                key={item}
                onPress={() => onChange(items.filter((v) => v !== item))}
                style={[styles.bubble, { backgroundColor: `${theme.accent}1a`, borderColor: `${theme.accent}55` }]}
                accessibilityLabel={`Retirer ${item}`}
              >
                <Text style={{ color: theme.accent, fontSize: 11 }}>
                  {item} ✕
                </Text>
              </Pressable>
            ))}
          </View>
        )}
        <SuggestTextInput
          value={bubbleDraft}
          onChangeText={setBubbleDraft}
          suggestions={suggestPropertyValues({
            query: bubbleDraft,
            used,
            schemaOptions: def.options,
            exclude: items,
          })}
          onPick={(suggestion) => {
            if (!items.includes(suggestion.value)) onChange([...items, suggestion.value]);
            setBubbleDraft('');
          }}
          onSubmit={commitDraft}
          onBlur={bubbleDraft.trim() ? commitDraft : undefined}
          placeholder="+ Ajouter…"
          theme={theme}
          wrapStyle={{ flex: 1, minWidth: 90 }}
          style={{ color: theme.text, fontSize: 12, paddingVertical: 2 }}
        />
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
          <View style={[styles.popover, popoverPlacement, { backgroundColor: opaqueSurface, borderColor: theme.border }]}>
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

  if (def.type === 'text' || def.type === 'list') {
    return (
      <SuggestDraftField
        def={def}
        initialValue={formatValueForInput(def.type, value)}
        onCommit={(text) => onChange(parseInputForType(def.type, text))}
        used={used}
        noteNames={noteNames}
        theme={theme}
      />
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

// Texte et Liste : brouillon à commit différé (comme DraftTextField) +
// suggestions. Liste : on complète le DERNIER élément (après la dernière
// virgule). `[[` ouvert : noms de notes. Choisir une suggestion valide
// tout de suite.
function suggestionsFor(
  def: PropertyDefinition,
  draft: string,
  used: ReadonlyMap<string, number> | undefined,
  noteNames: readonly string[],
): { suggestions: ValueSuggestion[]; apply: (suggestion: ValueSuggestion) => string } {
  const isList = def.type === 'list';
  const { prefix, query } = isList ? lastListSegment(draft) : { prefix: '', query: draft };
  const link = openWikilinkQuery(query);
  if (link) {
    const before = prefix + query.slice(0, link.start);
    return {
      suggestions: suggestPropertyValues({ query: link.query, noteNames, includeNotes: true }),
      apply: (suggestion) => before + suggestion.value,
    };
  }
  const exclude = isList ? draft.split(',').map((item) => item.trim()).slice(0, -1) : [];
  return {
    suggestions: suggestPropertyValues({ query, used, schemaOptions: def.options, exclude }),
    apply: (suggestion) => prefix + suggestion.value,
  };
}

function SuggestDraftField({
  def,
  initialValue,
  onCommit,
  used,
  noteNames,
  theme,
}: {
  def: PropertyDefinition;
  initialValue: string;
  onCommit: (text: string) => void;
  used: ReadonlyMap<string, number> | undefined;
  noteNames: readonly string[];
  theme: Theme;
}) {
  // Même resynchronisation pendant le rendu que DraftTextField.
  const [prevInitialValue, setPrevInitialValue] = useState(initialValue);
  const [draft, setDraft] = useState(initialValue);
  if (initialValue !== prevInitialValue) {
    setPrevInitialValue(initialValue);
    setDraft(initialValue);
  }
  const commit = (text: string) => {
    if (text !== initialValue) onCommit(text);
  };
  const { suggestions, apply } = suggestionsFor(def, draft, used, noteNames);
  return (
    <SuggestTextInput
      value={draft}
      onChangeText={setDraft}
      suggestions={suggestions}
      onPick={(suggestion) => {
        const next = apply(suggestion);
        setDraft(next);
        commit(next);
      }}
      onSubmit={() => commit(draft)}
      onBlur={() => commit(draft)}
      theme={theme}
      wrapStyle={{ flex: 1 }}
      style={[styles.valueInput, { color: theme.text, borderColor: theme.border }]}
    />
  );
}

//////// 2. Les styles ////////////////////////////////////////////////////////////////////

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
  // Desktop/web : flotte sous le champ. Android : EN FLUX NORMAL — un enfant
  // absolu qui déborde de son parent n'y reçoit pas les touchers (et zIndex
  // ne traverse pas les lignes voisines) : la liste pousse le contenu.
  popoverFloating: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    zIndex: 20,
    elevation: 8,
  },
  popoverInline: {
    position: 'relative',
  },
  popover: {
    marginTop: 4,
    borderWidth: 1,
    borderRadius: 8,
    padding: 6,
    gap: 4,
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
  // Bulles : conteneur bordé léger, pilules enroulables.
  bubblesWrap: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 6,
    paddingVertical: 3,
    paddingHorizontal: 6,
    gap: 3,
  },
  bubblesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  bubble: {
    borderRadius: 999,
    borderWidth: 1,
    paddingVertical: 2,
    paddingHorizontal: 8,
  },
});
