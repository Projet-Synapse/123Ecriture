import { Fragment, type ComponentProps, type ComponentType } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { Theme } from '../theme';

// `draggable` n'est pas dans les types RN officiels de Pressable (ce n'est
// pas une prop React Native — voir le commentaire plus bas sur
// `onContextMenu`), mais react-native-web la transmet bel et bien telle
// quelle jusqu'au <div> sous-jacent, ce qui est justement ce qui rend le
// glisser-déposer HTML5 délégué (voir NotesScreen.tsx) possible sans
// handler par ligne. Échappatoire de typage locale et explicite plutôt que
// de parsemer des `as any` dans le JSX plus bas. Exportée : réutilisée telle
// quelle par CanvasEditor.tsx pour les mêmes raisons (cartes/poignées de
// connexion glissables).
export const DraggablePressable = Pressable as unknown as ComponentType<
  ComponentProps<typeof Pressable> & { draggable?: boolean }
>;

// Rendu récursif de l'arborescence du vault (dossiers + notes). Composant
// purement présentationnel : toutes les données (arbre, sélection en cours,
// dossiers repliés, état de renommage) et les actions vivent dans
// NotesScreen — ce fichier ne fait qu'afficher et relayer les événements,
// pour ne pas éparpiller la logique métier vault entre deux fichiers.
//
// Le clic droit n'est PAS géré ici : chaque ligne porte juste un
// `dataSet={{ relpath: ... }}` (converti en attribut data-relpath par
// react-native-web), et c'est NotesScreen qui écoute un seul événement
// "contextmenu" délégué sur tout le conteneur puis retrouve la ligne visée
// via cet attribut. Passer `onContextMenu` directement à Pressable ne
// fonctionnait pas de façon fiable (ce n'est pas une prop RN officielle,
// juste transmise "si ça marche" par react-native-web) — la délégation sur
// un seul écouteur, déjà éprouvée pour le clic droit dans le vide, est un
// mécanisme bien plus robuste.

// Icône par `kind` de fichier (voir EXTENSION_TO_KIND dans
// apps/desktop/electron/vault.js) — distingue une note MDX d'un canvas ou
// d'un graphique dans l'arborescence.
const NOTE_ICON_BY_KIND: Record<VaultEntryKind, string> = {
  markdown: '📝',
  canvas: '🎨',
  chart: '📊',
  excalidraw: '🖍️',
};

export type RenameState = {
  relPath: string;
  value: string;
  onChangeValue: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
};

type Props = {
  nodes: VaultTreeNode[];
  depth?: number;
  theme: Theme;
  activeRelPath?: string;
  collapsedPaths: Set<string>;
  onToggleCollapse: (relPath: string) => void;
  onOpenNote: (node: VaultNoteNode) => void;
  rename: RenameState | null;
  // Glisser pour RÉORDONNER (voir NotesScreen.tsx, qui délègue les
  // évènements DOM dragstart/dragover/drop sur le conteneur plutôt que par
  // ligne — même raison que le clic droit délégué : passer onDragStart/
  // onDragOver directement en props Pressable n'est pas fiable via
  // react-native-web). Ce composant reste purement présentationnel : juste
  // `draggable` + le trait d'insertion, aucune logique ici.
  draggingRelPath?: string | null;
  dragOverInsertion?: { relPath: string; edge: 'above' | 'below' } | null;
  // Paramètres → Gestion des fichiers et des liens → "Ordre des fichiers" :
  // le glisser-déposer n'a de sens qu'en mode 'manual' (voir walkTree dans
  // apps/desktop/electron/vault.ts, qui ignore l'ordre enregistré dans les
  // deux autres modes). Piloté uniquement pour le curseur ici (indice
  // visuel) — l'attribut HTML `draggable` réel est posé IMPÉRATIVEMENT
  // depuis NotesScreen.tsx (voir son effet dédié) : react-native-web
  // 0.21 ne transmet PAS les props inconnues comme `draggable` jusqu'au
  // DOM pour Pressable/View (seul `Image` le fait nativement, vérifié
  // dans ses sources) — passer `draggable` en prop ici serait un no-op
  // silencieux malgré l'apparence trompeuse. Vrai par défaut pour ne rien
  // casser des usages existants (ex. si un futur appelant omet la prop).
  dragEnabled?: boolean;
};

export function VaultTreeView({
  nodes,
  depth = 0,
  theme,
  activeRelPath,
  collapsedPaths,
  onToggleCollapse,
  onOpenNote,
  rename,
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

        return (
          <Fragment key={node.relPath}>
            {insertionEdge === 'above' && (
              <View style={[styles.insertionLine, { paddingLeft: 12 + depth * 16 }]}>
                <View style={[styles.insertionLineBar, { backgroundColor: theme.accent }]} />
              </View>
            )}
            <DraggablePressable
              onPress={() => (isFolder ? onToggleCollapse(node.relPath) : onOpenNote(node))}
              dataSet={{ relpath: node.relPath }}
              style={[
                styles.row,
                { paddingLeft: 12 + depth * 16 },
                !isFolder &&
                  node.relPath === activeRelPath && { backgroundColor: `${theme.accent}22` },
                !isRenaming && dragEnabled && styles.rowDraggable,
                isDragging && styles.rowDragging,
              ]}
            >
              <Text style={styles.icon}>
                {node.type === 'folder' ? (isCollapsed ? '📁' : '📂') : NOTE_ICON_BY_KIND[node.kind]}
              </Text>
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
                collapsedPaths={collapsedPaths}
                onToggleCollapse={onToggleCollapse}
                onOpenNote={onOpenNote}
                rename={rename}
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

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingRight: 12,
  },
  icon: {
    fontSize: 14,
  },
  rowDragging: {
    opacity: 0.4,
  },
  // Simple indice visuel (RN Web transmet `cursor` tel quel) — l'attribut
  // HTML `draggable` réel est posé depuis NotesScreen.tsx, voir le
  // commentaire de `dragEnabled` ci-dessus.
  rowDraggable: {
    // Le type RN `CursorValue` n'admet que 'auto'/'pointer' — pas de
    // valeur "grab" disponible, 'pointer' reste le meilleur indice de
    // survol disponible dans ce typage.
    cursor: 'pointer',
  },
  // Hauteur 0 volontaire : le trait (insertionLineBar, en enfant) se
  // dessine par-dessus l'espacement entre deux lignes sans en changer la
  // hauteur — sinon la liste "sauterait" visuellement à chaque position
  // survolée pendant le glisser.
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
