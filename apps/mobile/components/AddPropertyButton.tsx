import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { TYPE_ICONS, TYPE_LABELS, TYPE_ORDER } from '../lib/propertyTypes';
import { usePreferences } from '../preferences/PreferencesContext';
import type { Theme } from '../theme';

// Bouton "+" en bas des propriétés d'une note — deux usages, dans le même
// popover (partagé par PropertiesPanel.tsx et PropertiesBlock.tsx) :
// 1. ajouter une propriété déjà déclarée dans le schéma du vault mais pas
//    encore utilisée sur CETTE note (liste filtrable) ;
// 2. CRÉER une propriété neuve (nom + type) et l'ajouter immédiatement à la
//    note — sans passer par Paramètres → Gestion des propriétés (demande
//    utilisateur : les "+" semblaient morts quand le schéma était vide, le
//    popover n'offrait alors rien d'actionnable).
type Props = {
  available: PropertyDefinition[];
  onAdd: (def: PropertyDefinition) => void;
  onCreateNew: (name: string, type: PropertyType) => void | Promise<void>;
  theme: Theme;
};

export function AddPropertyButton({ available, onAdd, onCreateNew, theme }: Props) {
  // Fond OPAQUE pour le popover (v0.4.38 — « t'assurer qu'il ne soit pas
  // transparent ») : theme.surface est rgba translucide depuis la
  // personnalisation des panneaux ; on recompose la couleur de panneau à
  // opacité 1 via la résolution du profil du mode actif.
  const { preferences, colorScheme } = usePreferences();
  const { resolveAppearanceProfile } = require('../lib/appearance');
  const opaqueSurface = resolveAppearanceProfile(preferences, colorScheme).surfaceColor;
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<PropertyType>('text');
  const [creating, setCreating] = useState(false);

  const filtered = available.filter(
    (def) => filter.trim() === '' || def.name.toLowerCase().includes(filter.trim().toLowerCase()),
  );

  const submitCreate = () => {
    const name = newName.trim();
    if (!name || creating) return;
    setCreating(true);
    void (async () => {
      try {
        await onCreateNew(name, newType);
        setNewName('');
        setOpen(false);
      } finally {
        setCreating(false);
      }
    })();
  };

  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        style={[styles.button, { borderColor: theme.border }]}
      >
        <Text style={{ color: theme.accent, fontSize: 14, fontWeight: '600' }}>+</Text>
      </Pressable>
      {open && (
        // EN FLUX NORMAL (pas `position: 'absolute'`) — un popover flottant
        // ici s'ouvrait vers le bas et chevauchait visuellement la barre
        // d'outils de l'éditeur juste en dessous, quelle que soit la marge
        // ajoutée autour de la carte "Propriétés" (bug rapporté : le "+" "en
        // conflit visuel avec la barre des tâches"). En flux normal, cette
        // liste POUSSE le reste du contenu vers le bas au lieu de le
        // recouvrir — plus de chevauchement possible, par construction.
        <View style={[styles.popover, { backgroundColor: opaqueSurface, borderColor: theme.border }]}>
          {available.length > 0 && (
            <>
              <TextInput
                value={filter}
                onChangeText={setFilter}
                placeholder="Chercher une propriété…"
                placeholderTextColor={theme.textMuted}
                style={[styles.filterInput, { color: theme.text, borderColor: theme.border }]}
              />
              {/* SCROLL (v0.4.38 — « ajouter une barre de défilement pour le
                  petit navigateur ») : la liste était coupée à 180px sans
                  moyen de descendre. */}
              <ScrollView style={styles.list} nestedScrollEnabled>
                {filtered.map((def) => (
                  <Pressable
                    key={def.id}
                    onPress={() => {
                      onAdd(def);
                      setOpen(false);
                      setFilter('');
                    }}
                    style={styles.row}
                  >
                    <Text style={{ fontSize: 12 }}>{TYPE_ICONS[def.type]}</Text>
                    <Text style={{ color: theme.text, fontSize: 12 }} numberOfLines={1}>
                      {def.name}
                    </Text>
                  </Pressable>
                ))}
                {filtered.length === 0 && (
                  <Text style={[styles.muted, { color: theme.textMuted }]}>Aucun résultat.</Text>
                )}
              </ScrollView>
              <View style={[styles.separator, { borderColor: theme.border }]} />
            </>
          )}

          <Text style={[styles.sectionHint, { color: theme.textMuted }]}>Nouvelle propriété</Text>
          <TextInput
            value={newName}
            onChangeText={setNewName}
            onSubmitEditing={submitCreate}
            placeholder="Nom de la propriété…"
            placeholderTextColor={theme.textMuted}
            style={[styles.filterInput, { color: theme.text, borderColor: theme.border }]}
          />
          <View style={styles.typeChips}>
            {TYPE_ORDER.map((type) => (
              <Pressable
                key={type}
                onPress={() => setNewType(type)}
                style={[
                  styles.typeChip,
                  { borderColor: theme.border },
                  newType === type && { borderColor: theme.accent, backgroundColor: theme.accent + '1a' },
                ]}
              >
                <Text style={{ fontSize: 11, color: theme.text }}>
                  {TYPE_ICONS[type]} {TYPE_LABELS[type]}
                </Text>
              </Pressable>
            ))}
          </View>
          <Pressable
            onPress={submitCreate}
            disabled={!newName.trim() || creating}
            style={[
              styles.createButton,
              { backgroundColor: theme.accent, opacity: newName.trim() ? 1 : 0.5 },
            ]}
          >
            <Text style={styles.createButtonText}>Créer et ajouter à la note</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignSelf: 'flex-start',
    // Étire le popover à la largeur du parent (la carte "Propriétés")
    // plutôt que de rester collé à la largeur du bouton "+" — voir
    // `alignSelf: 'stretch'` ci-dessous sur `popover`.
    width: '100%',
  },
  button: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  popover: {
    alignSelf: 'stretch',
    marginTop: 6,
    maxWidth: 300,
    borderWidth: 1,
    borderRadius: 8,
    padding: 6,
    gap: 6,
  },
  filterInput: {
    borderWidth: 1,
    borderRadius: 6,
    paddingVertical: 4,
    paddingHorizontal: 6,
    fontSize: 12,
  },
  list: {
    maxHeight: 180,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 6,
    borderRadius: 4,
  },
  separator: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  sectionHint: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  typeChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  typeChip: {
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 3,
    paddingHorizontal: 7,
  },
  createButton: {
    borderRadius: 6,
    paddingVertical: 7,
    alignItems: 'center',
  },
  createButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  muted: {
    fontSize: 11,
    padding: 6,
    lineHeight: 15,
  },
});
