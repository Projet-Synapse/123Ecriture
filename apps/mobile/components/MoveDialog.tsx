import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput } from 'react-native';

import { collectFolderOptions } from '../lib/vaultTree';
import { useScrollIntoView } from '../lib/useScrollIntoView';
import type { Theme } from '../theme';

// Boîte de dialogue "Déplacer vers…" — une liste de dossiers plutôt que du
// glisser-déposer : plus simple et plus fiable à vérifier sans navigateur
// réel sous la main. Le glisser-déposer reste possible plus tard si
// vraiment souhaité.
//
// Champ de filtre + navigation clavier (↓↑ + Entrée, même idiome que
// CommandPalette.tsx/SearchDialog.tsx) : sur un vault à nombreux dossiers,
// la liste dépassait vite sa hauteur maximale et se parcourait uniquement
// à la molette — le filtre réduit, les flèches parcourent, Entrée déplace,
// et la sélection reste dans la zone visible (useScrollIntoView). Échap
// reste géré par le onRequestClose du Modal (react-native-web).
type MoveOption = {
  // undefined = la racine du vault, présentée en tête de liste
  relPath: string | undefined;
  label: string;
  icon: string;
  depth: number;
  disabled: boolean;
};

type Props = {
  node: VaultTreeNode | null;
  tree: VaultTreeNode[];
  theme: Theme;
  onSelect: (destinationRelPath?: string) => void;
  onCancel: () => void;
  // Mode multi-sélection (voir NotesScreen.tsx, barre d'actions groupées
  // "Déplacer…") : pas de nœud UNIQUE à exclure des destinations ni de
  // "dossier déjà là" à désactiver — chaque élément sélectionné peut avoir
  // un parent différent. `multiCount` (nombre d'éléments) pilote juste le
  // titre et le fait de rester monté sans `node`.
  multiCount?: number;
};

export function MoveDialog({ node, tree, theme, onSelect, onCancel, multiCount }: Props) {
  const [filter, setFilter] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  // Recale filtre + sélection à chaque OUVERTURE (signature du dialogue
  // actif : relPath du nœud, ou compte de la multi-sélection) — le composant
  // reste monté en permanence chez NotesScreen (node=null quand fermé), un
  // état "oublié" d'une ouverture précédente ne doit pas ressortir.
  const dialogSignature = node?.relPath ?? (multiCount !== undefined ? `multi:${multiCount}` : 'closed');
  const [lastDialogSignature, setLastDialogSignature] = useState(dialogSignature);
  if (lastDialogSignature !== dialogSignature) {
    setLastDialogSignature(dialogSignature);
    setFilter('');
    setSelectedIndex(0);
  }
  // Suit la sélection flèches pour la garder dans la zone visible (voir
  // lib/useScrollIntoView.ts pour la forme "handlers inline" imposée par
  // react-hooks/refs).
  const { scrollRef, recordItemLayout, handleListLayout, handleListScroll, ensureVisible } = useScrollIntoView();

  const isOpen = Boolean(node) || multiCount !== undefined;
  const options = collectFolderOptions(tree, node?.type === 'folder' ? node.relPath : undefined);
  // En mode multi-sélection (`node` absent), aucune destination n'est
  // présumée "déjà là" : contrairement au mode simple, on ne connaît pas de
  // parent unique à exclure.
  const currentParent =
    node && node.relPath.includes('/') ? node.relPath.slice(0, node.relPath.lastIndexOf('/')) : undefined;
  const rootDisabled = node ? currentParent === undefined : false;
  const title = node ? `Déplacer « ${node.name} » vers…` : `Déplacer ${multiCount} éléments vers…`;

  const allOptions: MoveOption[] = [
    { relPath: undefined, label: 'Racine du vault', icon: '🗄️', depth: 0, disabled: rootDisabled },
    ...options.map((option) => ({
      relPath: option.relPath,
      label: option.label,
      icon: '📁',
      depth: option.depth + 1,
      disabled: option.relPath === currentParent,
    })),
  ];

  const needle = filter.trim().toLowerCase();
  // Le filtre porte sur le nom affiché OU le chemin complet : chercher
  // "personnage/anna" doit trouver Personnages/Anna, pas seulement les
  // dossiers dont le NOM court contient toute la sous-chaîne.
  const visibleOptions = needle
    ? allOptions.filter(
        (option) =>
          option.label.toLowerCase().includes(needle) ||
          (option.relPath !== undefined && option.relPath.toLowerCase().includes(needle)),
      )
    : allOptions;

  // Recale la sélection quand le filtre CHANGE la liste — ajustement pendant
  // le rendu (comparaison d'état, même correctif React que
  // CommandPalette.tsx `lastItemsSignature`) plutôt qu'un setState en effet.
  const filterSignature = `${needle}:${visibleOptions.length}`;
  const [lastFilterSignature, setLastFilterSignature] = useState(filterSignature);
  if (lastFilterSignature !== filterSignature) {
    setLastFilterSignature(filterSignature);
    // Première option UTILISABLE (la racine peut être désactivée) : la
    // flèche partira de là plutôt que d'une Entrée muette sur une ligne
    // grisée.
    const firstEnabled = visibleOptions.findIndex((option) => !option.disabled);
    if (selectedIndex !== firstEnabled) setSelectedIndex(firstEnabled === -1 ? 0 : firstEnabled);
  }

  const activateOption = (option: MoveOption | undefined) => {
    if (!option || option.disabled) return;
    onSelect(option.relPath);
  };

  // Navigation clavier ↓↑/Entrée desktop-web — les entrées désactivées
  // (racine déjà courante, parent actuel) sont SAUTÉES : s'y arrêter
  // n'aboutirait qu'à une Entrée sans effet.
  useEffect(() => {
    if (typeof window === 'undefined' || !isOpen) return;
    const moveSelection = (from: number, delta: number) => {
      let next = from;
      do {
        next = next + delta;
      } while (next >= 0 && next < visibleOptions.length && visibleOptions[next].disabled);
      if (next < 0 || next >= visibleOptions.length) return from;
      return next;
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        const next = moveSelection(selectedIndex, 1);
        setSelectedIndex(next);
        ensureVisible(next);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        const next = moveSelection(selectedIndex, -1);
        setSelectedIndex(next);
        ensureVisible(next);
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        activateOption(visibleOptions[selectedIndex]);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleOptions, selectedIndex, isOpen]);

  if (!isOpen) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel}>
        <Pressable style={[styles.dialog, { backgroundColor: theme.surface }]} onPress={(e) => e.stopPropagation()}>
          <Text style={[styles.title, { color: theme.text }]}>{title}</Text>
          <TextInput
            autoFocus
            value={filter}
            onChangeText={setFilter}
            // Repli clavier natif (mobile, pas d'écouteur `window`) — active
            // l'option actuellement sélectionnée, même comportement
            // qu'Entrée sur desktop.
            onSubmitEditing={() => activateOption(visibleOptions[selectedIndex])}
            placeholder="Filtrer les dossiers…"
            placeholderTextColor={theme.textMuted}
            style={[styles.filterInput, { color: theme.text, borderColor: theme.border }]}
          />
          <ScrollView
            ref={scrollRef}
            onLayout={(event) => handleListLayout(event)}
            onScroll={(event) => handleListScroll(event)}
            style={styles.optionsList}
          >
            {visibleOptions.map((option, index) => {
              const isSelected = index === selectedIndex;
              return (
                <Pressable
                  key={option.relPath ?? '__root__'}
                  onLayout={(event) => recordItemLayout(index, event)}
                  onPress={() => activateOption(option)}
                  disabled={option.disabled}
                  style={[
                    styles.option,
                    { paddingLeft: 16 + option.depth * 16 },
                    option.disabled && styles.optionDisabled,
                    isSelected && !option.disabled && { backgroundColor: `${theme.accent}22` },
                  ]}
                >
                  <Text style={{ color: theme.text }}>
                    {option.icon} {option.label}
                  </Text>
                </Pressable>
              );
            })}
            {visibleOptions.length === 0 && (
              <Text style={[styles.muted, { color: theme.textMuted }]}>Aucun dossier ne correspond.</Text>
            )}
          </ScrollView>
          <Pressable onPress={onCancel} style={styles.cancelButton}>
            <Text style={{ color: theme.textMuted }}>Annuler</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dialog: {
    width: 320,
    maxHeight: 400,
    borderRadius: 12,
    padding: 16,
    gap: 12,
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
  },
  filterInput: {
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    fontSize: 14,
  },
  optionsList: {
    maxHeight: 260,
  },
  option: {
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 6,
  },
  optionDisabled: {
    opacity: 0.35,
  },
  muted: {
    fontSize: 13,
    padding: 8,
  },
  cancelButton: {
    alignSelf: 'flex-end',
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
});
