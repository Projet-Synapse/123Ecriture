import { Fragment, type ComponentProps, type ComponentType } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { Theme } from '../theme';
import { ChevronIcon, FolderOpenIcon, FolderClosedIcon, NoteIconByKind } from './FileIcons';

// `draggable` n'est pas dans les types RN officiels de Pressable (ce n'est
// pas une prop React Native — voir le commentaire plus bas sur
// `onContextMenu`), mais react-native-web la transmet bel et bien telle
// quelle jusqu'au <div> sous-jacent, ce qui est justement ce qui rend le
// glisser-déposer HTML5 délégué (voir NotesScreen.tsx) possible sans
// handler par ligne. Échappatoire de typage locale et explicite plutôt que
// de parsemer des `as any` dans le JSX plus bas. Exportée : réutilisée telle
// quelle par CanvasEditor.tsx pour les mêmes raisons (cartes/poignées de
// connexion glissables).
// //1. 🖱️ DRAGGABLEPRESSABLE
// ////////////////////////////////////////////////////////////////////////

export const DraggablePressable = Pressable as unknown as ComponentType<
  ComponentProps<typeof Pressable> & { draggable?: boolean }
>;

// Rendu récursif de l'arborescence du vault (dossiers + notes). Composant
// purement présentationnel : toutes les données (arbre, sélection en cours,
// dossiers repliés, état de renommage) et les actions vivent dans
// NotesScreen — ce fichier ne fait qu'afficher et relayer les événements,
// pour ne pas éparpiller la logique métier vault entre deux fichiers.
//
// //1. DraggablePressable — échappatoire de typage pour `draggable`.
// //2. Props/rendu — une ligne par nœud (chevron, icône SVG, nom+extension,
//      RAILS VERTICAUX CONTINUS), récursif sur les enfants d'un dossier.
// //3. Styles.
//
// v0.4.36 (demandes de l'utilisatrice) :
// - Lignes d'arborescence RÉELLES : un rail vertical continu par ancêtre
//   (style VS Code/IDE) — les traits s'étendent sur TOUTE la hauteur de la
//   ligne (`alignSelf:'stretch'`), empilés ils forment une ligne continue.
//   Le dernier rail d'une ligne s'arrête au niveau de l'icône (trait coudé
//   implicite par la connexion visuelle).
// - Icônes VECTORIELLES (react-native-svg) : dossier ouvert ou FERMÉ selon
//   l'état de repli, chevron de repli, types de fichiers différenciés par
//   couleur. Fini les emojis.
// - EXTENSION du fichier affichée à la fin du nom (.mdx, .canvas…).
// - Les DOSSIERS sont sélectionnables (clic = ouvre l'aperçu du contenu
//   dans l'éditeur, style Make.md d'Obsidian ; le chevron replie/déplie).
//
// Le clic droit n'est PAS géré ici : chaque ligne porte juste un
// `dataSet={{ relpath: ... }}` (converti en attribut data-relpath par
// react-native-web), et c'est NotesScreen qui écoute un seul événement
// "contextmenu" délégué sur tout le conteneur puis retrouve la ligne visée
// via cet attribut. Passer `onContextMenu` directement à Pressable ne
// fonctionnait pas de façon fiable — la délégation sur un seul écouteur
// est bien plus robuste.

export type RenameState = {
  relPath: string;
  value: string;
  onChangeValue: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
};

// Extension à afficher pour un nœud note — le `name` du VaultTreeNode est
// SANS extension (voir walkTree côté desktop qui la retire), on la reconstruit
// depuis le relPath (le nom de fichier réel avec extension).
function extensionOf(node: VaultNoteNode): string {
  const nom = node.relPath.split('/').pop() ?? '';
  const dot = nom.lastIndexOf('.');
  return dot > 0 ? nom.slice(dot) : '';
}

type Props = {
  nodes: VaultTreeNode[];
  depth?: number;
  theme: Theme;
  activeRelPath?: string;
  // Dossier dont l'APERÇU est affiché dans l'éditeur (v0.4.36) — teinté
  // comme une note active.
  activeFolderRelPath?: string | null;
  collapsedPaths: Set<string>;
  onToggleCollapse: (relPath: string) => void;
  // Clic sur un DOSSIER (pas le chevron) : ouvrir l'aperçu de son contenu.
  onOpenFolder: (node: VaultFolderNode) => void;
  // Reçoit aussi les touches de modification (Ctrl/Cmd/Shift) du clic —
  // voir NotesScreen.tsx, `handleRowPress` : Ctrl/Cmd bascule la ligne dans la
  // multi-sélection SANS ouvrir la note, Shift étend la sélection depuis
  // le dernier élément cliqué, un clic simple ouvre normalement.
  onOpenNote: (node: VaultNoteNode, modifiers: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => void;
  rename: RenameState | null;
  selectedRelPaths?: Set<string>;
  draggingRelPath?: string | null;
  dragOverInsertion?: { relPath: string; edge: 'above' | 'below' | 'inside' } | null;
  dragEnabled?: boolean;
};

// //2. 🌳 PROPS/RENDU
// ////////////////////////////////////////////////////////////////////////

export function VaultTreeView({
  nodes,
  depth = 0,
  theme,
  activeRelPath,
  activeFolderRelPath,
  collapsedPaths,
  onToggleCollapse,
  onOpenFolder,
  onOpenNote,
  rename,
  selectedRelPaths,
  draggingRelPath,
  dragOverInsertion,
  dragEnabled = true,
}: Props) {
  return (
    <>
      {nodes.map((node) => {
        const isRenaming = rename?.relPath === node.relPath;
        const isFolder = node.type === 'folder';
        const isCollapsed = isFolder && collapsedPaths.has(node.relPath);
        const isDragging = draggingRelPath === node.relPath;
        const insertionEdge = dragOverInsertion?.relPath === node.relPath ? dragOverInsertion.edge : null;
        const isDropInsideTarget = insertionEdge === 'inside';
        const isSelected = !isFolder && (selectedRelPaths?.has(node.relPath) ?? false);
        const isFolderActive = isFolder && node.relPath === activeFolderRelPath;
        const isActiveNote = !isFolder && node.relPath === activeRelPath;

        return (
          <Fragment key={node.relPath}>
            {insertionEdge === 'above' && (
              <View style={[styles.insertionLine, { paddingLeft: 12 + depth * 16 }]}>
                <View style={[styles.insertionLineBar, { backgroundColor: theme.accent }]} />
              </View>
            )}
            <DraggablePressable
              onPress={(event) => {
                // `nativeEvent` est ici la vraie MouseEvent du clic (voir le
                // commentaire de la prop `onOpenNote` ci-dessous).
                const native = event.nativeEvent as unknown as {
                  ctrlKey?: boolean;
                  metaKey?: boolean;
                  shiftKey?: boolean;
                };
                if (isFolder) {
                  // v0.4.36 : le clic sur un dossier ouvre l'APERÇU de son
                  // contenu (Make.md) — le repli/dépli passe par le CHEVRON.
                  onOpenFolder(node);
                  return;
                }
                onOpenNote(node, {
                  ctrlKey: native.ctrlKey === true,
                  metaKey: native.metaKey === true,
                  shiftKey: native.shiftKey === true,
                });
              }}
              dataSet={{ relpath: node.relPath }}
              style={[
                styles.row,
                isActiveNote && { backgroundColor: `${theme.accent}22` },
                isFolderActive && { backgroundColor: `${theme.accent}22` },
                !isRenaming && dragEnabled && styles.rowDraggable,
                isDragging && styles.rowDragging,
                isDropInsideTarget && { backgroundColor: `${theme.accent}33`, borderRadius: 6 },
                isSelected && { backgroundColor: `${theme.accent}33` },
              ]}
            >
              {/* RAILS VERTICAUX CONTINUS (v0.4.36) — un par ancêtre : chaque
                  trait fait TOUTE la hauteur de la ligne, empilés ils
                  forment une ligne continue de haut en bas de l'arbre.
                  Style VS Code. */}
              {Array.from({ length: depth }).map((_, i) => (
                <View key={i} style={styles.indentGuideCell}>
                  <View style={[styles.indentGuideLine, { backgroundColor: theme.border, opacity: 0.55 }]} />
                </View>
              ))}

              {isFolder ? (
                // Chevron de repli/dépli — CIBLE EXCLUSIVE du repli (le
                // corps du dossier ouvre l'aperçu).
                <Pressable
                  onPress={() => onToggleCollapse(node.relPath)}
                  hitSlop={6}
                  style={styles.chevronBox}
                >
                  <ChevronIcon size={11} color={theme.textMuted} expanded={!isCollapsed} />
                </Pressable>
              ) : (
                <View style={styles.chevronBox} />
              )}

              {/* Icône VECTORIELLE : dossier ouvert/fermé selon le repli,
                  sinon le type du fichier (couleur par kind). */}
              {isFolder ? (
                isCollapsed ? (
                  <FolderClosedIcon size={16} />
                ) : (
                  <FolderOpenIcon size={16} />
                )
              ) : (
                <NoteIconByKind kind={node.kind} size={15} />
              )}

              {isRenaming ? (
                <TextInput
                  autoFocus
                  value={rename.value}
                  onChangeText={rename.onChangeValue}
                  onSubmitEditing={rename.onSubmit}
                  onBlur={rename.onSubmit}
                  onKeyPress={(event) => {
                    if (event.nativeEvent.key === 'Escape') rename.onCancel();
                  }}
                  style={[styles.renameInput, { color: theme.text, borderColor: theme.accent }]}
                />
              ) : (
                <Text style={{ color: theme.text }} numberOfLines={1}>
                  {node.name}
                  {/* EXTENSION du fichier (v0.4.36) : .mdx, .canvas… —
                      affichée à la fin du nom, plus discrete. */}
                  {!isFolder && (
                    <Text style={{ color: theme.textMuted, fontSize: 11 }}>{extensionOf(node)}</Text>
                  )}
                </Text>
              )}
            </DraggablePressable>
            {insertionEdge === 'below' && (
              <View style={[styles.insertionLine, { paddingLeft: 12 + depth * 16 }]}>
                <View style={[styles.insertionLineBar, { backgroundColor: theme.accent }]} />
              </View>
            )}
            {isFolder && !isCollapsed && (
              <VaultTreeView
                nodes={node.children}
                depth={depth + 1}
                theme={theme}
                activeRelPath={activeRelPath}
                activeFolderRelPath={activeFolderRelPath}
                collapsedPaths={collapsedPaths}
                onToggleCollapse={onToggleCollapse}
                onOpenFolder={onOpenFolder}
                onOpenNote={onOpenNote}
                rename={rename}
                selectedRelPaths={selectedRelPaths}
                draggingRelPath={draggingRelPath}
                dragOverInsertion={dragOverInsertion}
                dragEnabled={dragEnabled}
              />
            )}
          </Fragment>
        );
      })}
    </>
  );
}

// //3. 🎨 STYLES
// ////////////////////////////////////////////////////////////////////////

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 7,
    paddingLeft: 4,
    paddingRight: 12,
  },
  // Boîte du chevron — largeur fixe pour aligner icônes et noms des
  // dossiers ET des notes sur la même colonne.
  chevronBox: {
    width: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Largeur 16 = pas d'indentation historique — le rail est centré dedans.
  // alignSelf:'stretch' + flex:1 : le trait fait TOUTE la hauteur de la
  // ligne, empilé sur N lignes il forme un rail CONTINU (v0.4.36).
  indentGuideCell: {
    width: 16,
    alignSelf: 'stretch',
    alignItems: 'center',
  },
  indentGuideLine: {
    width: 1,
    flex: 1,
  },
  rowDragging: {
    opacity: 0.4,
  },
  // Simple indice visuel (RN Web transmet `cursor` tel quel).
  rowDraggable: {
    cursor: 'pointer',
  },
  insertionLine: {
    height: 0,
    paddingRight: 12,
    justifyContent: 'center',
  },
  insertionLineBar: {
    height: 2,
    borderRadius: 1,
  },
  renameInput: {
    flex: 1,
    borderBottomWidth: 1,
    paddingVertical: 2,
    fontSize: 14,
  },
});
