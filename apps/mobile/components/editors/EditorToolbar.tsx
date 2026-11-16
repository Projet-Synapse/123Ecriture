import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { toolbarPressEffect, type ToolbarItem } from '../../lib/editor/toolbarItems';

import type { Theme } from '../../theme';

// ✒️ 123ECRITURE — components/editors/EditorToolbar.tsx — barre d'outils partagée des éditeurs
//////////////////////////////////////////////////////////////////////////////
//
// Barre d'outils partagée par les 3 éditeurs de fichier (Notes, Canvas,
// Graphiques) : style neutre (fond `theme.surface`, texte `theme.text`,
// coins peu arrondis) — un bandeau d'actions discret, pas des
// call-to-action colorés. Chaque appelant précalcule sa propre liste
// `{id, label, onPress}` (déjà filtrée/ordonnée selon les préférences —
// voir NotesScreen.tsx/CanvasEditor.tsx/ChartEditor.tsx), ce composant ne
// fait que l'afficher de façon identique partout. Un item avec `subItems`
// est un groupe dépliant (ex. bouton "H" qui déploie H1-H6) : il déploie
// une seconde rangée en flux normal plutôt qu'un menu flottant ancré —
// aucun popover positionné n'existe ailleurs dans l'app (RN Web n'a pas
// de portail natif), la rangée reste simple et sans mesure de layout.
//
// Invariants du fichier :
//   • Un item `run` n'exécute rien lui-même : il remonte l'item à
//     l'appelant via onItemRun (annuler/rétablir touchent l'EditorView,
//     la pièce jointe ouvre le sélecteur) — les closures refs restent
//     dans le scope du prop JSX de l'appelant, où react-hooks/refs les
//     accepte.
//   • `divider` ne rend qu'un trait fin — label/id ignorés.
//   • Un sous-bouton de groupe dépliant suit le MÊME chemin qu'un bouton à
//     plat (`run` → onItemRun) — voir lib/editor/toolbarItems.ts.
//
// SOMMAIRE :
//   1. Types d'items (groupe, séparateur, action déléguée)
//   2. Rendu (boutons, groupe dépliant, rangée secondaire)
//
//////////////////////////////////////////////////////////////////////////////

//////// 1. Types d'items (groupe, séparateur, action déléguée) ////////////
// Types et logique d'appui : lib/editor/toolbarItems.ts (testés).
type Item = ToolbarItem;

//////// 2. Rendu (boutons, groupe dépliant, rangée secondaire) ////////////

type Props = {
  items: Item[];
  theme: Theme;
  onItemRun?: (item: Item) => void;
};

export function EditorToolbar({ items, theme, onItemRun }: Props) {
  const [openGroupId, setOpenGroupId] = useState<string | null>(null);

  if (items.length === 0) return null;

  const openGroup = items.find((item) => item.id === openGroupId && item.subItems);

  return (
    <View style={[styles.container, { borderColor: theme.border }]}>
      <View style={styles.toolbar}>
        {items.map((item) => {
          if (item.divider) {
            return <View key={item.id} style={[styles.divider, { backgroundColor: theme.border }]} />;
          }
          const isGroup = Boolean(item.subItems);
          const isOpen = isGroup && item.id === openGroupId;
          return (
            <Pressable
              key={item.id}
              onPress={() => {
                const effect = toolbarPressEffect(item);
                if (effect === 'toggle-group') {
                  setOpenGroupId(isOpen ? null : item.id);
                  return;
                }
                if (effect === 'run') onItemRun?.(item);
                else if (effect === 'press') item.onPress?.();
              }}
              // Groupe dépliant : le survol (PC) OU l'appui (tactile) suffit
              // à le déployer — pas besoin de cliquer.
              onHoverIn={() => isGroup && setOpenGroupId(item.id)}
              onPressIn={() => isGroup && setOpenGroupId(item.id)}
              style={[
                styles.toolbarButton,
                { backgroundColor: theme.surface },
                isOpen && { backgroundColor: `${theme.accent}22` },
              ]}
            >
              <Text style={[styles.toolbarButtonText, { color: isOpen ? theme.accent : theme.text }]}>
                {item.label}
                {isGroup ? (isOpen ? ' ▴' : ' ▾') : ''}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {openGroup?.subItems && (
        <View style={[styles.subToolbar, { borderColor: theme.border }]}>
          {openGroup.subItems.map((subItem) => (
            <Pressable
              key={subItem.id}
              onPress={() => {
                // Même chemin qu'un bouton à plat : `run` remonte à
                // l'appelant (H1…H6 du groupe « Titres »).
                const effect = toolbarPressEffect(subItem);
                if (effect === 'run') onItemRun?.(subItem);
                else if (effect === 'press') subItem.onPress?.();
                setOpenGroupId(null);
              }}
              style={[styles.toolbarButton, { backgroundColor: theme.surface }]}
            >
              <Text style={[styles.toolbarButtonText, { color: theme.text }]}>{subItem.label}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  divider: {
    width: 1,
    alignSelf: 'stretch',
    marginHorizontal: 4,
    marginVertical: 6,
  },
  container: {
    borderBottomWidth: 1,
    paddingBottom: 10,
  },
  toolbar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
  },
  subToolbar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    marginHorizontal: 12,
    marginTop: 8,
    paddingTop: 8,
    paddingLeft: 8,
    borderLeftWidth: 2,
  },
  toolbarButton: {
    minWidth: 32,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 6,
    alignItems: 'center',
  },
  toolbarButtonText: {
    fontSize: 13,
    fontWeight: '600',
  },
});
