import { Fragment, memo, type ComponentProps, type ComponentType } from 'react';
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
// //2. Props/rendu — une ligne par nœud (chevron, icône SVG, nom+extension),
//      récursif sur les enfants d'un dossier.
// //3. Styles.
//
// v0.4.36 (demandes de l'utilisatrice) :
// - Icônes VECTORIELLES (react-native-svg) : dossier ouvert ou FERMÉ selon
//   l'état de repli, chevron de repli, types de fichiers différenciés par
//   couleur. Fini les emojis.
// - EXTENSION du fichier affichée à la fin du nom (.mdx, .canvas…).
// - Les DOSSIERS sont sélectionnables (clic = ouvre l'aperçu du contenu
//   dans l'éditeur, style Make.md d'Obsidian ; le chevron replie/déplie).
//
// v0.4.50 (demande : des dossiers qui fassent plus « boutons rétractables »,
// à la Obsidian) :
// - Chaque ligne est une pilule arrondie — les dossiers portent une bordure
//   et un fond teinté accent, les notes un fond plus léger : le dossier
//   déplié se lit comme le CONTENEUR visuel de ses enfants, qui
//   s'imbriquent en retrait sous lui (fin des rails verticaux style VS
//   Code, l'indentation suffit à porter la hiérarchie).
// - Le clic droit n'est PAS géré ici : chaque ligne porte juste un
//   `dataSet={{ relpath: ... }}` (converti en attribut data-relpath par
//   react-native-web), et c'est NotesScreen qui écoute un seul événement
//   "contextmenu" délégué sur tout le conteneur puis retrouve la ligne
//   visée via cet attribut. Passer `onContextMenu` directement à Pressable
//   ne fonctionnait pas de façon fiable — la délégation sur un seul
//   écouteur est bien plus robuste.
//
// v0.4.51 (retour sur la capture Obsidian réelle) : l'effet conteneur bordé
// est réservé aux DOSSIERS DE PREMIER NIVEAU ; tout ce qui est imbriqué est
// une ligne continue (aucune séparation verticale) sous des RAILS
// d'arborescence restaurés (un trait par ancêtre, style VS Code).

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
  // Maintien de doigt (natif) — l'équivalent tactile du clic droit desktop
  // (menu contextuel, voir NotesScreen.showContextMenuFor).
  onNodeLongPress?: (node: VaultTreeNode) => void;
};

// //2. 🌳 PROPS/RENDU
// ////////////////////////////////////////////////////////////////////////

// Mémoïsé (voir propsAreEqual en bas de fichier) : chaque FRAPPE re-rend
// NotesScreen en entier (le contenu de la note est son state) et ce
// sous-arbre représente des centaines de lignes sur un gros coffre — le
// re-rendu par frappe était le premier coût de frappe ressenti sur PC
// (Intermédiaire, 2026-10-05).
function VaultTreeViewImpl({
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
  onNodeLongPress,
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

        // Ligne elle-même — commune aux deux habillages (conteneur ou plat).
        const row = (
          <DraggablePressable
            onLongPress={onNodeLongPress ? () => onNodeLongPress(node) : undefined}
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
            {/* RAILS VERTICAUX (v0.4.51, restaurés de la v0.4.36) — un par
                ancêtre : chaque trait fait TOUTE la hauteur de la ligne
                (alignSelf:'stretch'), empilés ils forment une ligne continue
                — la hiérarchie se lit aux traits, pas aux séparations.
                Hauteur de ligne FIXE (v0.4.37) : sans elle, les rails
                seraient hachurés. */}
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
              // Champ MIROIR de l'édition de titre : SANS autoFocus ni
              // onBlur-auto-submit — le titre inline (ou l'endroit d'où
              // vient le renommage) garde le focus. Deux champs autoFocus
              // montés ensemble se volaient le focus en boucle : chaque
              // blur déclenchait onSubmit → le champ se refermait
              // aussitôt (mobile ET desktop, vécu 2026-10-02) et
              // l'ancien code ajoutait un « 2 » au nom à chaque blur.
              <TextInput
                value={rename.value}
                onChangeText={rename.onChangeValue}
                onSubmitEditing={rename.onSubmit}
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
        );

        // v0.4.52 (capture Obsidian à l'appui) : DOSSIER DE PREMIER NIVEAU =
        // CONTENEUR. L'en-tête ET tout son sous-arbre déplié vivent dans UN
        // bloc bordé arrondi au fond teinté — l'effet « bouton rétractable »
        // s'étend à ce que le dossier CONTIENT. Replié, le conteneur ne
        // montre que l'en-tête et prend l'allure d'une pilule. Les dossiers
        // IMBRIQUÉS ne créent jamais de sous-conteneur : leurs lignes
        // vivent sur le fond du bloc parent, sous les rails. Les états
        // actif/sélection/drop restent prioritaires sur le fond du bloc.
        if (depth === 0 && isFolder) {
          return (
            <Fragment key={node.relPath}>
              {insertionEdge === 'above' && (
                <View style={styles.insertionLine}>
                  <View style={[styles.insertionLineBar, { backgroundColor: theme.accent }]} />
                </View>
              )}
              <View style={[styles.topContainer, { borderColor: theme.border, backgroundColor: `${theme.accent}0D` }]}>
                {row}
                {isFolder && !isCollapsed && (
                  <VaultTreeViewImpl
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
              </View>
              {insertionEdge === 'below' && (
                <View style={styles.insertionLine}>
                  <View style={[styles.insertionLineBar, { backgroundColor: theme.accent }]} />
                </View>
              )}
            </Fragment>
          );
        }

        return (
          <Fragment key={node.relPath}>
            {insertionEdge === 'above' && (
              <View style={[styles.insertionLine, { paddingLeft: 12 + depth * 16 }]}>
                <View style={[styles.insertionLineBar, { backgroundColor: theme.accent }]} />
              </View>
            )}
            {row}
            {insertionEdge === 'below' && (
              <View style={[styles.insertionLine, { paddingLeft: 12 + depth * 16 }]}>
                <View style={[styles.insertionLineBar, { backgroundColor: theme.accent }]} />
              </View>
            )}
            {isFolder && !isCollapsed && (
              <VaultTreeViewImpl
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

// Comparateur : ignore VOLONTAIREMENT les props fonctions (onOpenNote,
// onToggleCollapse, onOpenFolder, onNodeLongPress, rename.*) — chacune
// ferme sur un état couvert par une prop comparée ci-dessus (tree,
// activeRelPath, selectedRelPaths, collapsedPaths…), donc un handler
// périmé ne peut pas survivre à un changement visible de l'arbre.
function vaultTreePropsAreEqual(prev: Props, next: Props): boolean {
  return (
    prev.nodes === next.nodes &&
    prev.theme === next.theme &&
    prev.activeRelPath === next.activeRelPath &&
    prev.activeFolderRelPath === next.activeFolderRelPath &&
    prev.collapsedPaths === next.collapsedPaths &&
    prev.selectedRelPaths === next.selectedRelPaths &&
    prev.draggingRelPath === next.draggingRelPath &&
    prev.dragOverInsertion === next.dragOverInsertion &&
    prev.dragEnabled === next.dragEnabled &&
    prev.rename?.relPath === next.rename?.relPath &&
    prev.rename?.value === next.rename?.value
  );
}

export const VaultTreeView = memo(VaultTreeViewImpl, vaultTreePropsAreEqual);

// //3. 🎨 STYLES
// ////////////////////////////////////////////////////////////////////////

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    // HAUTEUR FIXE + AUCUNE marge verticale (v0.4.51, demande : « pas de
    // séparations blanches entre chaque fichier ») : les lignes se touchent,
    // les rails d'arborescence (un par ancêtre, voir indentGuideCell)
    // forment des traits continus de haut en bas.
    height: 32,
    paddingLeft: 4,
    paddingRight: 12,
  },
  // Conteneur DOSSIER DE PREMIER NIVEAU (v0.4.52) : bordure arrondie qui
  // englobe l'en-tête ET tout le sous-arbre déplié (fond teinté accent
  // passé au rendu). Replié = pilule (le conteneur ne montre que
  // l'en-tête). `overflow hidden` : les lignes enfants sont coupées
  // proprement aux coins arrondis.
  topContainer: {
    borderWidth: 1,
    borderRadius: 10,
    marginHorizontal: 3,
    marginBottom: 4,
    overflow: 'hidden',
  },
  // Boîte du chevron — largeur fixe pour aligner icônes et noms des
  // dossiers ET des notes sur la même colonne.
  chevronBox: {
    width: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Rails d'arborescence : une cellule de 16 px par niveau d'ancêtre,
  // le trait centré couvre TOUTE la hauteur de la ligne (alignSelf
  // 'stretch' + flex 1) — empilés sur N lignes, les traits sont continus.
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
