import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import type { FormattingResult, Selection } from '../lib/mdxFormatting';
import { NOTES_TOOLBAR_ACTIONS, type ToolbarAction } from '../lib/notesToolbarActions';
import { findNodeByPath } from '../lib/vaultTree';
import { usePreferences } from '../preferences/PreferencesContext';
import { MoveDialog } from './MoveDialog';
import { VaultTreeView } from './VaultTreeView';

// Écran Notes — Phase 1 : vault local (arborescence réelle, pas juste une
// liste plate) + édition MDX avec barre de formatage personnalisable (voir
// Paramètres → Personnalisation). Pas encore de rendu enrichi/live-preview,
// voir docs/ARCHITECTURE.md §4 et la feuille de route. Le vault n'existe
// que côté Electron desktop pour l'instant (window.vault, exposé par
// apps/desktop/electron/preload.js) — sur web/mobile, cette section reste
// indisponible jusqu'à la Phase 2.
const AUTOSAVE_DELAY_MS = 600;

type Status = 'idle' | 'saving' | 'saved' | 'error';

// Un élément renommé/déplacé affecte la note actuellement ouverte si c'est
// lui-même cette note, ou si c'est un dossier qui la contient (un dossier
// renommé/déplacé change le relPath de tout ce qu'il contient, en cascade).
function isPathAffected(activeRelPath: string, changedOldRelPath: string): boolean {
  return activeRelPath === changedOldRelPath || activeRelPath.startsWith(`${changedOldRelPath}/`);
}

export function NotesScreen() {
  const { preferences, theme } = usePreferences();
  const vault = typeof window !== 'undefined' ? window.vault : undefined;
  const contextMenuBridge = typeof window !== 'undefined' ? window.contextMenu : undefined;

  const [vaultPath, setVaultPath] = useState<string | null>(null);
  const [tree, setTree] = useState<VaultTreeNode[]>([]);
  const [activeNote, setActiveNote] = useState<VaultEntry | null>(null);
  const [content, setContent] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(new Set());
  const [renamingRelPath, setRenamingRelPath] = useState<string | null>(null);
  const [renamingValue, setRenamingValue] = useState('');
  const [movingNode, setMovingNode] = useState<VaultTreeNode | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listAreaRef = useRef<View>(null);

  // Sélection courante de l'éditeur — en ref (pas en state) pour ne pas
  // re-render à chaque déplacement de curseur. `forcedSelection` sert
  // uniquement à repositionner le curseur juste après une action de la
  // barre d'outils (voir applyFormatting) ; elle est relâchée aussitôt
  // après pour laisser la frappe normale non contrôlée — un TextInput dont
  // la prop `selection` reste en permanence contrôlée fait sauter le
  // curseur pendant la frappe (piège classique React Native).
  const selectionRef = useRef<Selection>({ start: 0, end: 0 });
  const [forcedSelection, setForcedSelection] = useState<Selection | undefined>(undefined);
  const inputRef = useRef<TextInput>(null);

  const toolbarActions: ToolbarAction[] = preferences.notesToolbarOrder
    .filter((item) => item.visible)
    .map((item) => NOTES_TOOLBAR_ACTIONS.find((action) => action.id === item.id))
    .filter((action): action is ToolbarAction => Boolean(action));

  const refreshTree = useCallback(async () => {
    if (!vault) return;
    setTree(await vault.listTree());
  }, [vault]);

  useEffect(() => {
    if (!vault) return;
    void (async () => {
      try {
        const current = await vault.getCurrentPath();
        setVaultPath(current);
        if (current) await refreshTree();
      } catch (error) {
        console.error('[vault] échec du chargement initial :', error);
      }
    })();
    // refreshTree est stable (useCallback sur `vault`) : pas besoin de le
    // relancer à chaque render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vault]);

  const handleChooseFolder = async () => {
    if (!vault) return;
    try {
      const chosen = await vault.chooseFolder();
      setVaultPath(chosen);
      if (chosen) await refreshTree();
    } catch (error) {
      console.error('[vault] échec du choix de dossier :', error);
    }
  };

  const openNote = useCallback(
    async (node: VaultNoteNode) => {
      if (!vault) return;
      try {
        const text = await vault.readNote(node.relPath);
        setActiveNote(node);
        setContent(text);
        setStatus('idle');
        selectionRef.current = { start: text.length, end: text.length };
      } catch (error) {
        console.error('[vault] échec de lecture de la note :', error);
        setStatus('error');
      }
    },
    [vault],
  );

  const handleCreateNote = useCallback(
    async (parentRelPath?: string) => {
      if (!vault) return;
      try {
        const entry = await vault.createNote('Sans titre', parentRelPath);
        await refreshTree();
        await openNote({ type: 'note', ...entry });
      } catch (error) {
        console.error('[vault] échec de création de la note :', error);
      }
    },
    [vault, refreshTree, openNote],
  );

  const handleCreateFolder = useCallback(
    async (parentRelPath?: string) => {
      if (!vault) return;
      try {
        await vault.createFolder('Nouveau dossier', parentRelPath);
        await refreshTree();
      } catch (error) {
        console.error('[vault] échec de création du dossier :', error);
      }
    },
    [vault, refreshTree],
  );

  const startRename = useCallback((node: VaultTreeNode) => {
    setRenamingRelPath(node.relPath);
    setRenamingValue(node.name);
  }, []);

  const cancelRename = useCallback(() => {
    setRenamingRelPath(null);
    setRenamingValue('');
  }, []);

  const submitRename = useCallback(async () => {
    if (!vault || !renamingRelPath) return;
    const relPath = renamingRelPath;
    const value = renamingValue;
    // Relâche l'état de renommage tout de suite (avant l'appel async) :
    // évite un double-submit si onBlur et onSubmitEditing se déclenchent
    // tous les deux pour la même validation.
    setRenamingRelPath(null);
    setRenamingValue('');

    try {
      const result = await vault.rename(relPath, value);
      setActiveNote((current) => {
        if (!current) return current;
        if (current.relPath === relPath) {
          // La note ouverte est exactement l'élément renommé : on continue
          // à l'éditer sous son nouveau nom plutôt que de fermer l'éditeur.
          return { ...current, relPath: result.relPath, name: result.name };
        }
        if (isPathAffected(current.relPath, relPath)) {
          // Un dossier PARENT de la note ouverte a été renommé : le
          // relPath de la note change en cascade, mais on ne le connaît
          // pas précisément ici — on ferme plutôt que de risquer d'écrire
          // sur un chemin périmé. Il suffit de recliquer la note.
          setContent('');
          return null;
        }
        return current;
      });
      await refreshTree();
    } catch (error) {
      console.error('[vault] échec du renommage :', error);
    }
  }, [vault, renamingRelPath, renamingValue, refreshTree]);

  const startMove = useCallback((node: VaultTreeNode) => {
    setMovingNode(node);
  }, []);

  const cancelMove = useCallback(() => setMovingNode(null), []);

  const submitMove = useCallback(
    async (destinationRelPath?: string) => {
      if (!vault || !movingNode) return;
      const node = movingNode;
      setMovingNode(null);

      try {
        const result = await vault.move(node.relPath, destinationRelPath);
        setActiveNote((current) => {
          if (!current) return current;
          if (current.relPath === node.relPath) {
            return { ...current, relPath: result.relPath, name: result.name };
          }
          if (isPathAffected(current.relPath, node.relPath)) {
            setContent('');
            return null;
          }
          return current;
        });
        await refreshTree();
      } catch (error) {
        console.error('[vault] échec du déplacement :', error);
      }
    },
    [vault, movingNode, refreshTree],
  );

  const toggleCollapse = useCallback((relPath: string) => {
    setCollapsedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(relPath)) {
        next.delete(relPath);
      } else {
        next.add(relPath);
      }
      return next;
    });
  }, []);

  const showContextMenuFor = useCallback(
    (node: VaultTreeNode | null) => {
      if (!contextMenuBridge) return;
      const items = !node
        ? [
            { id: 'new-note', label: 'Nouvelle note' },
            { id: 'new-folder', label: 'Nouveau dossier' },
          ]
        : node.type === 'folder'
          ? [
              { id: 'new-note-here', label: 'Nouvelle note ici' },
              { id: 'new-folder-here', label: 'Nouveau dossier ici' },
              { id: 'rename', label: 'Renommer' },
              { id: 'move', label: 'Déplacer vers…' },
            ]
          : [
              { id: 'rename', label: 'Renommer' },
              { id: 'move', label: 'Déplacer vers…' },
            ];

      void contextMenuBridge.show(items).then((choice) => {
        if (choice === 'new-note') void handleCreateNote();
        if (choice === 'new-folder') void handleCreateFolder();
        if (node && choice === 'new-note-here') void handleCreateNote(node.relPath);
        if (node && choice === 'new-folder-here') void handleCreateFolder(node.relPath);
        if (node && choice === 'rename') startRename(node);
        if (node && choice === 'move') startMove(node);
      });
    },
    [contextMenuBridge, handleCreateNote, handleCreateFolder, startRename, startMove],
  );

  // Un seul écouteur "contextmenu" délégué sur tout le conteneur de la
  // liste, plutôt qu'un handler par ligne : chaque ligne de VaultTreeView
  // porte juste un attribut data-relpath (voir dataSet), et on retrouve ici
  // quel élément précis a été visé via closest(). Passer onContextMenu
  // directement à un Pressable par ligne ne fonctionnait pas de façon
  // fiable (pas une prop RN officielle) — la délégation sur un seul nœud
  // DOM est un mécanisme bien plus robuste et déjà éprouvé (c'est ce qui
  // gérait déjà le clic droit "dans le vide").
  useEffect(() => {
    const container = listAreaRef.current as unknown as HTMLElement | null;
    if (!container || !contextMenuBridge) return;

    const handler = (event: MouseEvent) => {
      event.preventDefault();
      const target = event.target as HTMLElement | null;
      const rowEl = target?.closest ? (target.closest('[data-relpath]') as HTMLElement | null) : null;
      const relPath = rowEl?.getAttribute('data-relpath') ?? null;
      const node = relPath ? findNodeByPath(tree, relPath) : null;
      showContextMenuFor(node);
    };

    container.addEventListener('contextmenu', handler);
    return () => container.removeEventListener('contextmenu', handler);
  }, [vaultPath, tree, contextMenuBridge, showContextMenuFor]);

  const scheduleSave = useCallback(
    (text: string) => {
      if (!vault || !activeNote) return;
      setStatus('saving');
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        void (async () => {
          try {
            await vault.writeNote(activeNote.relPath, text);
            setStatus('saved');
            await refreshTree();
          } catch (error) {
            console.error('[vault] échec de sauvegarde :', error);
            setStatus('error');
          }
        })();
      }, AUTOSAVE_DELAY_MS);
    },
    [vault, activeNote, refreshTree],
  );

  const handleChangeContent = (text: string) => {
    setContent(text);
    scheduleSave(text);
  };

  const applyFormatting = (run: (text: string, selection: Selection) => FormattingResult) => {
    const result = run(content, selectionRef.current);
    setContent(result.text);
    scheduleSave(result.text);
    selectionRef.current = result.selection;
    setForcedSelection(result.selection);
    inputRef.current?.focus();
    setTimeout(() => setForcedSelection(undefined), 0);
  };

  if (!vault) {
    return (
      <View style={styles.centered}>
        <Text style={[styles.title, { color: theme.text }]}>📝 Notes</Text>
        <Text style={[styles.muted, { color: theme.textMuted }]}>
          Le vault local n’est disponible que sur la version desktop pour l’instant (Phase 2 pour
          mobile/web).
        </Text>
      </View>
    );
  }

  if (!vaultPath) {
    return (
      <View style={styles.centered}>
        <Text style={[styles.title, { color: theme.text }]}>📝 Notes</Text>
        <Text style={[styles.muted, { color: theme.textMuted }]}>
          Choisis un dossier local pour en faire ton vault.
        </Text>
        <Pressable
          onPress={() => void handleChooseFolder()}
          style={[styles.button, { backgroundColor: theme.accent }]}
        >
          <Text style={styles.buttonText}>Choisir un dossier</Text>
        </Pressable>
      </View>
    );
  }

  const activeNoteIsRenaming = activeNote !== null && renamingRelPath === activeNote.relPath;

  return (
    <View style={styles.row}>
      <View
        ref={listAreaRef}
        style={[styles.list, { borderColor: theme.border, backgroundColor: theme.surface }]}
      >
        <View style={styles.listHeader}>
          <Text style={[styles.vaultPath, { color: theme.textMuted }]} numberOfLines={1}>
            {vaultPath}
          </Text>
          <Pressable
            onPress={() => void handleCreateNote()}
            style={[styles.newButton, { backgroundColor: theme.accent }]}
          >
            <Text style={styles.buttonText}>+ Nouvelle note</Text>
          </Pressable>
        </View>
        <ScrollView>
          <VaultTreeView
            nodes={tree}
            theme={theme}
            activeRelPath={activeNote?.relPath}
            collapsedPaths={collapsedPaths}
            onToggleCollapse={toggleCollapse}
            onOpenNote={(node) => void openNote(node)}
            rename={
              renamingRelPath
                ? {
                    relPath: renamingRelPath,
                    value: renamingValue,
                    onChangeValue: setRenamingValue,
                    onSubmit: () => void submitRename(),
                    onCancel: cancelRename,
                  }
                : null
            }
          />
          {tree.length === 0 && (
            <Text style={[styles.muted, { color: theme.textMuted, padding: 16 }]}>
              Aucune note pour l’instant. Clic droit ici pour en créer une.
            </Text>
          )}
        </ScrollView>
      </View>
      <View style={styles.editor}>
        {activeNote ? (
          <>
            <View style={styles.editorHeader}>
              {activeNoteIsRenaming ? (
                <TextInput
                  autoFocus
                  value={renamingValue}
                  onChangeText={setRenamingValue}
                  onSubmitEditing={() => void submitRename()}
                  onBlur={() => void submitRename()}
                  onKeyPress={(event) => {
                    if (event.nativeEvent.key === 'Escape') cancelRename();
                  }}
                  style={[styles.editorTitleInput, { color: theme.text, borderColor: theme.accent }]}
                />
              ) : (
                <Pressable onPress={() => startRename({ type: 'note', ...activeNote })}>
                  <Text style={[styles.editorTitle, { color: theme.text }]}>{activeNote.name}</Text>
                </Pressable>
              )}
              <Text style={[styles.status, { color: theme.textMuted }]}>
                {status === 'saving' && 'Enregistrement…'}
                {status === 'saved' && 'Enregistré'}
                {status === 'error' && '⚠️ Échec de la sauvegarde'}
              </Text>
            </View>
            {toolbarActions.length > 0 && (
              <View style={[styles.toolbar, { borderColor: theme.border }]}>
                {toolbarActions.map((action) => (
                  <Pressable
                    key={action.id}
                    onPress={() => applyFormatting(action.run)}
                    style={[styles.toolbarButton, { backgroundColor: theme.surface }]}
                  >
                    <Text style={[styles.toolbarButtonText, { color: theme.text }]}>
                      {action.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}
            <TextInput
              ref={inputRef}
              multiline
              value={content}
              onChangeText={handleChangeContent}
              onSelectionChange={(event) => {
                selectionRef.current = event.nativeEvent.selection;
              }}
              selection={forcedSelection}
              style={[styles.textArea, { color: theme.text }]}
              placeholder="Écris en MDX ici…"
              placeholderTextColor={theme.textMuted}
              textAlignVertical="top"
            />
          </>
        ) : (
          <View style={styles.centered}>
            <Text style={[styles.muted, { color: theme.textMuted }]}>
              Sélectionne ou crée une note.
            </Text>
          </View>
        )}
      </View>

      <MoveDialog
        node={movingNode}
        tree={tree}
        theme={theme}
        onSelect={(destination) => void submitMove(destination)}
        onCancel={cancelMove}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flex: 1,
    flexDirection: 'row',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 12,
  },
  title: {
    fontSize: 22,
    fontWeight: '600',
  },
  muted: {
    fontSize: 14,
    textAlign: 'center',
    maxWidth: 360,
  },
  button: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
  },
  list: {
    width: 260,
    borderRightWidth: 1,
  },
  listHeader: {
    padding: 12,
    gap: 8,
  },
  vaultPath: {
    fontSize: 11,
  },
  newButton: {
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  editor: {
    flex: 1,
  },
  editorHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
  },
  editorTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  editorTitleInput: {
    fontSize: 16,
    fontWeight: '600',
    borderBottomWidth: 1,
    minWidth: 160,
    paddingVertical: 2,
  },
  status: {
    fontSize: 12,
  },
  toolbar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingHorizontal: 12,
    paddingBottom: 10,
    borderBottomWidth: 1,
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
  textArea: {
    flex: 1,
    padding: 16,
    fontSize: 15,
    lineHeight: 22,
  },
});
