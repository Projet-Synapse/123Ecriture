import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { TYPE_ICONS } from '../lib/propertyTypes';
import type { Theme } from '../theme';

// Bouton "+" en bas des propriétés d'une note — ouvre une petite liste
// filtrable des propriétés déjà déclarées dans le schéma du vault (voir
// Paramètres → Gestion des propriétés) et pas encore utilisées sur CETTE
// note, façon capture de référence (.claude/References/image-4.png) :
// choix par option plutôt qu'un texte libre à retaper à chaque fois.
// Partagé par PropertiesPanel.tsx (barre latérale) et PropertiesBlock.tsx
// (bloc en haut de note).
type Props = {
  available: PropertyDefinition[];
  onAdd: (def: PropertyDefinition) => void;
  theme: Theme;
};

export function AddPropertyButton({ available, onAdd, theme }: Props) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');

  const filtered = available.filter(
    (def) => filter.trim() === '' || def.name.toLowerCase().includes(filter.trim().toLowerCase()),
  );

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
        <View style={[styles.popover, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          {available.length === 0 ? (
            <Text style={[styles.muted, { color: theme.textMuted }]}>
              Toutes les propriétés du vault sont déjà sur cette note.{'\n'}Crée-en d’autres dans Paramètres →
              Gestion des propriétés.
            </Text>
          ) : (
            <>
              <TextInput
                value={filter}
                onChangeText={setFilter}
                placeholder="Chercher une propriété…"
                placeholderTextColor={theme.textMuted}
                style={[styles.filterInput, { color: theme.text, borderColor: theme.border }]}
                autoFocus
              />
              <View style={styles.list}>
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
              </View>
            </>
          )}
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
    maxWidth: 260,
    borderWidth: 1,
    borderRadius: 8,
    padding: 6,
    gap: 4,
  },
  filterInput: {
    borderWidth: 1,
    borderRadius: 6,
    paddingVertical: 4,
    paddingHorizontal: 6,
    fontSize: 12,
  },
  list: {
    maxHeight: 220,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 6,
    borderRadius: 4,
  },
  muted: {
    fontSize: 11,
    padding: 6,
    lineHeight: 15,
  },
});
