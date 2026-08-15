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
import { usePreferences } from '../preferences/PreferencesContext';
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

// Un élément renommé affecte la note actuellement ouverte si c'est lui-même
// cette note, ou si c'est un dossier qui la contient (renommer un dossier
// change le relPath de tout ce qu'il contient, en cascade).
function renameAffectsPath(activeRelPath: string, renamedOldRelPath: string): boolean {
  return activeRelPath === renamedOldRelPath || activeRelPath.startsWith(`${renamedOldRelPath}/`);
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
      await vault.rename(relPath, value);
      if (activeNote && renameAffectsPath(activeNote.relPath, relPath)) {
        // Le chemin de la note ouverte a changé (elle-même renommée, ou un
        // dossier parent renommé qui la fait "bouger" en cascade) — on
        // ferme l'éditeur plutôt que de risquer d'écrire sur un chemin
        // périmé. Il suffit de recliquer la note dans l'arborescence
        // rafraîchie.
        setActiveNote(null);
        setContent('');
      }
      await refreshTree();
    } catch (error) {
      console.error('[vault] échec du renommage :', error);
    }
  }, [vault, renamingRelPath, renamingValue, activeNote, refreshTree]);

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

  const handleContextMenuNode = useCallback(
    (node: VaultTreeNode) => {
      if (!contextMenuBridge) return;
      const items =
        node.type === 'folder'
          ? [
              { id: 'new-note-here', label: 'Nouvelle note ici' },
              { id: 'new-folder-here', label: 'Nouveau dossier ici' },
              { id: 'rename', label: 'Renommer' },
            ]
          : [{ id: 'rename', label: 'Renommer' }];

      void contextMenuBridge.show(items).then((choice) => {
        if (choice === 'new-note-here') void handleCreateNote(node.relPath);
        if (choice === 'new-folder-here') void handleCreateFolder(node.relPath);
        if (choice === 'rename') startRename(node);
      });
    },
    [contextMenuBridge, handleCreateNote, handleCreateFolder, startRename],
  );

  // Clic droit dans le fond de la liste (pas sur un dossier/note précis) →
  // création à la racine du vault. Attaché en DOM direct (via le ref de la
  // View, qui pointe vers un vrai élément DOM sous react-native-web)
  // plutôt que via une prop RN — View n'a pas d'équivalent onContextMenu.
  // Les lignes de VaultTreeView stoppent la propagation de leur propre
  // clic droit, donc celui-ci ne se déclenche que pour un clic sur le fond.
  useEffect(() => {
    const node = listAreaRef.current as unknown as HTMLElement | null;
    if (!node || !contextMenuBridge) return;

    const handler = (event: MouseEvent) => {
      event.preventDefault();
      void contextMenuBridge
        .show([
          { id: 'new-note', label: 'Nouvelle note' },
          { id: 'new-folder', label: 'Nouveau dossier' },
        ])
        .then((choice) => {
          if (choice === 'new-note') void handleCreateNote();
          if (choice === 'new-folder') void handleCreateFolder();
        });
    };

    node.addEventListener('contextmenu', handler);
    return () => node.removeEventListener('contextmenu', handler);
    // Dépend de vaultPath : c'est ce qui détermine si la liste (donc le
    // nœud référencé) est effectivement montée — vault seul ne change pas
    // quand on passe de "pas de vault" à "vault choisi".
  }, [vaultPath, contextMenuBridge, handleCreateNote, handleCreateFolder]);

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
            onContextMenuNode={handleContextMenuNode}
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
              <Text style={[styles.editorTitle, { color: theme.text }]}>{activeNote.name}</Text>
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
