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
import { findNodeByPath, getParentRelPath } from '../lib/vaultTree';
import { useVaults } from '../lib/sync/VaultsContext';
import { usePreferences } from '../preferences/PreferencesContext';
import { EditPathDialog } from './EditPathDialog';
import { MoveDialog } from './MoveDialog';
import { VaultTreeView } from './VaultTreeView';

// Sentinelle utilisée par le glisser-déposer pour représenter "on survole la
// racine du vault" (aucune ligne sous le curseur) — distincte de `undefined`
// (qui, lui, signifie "pas de glissement en cours").
const ROOT_DROP_ZONE = '__root__';

// Écran Notes — Phase 1 : vault local (arborescence réelle, pas juste une
// liste plate) + édition MDX avec barre de formatage personnalisable (voir
// Paramètres → Personnalisation). Pas encore de rendu enrichi/live-preview,
// voir docs/ARCHITECTURE.md §4 et la feuille de route. Le vault n'existe
// que côté Electron desktop pour l'instant (window.vault, exposé par
// apps/desktop/electron/preload.js) — sur web/mobile, cette section reste
// indisponible jusqu'à la Phase 2. Le CHEMIN du vault actif vient de
// VaultsContext (coffres multiples, voir apps/desktop/electron/vaults.js) —
// cet écran ne connaît plus que le nom du coffre actif, pas comment il est
// choisi/changé. Déplacement de fichiers/dossiers : par glisser-déposer
// (curseur, voir l'effet dragstart/dragover/drop plus bas) OU par "Déplacer
// vers…" (MoveDialog) OU par édition manuelle du chemin complet
// (EditPathDialog) — trois façons d'arriver à la même opération
// (vault:move / vault:set-path).
const AUTOSAVE_DELAY_MS = 600;

type Status = 'idle' | 'saving' | 'saved' | 'error';

// Un élément renommé/déplacé affecte la note actuellement ouverte si c'est
// lui-même cette note, ou si c'est un dossier qui la contient (un dossier
// renommé/déplacé change le relPath de tout ce qu'il contient, en cascade).
function isPathAffected(activeRelPath: string, changedOldRelPath: string): boolean {
  return activeRelPath === changedOldRelPath || activeRelPath.startsWith(`${changedOldRelPath}/`);
}

type Props = {
  // Demande d'ouverture d'une note depuis un AUTRE écran (Calendrier,
  // Canvas — voir App.tsx) : relPath à ouvrir dès que possible.
  // `onOpenedPendingNote` prévient le parent une fois fait, pour qu'il
  // remette ce champ à null (sinon rebasculer sur l'onglet Notes sans
  // passer par un autre écran redéclencherait l'ouverture en boucle).
  pendingOpenRelPath?: string | null;
  onOpenedPendingNote?: () => void;
};

export function NotesScreen({ pendingOpenRelPath, onOpenedPendingNote }: Props = {}) {
  const { preferences, theme } = usePreferences();
  const vault = typeof window !== 'undefined' ? window.vault : undefined;
  const contextMenuBridge = typeof window !== 'undefined' ? window.contextMenu : undefined;
  const { activeVaultPath: vaultPath } = useVaults();

  const [tree, setTree] = useState<VaultTreeNode[]>([]);
  const [activeNote, setActiveNote] = useState<VaultEntry | null>(null);
  const [content, setContent] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(new Set());
  const [renamingRelPath, setRenamingRelPath] = useState<string | null>(null);
  const [renamingValue, setRenamingValue] = useState('');
  const [movingNode, setMovingNode] = useState<VaultTreeNode | null>(null);
  const [editingPathNode, setEditingPathNode] = useState<VaultTreeNode | null>(null);
  const [editPathError, setEditPathError] = useState<string | null>(null);
  // État de glisser-déposer, pour l'affichage (VaultTreeView) — voir aussi
  // draggingRelPathRef ci-dessous, qui porte la même info pour la LOGIQUE
  // (évite une closure périmée dans les écouteurs DOM délégués).
  const [draggingRelPath, setDraggingRelPath] = useState<string | null>(null);
  const [dragOverRelPath, setDragOverRelPath] = useState<string | null>(null);
  const draggingRelPathRef = useRef<string | null>(null);
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
    if (!vault || !vaultPath) return;
    void (async () => {
      try {
        await refreshTree();
      } catch (error) {
        console.error('[vault] échec du chargement de l’arborescence :', error);
      }
    })();
    // refreshTree est stable (useCallback sur `vault`) : pas besoin de le
    // relancer à chaque render. Se redéclenche quand `vaultPath` change
    // (changement de coffre actif, voir VaultsContext) pour rafraîchir
    // l'arborescence affichée.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vault, vaultPath]);

  const handleChooseFolder = async () => {
    if (!vault) return;
    try {
      // Ajoute+active le dossier choisi dans le registre multi-coffres (voir
      // apps/desktop/electron/vaults.js) — `vaultPath` ci-dessus se met à
      // jour via VaultsContext une fois l'évènement `vaults:changed` reçu,
      // ce qui redéclenche l'effet ci-dessus.
      await vault.chooseFolder();
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

  // Ouvre une note demandée par un AUTRE écran (voir App.tsx,
  // `pendingOpenRelPath`) — ex. "Ouvrir la note du jour" du Calendrier, une
  // carte-note du Canvas. Relit l'arborescence directement (pas via `tree`
  // en state, qui pourrait être périmé si la note vient d'être créée par
  // l'écran appelant, ex. `vault:ensure-daily-note`) pour retrouver ses
  // vraies métadonnées ; à défaut, ouvre quand même avec un nœud minimal
  // plutôt que d'échouer silencieusement.
  useEffect(() => {
    if (!vault || !pendingOpenRelPath) return;
    void (async () => {
      try {
        const freshTree = await vault.listTree();
        setTree(freshTree);
        const found = findNodeByPath(freshTree, pendingOpenRelPath);
        const noteNode: VaultNoteNode =
          found && found.type === 'note'
            ? found
            : {
                type: 'note',
                relPath: pendingOpenRelPath,
                name: (pendingOpenRelPath.split('/').pop() ?? pendingOpenRelPath).replace(/\.mdx$/i, ''),
                modifiedAt: Date.now(),
              };
        await openNote(noteNode);
      } catch (error) {
        console.error('[vault] échec de l’ouverture demandée :', error);
      } finally {
        onOpenedPendingNote?.();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vault, pendingOpenRelPath]);

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

  // Effet commun à "Déplacer vers…" (MoveDialog) ET au glisser-déposer —
  // même opération, deux façons de choisir la destination.
  const performMove = useCallback(
    async (node: VaultTreeNode, destinationRelPath?: string) => {
      if (!vault) return;
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
    [vault, refreshTree],
  );

  const submitMove = useCallback(
    async (destinationRelPath?: string) => {
      if (!movingNode) return;
      const node = movingNode;
      setMovingNode(null);
      await performMove(node, destinationRelPath);
    },
    [movingNode, performMove],
  );

  const startEditPath = useCallback((node: VaultTreeNode) => {
    setEditPathError(null);
    setEditingPathNode(node);
  }, []);

  const cancelEditPath = useCallback(() => {
    setEditingPathNode(null);
    setEditPathError(null);
  }, []);

  const submitEditPath = useCallback(
    async (newRelPath: string) => {
      if (!vault || !editingPathNode) return;
      const node = editingPathNode;
      try {
        const result = await vault.setPath(node.relPath, newRelPath);
        // Fermé seulement en cas de SUCCÈS — en cas d'erreur (collision,
        // chemin invalide...), la boîte reste ouverte avec le message pour
        // que l'utilisatrice puisse corriger sans tout retaper.
        setEditingPathNode(null);
        setEditPathError(null);
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
        console.error('[vault] échec de la modification du chemin :', error);
        setEditPathError(error instanceof Error ? error.message : String(error));
      }
    },
    [vault, editingPathNode, refreshTree],
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
              { id: 'edit-path', label: 'Modifier le chemin' },
            ]
          : [
              { id: 'rename', label: 'Renommer' },
              { id: 'move', label: 'Déplacer vers…' },
              { id: 'edit-path', label: 'Modifier le chemin' },
            ];

      void contextMenuBridge.show(items).then((choice) => {
        if (choice === 'new-note') void handleCreateNote();
        if (choice === 'new-folder') void handleCreateFolder();
        if (node && choice === 'new-note-here') void handleCreateNote(node.relPath);
        if (node && choice === 'new-folder-here') void handleCreateFolder(node.relPath);
        if (node && choice === 'rename') startRename(node);
        if (node && choice === 'move') startMove(node);
        if (node && choice === 'edit-path') startEditPath(node);
      });
    },
    [contextMenuBridge, handleCreateNote, handleCreateFolder, startRename, startMove, startEditPath],
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

  // Glisser-déposer réel (curseur), même mécanisme de délégation que le clic
  // droit ci-dessus : un seul jeu d'écouteurs DOM (dragstart/dragover/drop/
  // dragend) sur le conteneur de la liste plutôt qu'un handler par ligne —
  // chaque ligne porte juste `draggable` (voir VaultTreeView.tsx) et son
  // `data-relpath`. `draggingRelPathRef` (pas seulement le state) sert de
  // source de vérité à la logique : cet effet ne se re-crée qu'au
  // changement de `tree`/`vault`, donc les closures ci-dessous figeraient
  // une valeur périmée du state `draggingRelPath` si on le lisait
  // directement — la ref, elle, reste toujours à jour.
  useEffect(() => {
    const container = listAreaRef.current as unknown as HTMLElement | null;
    if (!container || !vault) return;

    // Un dossier ne peut pas être déposé dans lui-même ni dans l'un de ses
    // propres sous-dossiers — vault:move le refuserait de toute façon, mais
    // le vérifier ici aussi évite d'afficher un survol "valide" (bordure
    // d'accentuation) pour une destination qui sera de toute façon rejetée.
    const isSelfOrDescendant = (folderRelPath: string, candidateRelPath?: string) =>
      candidateRelPath !== undefined &&
      (candidateRelPath === folderRelPath || candidateRelPath.startsWith(`${folderRelPath}/`));

    // Déposer sur une NOTE = déposer dans le dossier qui la contient (une
    // note n'est pas un dossier valide) ; déposer dans le vide (aucune ligne
    // sous le curseur, mais toujours dans le conteneur de la liste) =
    // déposer à la racine du vault. Retourne null si la cible n'est pas une
    // destination valide pour `draggedRelPath` — pris en paramètre plutôt
    // que lu depuis `draggingRelPathRef` ici : `handleDrop` a besoin
    // d'appeler ceci APRÈS avoir déjà remis la ref à null (pour ne pas
    // laisser un état de glissement "collé" si l'event se termine mal), donc
    // lire la ref à l'intérieur donnerait une valeur périmée à ce moment-là.
    const resolveDropTarget = (
      event: DragEvent,
      draggedRelPath: string | null,
    ): { destinationRelPath?: string; label: string } | null => {
      const target = event.target as HTMLElement | null;
      const rowEl = target?.closest ? (target.closest('[data-relpath]') as HTMLElement | null) : null;
      const hoveredRelPath = rowEl?.getAttribute('data-relpath') ?? null;

      const resolved = !hoveredRelPath
        ? { destinationRelPath: undefined, label: ROOT_DROP_ZONE }
        : (() => {
            const node = findNodeByPath(tree, hoveredRelPath);
            if (!node) return null;
            if (node.type === 'folder') return { destinationRelPath: node.relPath, label: node.relPath };
            const parent = getParentRelPath(node.relPath);
            return { destinationRelPath: parent, label: parent ?? ROOT_DROP_ZONE };
          })();
      if (!resolved) return null;

      const draggedNode = draggedRelPath ? findNodeByPath(tree, draggedRelPath) : null;
      if (draggedNode?.type === 'folder' && isSelfOrDescendant(draggedNode.relPath, resolved.destinationRelPath)) {
        return null;
      }
      return resolved;
    };

    const handleDragStart = (event: DragEvent) => {
      const target = event.target as HTMLElement | null;
      const rowEl = target?.closest ? (target.closest('[data-relpath]') as HTMLElement | null) : null;
      const relPath = rowEl?.getAttribute('data-relpath') ?? null;
      if (!relPath) {
        event.preventDefault();
        return;
      }
      event.dataTransfer?.setData('text/plain', relPath);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
      draggingRelPathRef.current = relPath;
      setDraggingRelPath(relPath);
    };

    const handleDragOver = (event: DragEvent) => {
      if (!draggingRelPathRef.current) return;
      // Nécessaire pour autoriser le drop (comportement par défaut du
      // navigateur : refuser) — voir MDN sur l'API HTML5 Drag and Drop.
      event.preventDefault();
      const target = resolveDropTarget(event, draggingRelPathRef.current);
      setDragOverRelPath(target ? target.label : null);
    };

    const handleDrop = (event: DragEvent) => {
      event.preventDefault();
      const dragRelPath = draggingRelPathRef.current;
      draggingRelPathRef.current = null;
      setDraggingRelPath(null);
      setDragOverRelPath(null);
      if (!dragRelPath) return;

      const draggedNode = findNodeByPath(tree, dragRelPath);
      const target = resolveDropTarget(event, dragRelPath);
      if (!draggedNode || !target) return;
      void performMove(draggedNode, target.destinationRelPath);
    };

    const handleDragEnd = () => {
      draggingRelPathRef.current = null;
      setDraggingRelPath(null);
      setDragOverRelPath(null);
    };

    container.addEventListener('dragstart', handleDragStart);
    container.addEventListener('dragover', handleDragOver);
    container.addEventListener('drop', handleDrop);
    container.addEventListener('dragend', handleDragEnd);
    return () => {
      container.removeEventListener('dragstart', handleDragStart);
      container.removeEventListener('dragover', handleDragOver);
      container.removeEventListener('drop', handleDrop);
      container.removeEventListener('dragend', handleDragEnd);
    };
  }, [vault, tree, performMove]);

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
        style={[
          styles.list,
          { borderColor: theme.border, backgroundColor: theme.surface },
          dragOverRelPath === ROOT_DROP_ZONE && { borderColor: theme.accent, borderWidth: 2 },
        ]}
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
            draggingRelPath={draggingRelPath}
            dragOverRelPath={dragOverRelPath}
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

      <EditPathDialog
        key={editingPathNode?.relPath ?? 'closed'}
        node={editingPathNode}
        theme={theme}
        error={editPathError}
        onSubmit={(newRelPath) => void submitEditPath(newRelPath)}
        onCancel={cancelEditPath}
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
