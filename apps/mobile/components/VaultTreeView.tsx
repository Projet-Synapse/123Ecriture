import { Fragment } from 'react';
import { Pressable, StyleSheet, Text, TextInput } from 'react-native';

import type { Theme } from '../theme';

// Rendu récursif de l'arborescence du vault (dossiers + notes). Composant
// purement présentationnel : toutes les données (arbre, sélection en cours,
// dossiers repliés, état de renommage) et les actions vivent dans
// NotesScreen — ce fichier ne fait qu'afficher et relayer les événements,
// pour ne pas éparpiller la logique métier vault entre deux fichiers.

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
  onContextMenuNode: (node: VaultTreeNode) => void;
  rename: RenameState | null;
};

export function VaultTreeView({
  nodes,
  depth = 0,
  theme,
  activeRelPath,
  collapsedPaths,
  onToggleCollapse,
  onOpenNote,
  onContextMenuNode,
  rename,
}: Props) {
  return (
    <>
      {nodes.map((node) => {
        const isRenaming = rename?.relPath === node.relPath;
        const isFolder = node.type === 'folder';
        const isCollapsed = isFolder && collapsedPaths.has(node.relPath);

        return (
          <Fragment key={node.relPath}>
            <Pressable
              onPress={() => (isFolder ? onToggleCollapse(node.relPath) : onOpenNote(node))}
              // @ts-expect-error — onContextMenu (DOM) n'est pas dans les types RN,
              // mais react-native-web le transmet bien au <div> sous-jacent.
              onContextMenu={(event: MouseEvent) => {
                event.preventDefault();
                // Empêche le clic droit de "remonter" jusqu'au conteneur
                // (qui a son propre menu contextuel pour le fond de liste,
                // voir NotesScreen) — sinon les deux menus se déclenchent.
                event.stopPropagation();
                onContextMenuNode(node);
              }}
              style={[
                styles.row,
                { paddingLeft: 12 + depth * 16 },
                !isFolder &&
                  node.relPath === activeRelPath && { backgroundColor: `${theme.accent}22` },
              ]}
            >
              <Text style={styles.icon}>{isFolder ? (isCollapsed ? '📁' : '📂') : '📝'}</Text>
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
            </Pressable>
            {isFolder && !isCollapsed && (
              <VaultTreeView
                nodes={node.children}
                depth={depth + 1}
                theme={theme}
                activeRelPath={activeRelPath}
                collapsedPaths={collapsedPaths}
                onToggleCollapse={onToggleCollapse}
                onOpenNote={onOpenNote}
                onContextMenuNode={onContextMenuNode}
                rename={rename}
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
  renameInput: {
    flex: 1,
    borderBottomWidth: 1,
    paddingVertical: 2,
    fontSize: 14,
  },
});
