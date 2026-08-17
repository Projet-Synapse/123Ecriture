import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { EditorView, type ReactCodeMirrorRef } from '@uiw/react-codemirror';

import type { FormattingResult, Selection } from '../lib/mdxFormatting';
import { NOTES_TOOLBAR_ACTIONS, type ToolbarAction } from '../lib/notesToolbarActions';
import { findNodeByPath, flattenNotes, getChildrenAt, getParentRelPath } from '../lib/vaultTree';
import { useVaults } from '../lib/sync/VaultsContext';
import { usePreferences } from '../preferences/PreferencesContext';
import { CanvasEditor } from './CanvasEditor';
import { ChartEditor } from './ChartEditor';
import { EditorToolbar } from './EditorToolbar';
import { EditPathDialog } from './EditPathDialog';
import { MdxEditor } from './MdxEditor';
import { MoveDialog } from './MoveDialog';
import { NoteRenderer } from './NoteRenderer';
import { OccurrencesPanel } from './OccurrencesPanel';
import { PropertiesPanel } from './PropertiesPanel';
import { RightSidebar, type SidebarTab } from './RightSidebar';
import { SearchDialog } from './SearchDialog';
import { VaultTreeView } from './VaultTreeView';

// Trois modes d'affichage d'une note — "Source" (CodeMirror nu, texte brut,
// façon éditeur de code), "Intermédiaire" (même éditeur CodeMirror + le
// `ViewPlugin` de lib/mdxLivePreview.ts : VRAI Live Preview inline façon
// Obsidian — gras/italique/titres stylés et marqueurs masqués, liens/tags/
// occurrences/embeds en pastilles cliquables, tout révélé en brut quand le
// curseur est dedans), "Aperçu" (rendu Markdown complet en lecture seule,
// NoteRenderer). Les deux premiers modes sont le MÊME composant
// (MdxEditor.tsx) avec `livePreview` activé ou non — pas deux widgets
// séparés à synchroniser.
type ViewMode = 'source' | 'split' | 'reading';

// Écran Notes — Phase 1 : vault local (arborescence réelle, pas juste une
// liste plate) + édition MDX avec barre de formatage personnalisable (voir
// Paramètres → Personnalisation) + rendu Markdown réel (voir
// docs/ARCHITECTURE.md §4). Le vault n'existe
// que côté Electron desktop pour l'instant (window.vault, exposé par
// apps/desktop/electron/preload.js) — sur web/mobile, cette section reste
// indisponible jusqu'à la Phase 2. Le CHEMIN du vault actif vient de
// VaultsContext (coffres multiples, voir apps/desktop/electron/vaults.js) —
// cet écran ne connaît plus que le nom du coffre actif, pas comment il est
// choisi/changé. Changer de DOSSIER PARENT : par "Déplacer vers…"
// (MoveDialog) ou par édition manuelle du chemin complet (EditPathDialog).
// Le glisser-déposer (curseur, voir l'effet dragstart/dragover/drop plus
// bas), lui, ne fait QUE réordonner manuellement les éléments entre eux
// (parmi leurs frères, même dossier parent) — pas changer de dossier, voir
// vault:reorder dans apps/desktop/electron/vault.js.
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
  const [viewMode, setViewMode] = useState<ViewMode>(preferences.editorDefaultMode);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [wikilinkNotice, setWikilinkNotice] = useState<string | null>(null);
  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(new Set());
  const [renamingRelPath, setRenamingRelPath] = useState<string | null>(null);
  const [renamingValue, setRenamingValue] = useState('');
  const [movingNode, setMovingNode] = useState<VaultTreeNode | null>(null);
  const [editingPathNode, setEditingPathNode] = useState<VaultTreeNode | null>(null);
  const [editPathError, setEditPathError] = useState<string | null>(null);
  // Barre latérale droite (Propriétés/Occurrences, voir RightSidebar.tsx) —
  // repliée par défaut, un seul état partagé pour tous les types de fichier
  // (markdown/canvas/chart) plutôt qu'un état par kind, puisqu'elle vit à
  // côté du contenu quel qu'il soit.
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('properties');
  // Recherche globale (voir SearchDialog.tsx) — modale indépendante de
  // `activeNote`, contrairement à sidebarOpen/sidebarTab qui n'ont de sens
  // qu'avec une note ouverte.
  const [searchOpen, setSearchOpen] = useState(false);
  // Dictionnaire personnel des {{occurrences}} — chargé une fois ici (pas
  // dans OccurrencesPanel/NoteRenderer/MdxEditor séparément) puisque les
  // TROIS en ont besoin : NoteRenderer pour savoir quelles {{...}} styler
  // en pastille, MdxEditor pour la future autocomplétion, OccurrencesPanel
  // pour la gestion elle-même. `refreshOccurrences` est repassé à
  // OccurrencesPanel pour qu'il puisse déclencher un nouveau chargement
  // après une création/un renommage/une suppression (pas de `onChanged`
  // poussé par le main process pour ce module, comme calendar.js — voir
  // occurrences.js — plus simple de re-tirer la liste après chaque
  // mutation locale).
  const occurrencesBridge = typeof window !== 'undefined' ? window.occurrences : undefined;
  const [occurrenceEntries, setOccurrenceEntries] = useState<OccurrenceEntry[]>([]);
  const [focusedOccurrenceWord, setFocusedOccurrenceWord] = useState<string | null>(null);
  // État de glisser-pour-réordonner, pour l'affichage (VaultTreeView) — voir
  // aussi draggingRelPathRef ci-dessous, qui porte la même info pour la
  // LOGIQUE (évite une closure périmée dans les écouteurs DOM délégués).
  // `dragOverInsertion` : sur quelle ligne FRÈRE de l'élément glissé
  // afficher le trait d'insertion, et de quel côté (au-dessus/en dessous).
  const [draggingRelPath, setDraggingRelPath] = useState<string | null>(null);
  const [dragOverInsertion, setDragOverInsertion] = useState<{ relPath: string; edge: 'above' | 'below' } | null>(
    null,
  );
  const draggingRelPathRef = useRef<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listAreaRef = useRef<View>(null);

  // Référence vers l'EditorView CodeMirror actif (voir MdxEditor.tsx,
  // prop `onReady`) — permet de dispatcher des transactions (barre
  // d'outils, pièce jointe) directement dessus. Contrairement à l'ancien
  // `TextInput`, CodeMirror gère nativement la sélection courante dans son
  // propre état (`view.state.selection`) : plus besoin de la dupliquer dans
  // un ref/state React ni de la "forcer" après coup.
  const viewRef = useRef<EditorView | null>(null);

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

  const refreshOccurrences = useCallback(async () => {
    if (!occurrencesBridge) return;
    setOccurrenceEntries(await occurrencesBridge.list());
  }, [occurrencesBridge]);

  useEffect(() => {
    if (!occurrencesBridge || !vaultPath) return;
    void (async () => {
      try {
        await refreshOccurrences();
      } catch (error) {
        console.error('[occurrences] échec du chargement initial :', error);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [occurrencesBridge, vaultPath]);

  const knownOccurrenceWords = useMemo(
    () => new Set(occurrenceEntries.map((entry) => entry.word.toLowerCase())),
    [occurrenceEntries],
  );
  const occurrenceWordList = useMemo(() => occurrenceEntries.map((entry) => entry.word), [occurrenceEntries]);

  // Créer un mot à la volée depuis l'autocomplétion `{{` (voir
  // MdxEditor.tsx/lib/occurrenceAutocomplete.ts) — même bridge que
  // OccurrencesPanel, mais déclenché depuis l'éditeur plutôt que le
  // panneau ; on rafraîchit ensuite la liste partagée pour que la pastille
  // apparaisse dès la frappe suivante.
  const handleCreateOccurrence = useCallback(
    async (word: string) => {
      if (!occurrencesBridge) return;
      try {
        await occurrencesBridge.create(word);
        await refreshOccurrences();
      } catch (error) {
        console.error('[occurrences] échec de la création à la volée :', error);
      }
    },
    [occurrencesBridge, refreshOccurrences],
  );

  // Clic sur une pastille {{occurrence}} (NoteRenderer.tsx en lecture,
  // MdxEditor.tsx en Live Preview) — ouvre directement la fiche du mot dans
  // la barre latérale, quitte à la déplier/basculer sur cet onglet si ce
  // n'était pas déjà le cas.
  const handleOpenOccurrence = useCallback((word: string) => {
    setSidebarOpen(true);
    setSidebarTab('occurrences');
    setFocusedOccurrenceWord(word);
  }, []);

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
        // Paramètres → Éditeur → "Mode d'édition par défaut" : chaque note
        // rouverte repart de ce mode plutôt que de garder celui de la note
        // précédemment ouverte dans la session.
        setViewMode(preferences.editorDefaultMode);
      } catch (error) {
        console.error('[vault] échec de lecture de la note :', error);
        setStatus('error');
      }
    },
    [vault, preferences.editorDefaultMode],
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
                name: (pendingOpenRelPath.split('/').pop() ?? pendingOpenRelPath).replace(/\.mdx?$/i, ''),
                modifiedAt: Date.now(),
                kind: 'markdown',
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

  // `kind` optionnel (défaut 'markdown') : "Nouveau canvas"/"Nouveau
  // graphique" du menu contextuel passent respectivement 'canvas'/'chart'
  // (voir showContextMenuFor) — même handler, seul le fichier créé change
  // (voir vault:create-note dans apps/desktop/electron/vault.js). Quand
  // AUCUN `parentRelPath` explicite n'est fourni (bouton "+ Nouvelle note",
  // "Nouvelle note"/"Nouveau canvas"/"Nouveau graphique" du menu contextuel
  // général — pas les variantes "...ici", qui passent toujours leur propre
  // dossier), l'emplacement est résolu depuis Paramètres → Gestion des
  // fichiers et des liens → "Emplacement par défaut des nouvelles notes".
  const handleCreateNote = useCallback(
    async (parentRelPath?: string, kind?: VaultEntryKind) => {
      if (!vault) return;
      const resolvedParent =
        parentRelPath ??
        (preferences.newNoteLocation === 'sameFolder'
          ? activeNote
            ? getParentRelPath(activeNote.relPath)
            : undefined
          : preferences.newNoteLocation === 'custom'
            ? preferences.newNoteCustomFolder || undefined
            : undefined);
      try {
        const entry = await vault.createNote('Sans titre', resolvedParent, kind);
        await refreshTree();
        await openNote({ type: 'note', ...entry });
      } catch (error) {
        console.error('[vault] échec de création de la note :', error);
      }
    },
    [vault, refreshTree, openNote, activeNote, preferences.newNoteLocation, preferences.newNoteCustomFolder],
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
            { id: 'new-canvas', label: 'Nouveau canvas' },
            { id: 'new-chart', label: 'Nouveau graphique' },
            { id: 'new-folder', label: 'Nouveau dossier' },
          ]
        : node.type === 'folder'
          ? [
              { id: 'new-note-here', label: 'Nouvelle note ici' },
              { id: 'new-canvas-here', label: 'Nouveau canvas ici' },
              { id: 'new-chart-here', label: 'Nouveau graphique ici' },
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
        if (choice === 'new-canvas') void handleCreateNote(undefined, 'canvas');
        if (choice === 'new-chart') void handleCreateNote(undefined, 'chart');
        if (choice === 'new-folder') void handleCreateFolder();
        if (node && choice === 'new-note-here') void handleCreateNote(node.relPath);
        if (node && choice === 'new-canvas-here') void handleCreateNote(node.relPath, 'canvas');
        if (node && choice === 'new-chart-here') void handleCreateNote(node.relPath, 'chart');
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

  // Glisser pour RÉORDONNER (curseur), même mécanisme de délégation que le
  // clic droit ci-dessus : un seul jeu d'écouteurs DOM (dragstart/dragover/
  // drop/dragend) sur le conteneur de la liste plutôt qu'un handler par
  // ligne — chaque ligne porte juste `draggable` (voir VaultTreeView.tsx)
  // et son `data-relpath`. Volontairement restreint aux FRÈRES (même
  // dossier parent) : changer de dossier reste le rôle de "Déplacer
  // vers…"/"Modifier le chemin", pas du glisser — voir le commentaire
  // d'en-tête de fichier. `draggingRelPathRef` (pas seulement le state)
  // sert de source de vérité à la logique : cet effet ne se re-crée qu'au
  // changement de `tree`/`vault`, donc les closures ci-dessous figeraient
  // une valeur périmée du state si elles le lisaient directement — la ref,
  // elle, reste toujours à jour.
  useEffect(() => {
    const container = listAreaRef.current as unknown as HTMLElement | null;
    if (!container || !vault) return;

    // Résout "au-dessus ou en dessous de quelle ligne FRÈRE" insérer
    // l'élément glissé — null si la ligne survolée n'est pas un frère valide
    // (dossier parent différent, ou la ligne glissée elle-même) : dans ce
    // cas on ne bloque pas l'évènement (pas de preventDefault), le
    // navigateur affiche son curseur "dépôt refusé" par défaut.
    const resolveInsertion = (
      event: DragEvent,
      draggedRelPath: string,
    ): { relPath: string; edge: 'above' | 'below' } | null => {
      const target = event.target as HTMLElement | null;
      const rowEl = target?.closest ? (target.closest('[data-relpath]') as HTMLElement | null) : null;
      const hoveredRelPath = rowEl?.getAttribute('data-relpath') ?? null;
      if (!rowEl || !hoveredRelPath || hoveredRelPath === draggedRelPath) return null;

      const draggedParent = getParentRelPath(draggedRelPath);
      const hoveredParent = getParentRelPath(hoveredRelPath);
      if (draggedParent !== hoveredParent) return null;

      const rect = rowEl.getBoundingClientRect();
      const edge = event.clientY < rect.top + rect.height / 2 ? 'above' : 'below';
      return { relPath: hoveredRelPath, edge };
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
      const draggedRelPath = draggingRelPathRef.current;
      if (!draggedRelPath) return;
      const insertion = resolveInsertion(event, draggedRelPath);
      if (!insertion) {
        setDragOverInsertion(null);
        return;
      }
      // Nécessaire pour autoriser le drop (comportement par défaut du
      // navigateur : refuser) — voir MDN sur l'API HTML5 Drag and Drop.
      // Seulement quand la cible est valide : sinon le curseur "refusé" du
      // navigateur sert lui-même d'indication.
      event.preventDefault();
      setDragOverInsertion(insertion);
    };

    const handleDrop = (event: DragEvent) => {
      const draggedRelPath = draggingRelPathRef.current;
      const insertion = draggedRelPath ? resolveInsertion(event, draggedRelPath) : null;
      draggingRelPathRef.current = null;
      setDraggingRelPath(null);
      setDragOverInsertion(null);
      if (!draggedRelPath || !insertion) return;
      event.preventDefault();

      const draggedNode = findNodeByPath(tree, draggedRelPath);
      const targetNode = findNodeByPath(tree, insertion.relPath);
      if (!draggedNode || !targetNode) return;

      const parentRelPath = getParentRelPath(draggedRelPath);
      const siblingNames = getChildrenAt(tree, parentRelPath).map((n) => n.name);
      const withoutDragged = siblingNames.filter((name) => name !== draggedNode.name);
      const targetIndex = withoutDragged.indexOf(targetNode.name);
      const insertAt = targetIndex === -1 ? withoutDragged.length : targetIndex + (insertion.edge === 'below' ? 1 : 0);
      const reordered = [
        ...withoutDragged.slice(0, insertAt),
        draggedNode.name,
        ...withoutDragged.slice(insertAt),
      ];

      void vault
        .reorder(parentRelPath, reordered)
        .then(setTree)
        .catch((error) => console.error('[vault] échec du réordonnancement :', error));
    };

    const handleDragEnd = () => {
      draggingRelPathRef.current = null;
      setDraggingRelPath(null);
      setDragOverInsertion(null);
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
  }, [vault, tree]);

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

  // Dispatché directement sur l'EditorView (pas de setContent/scheduleSave
  // ici) : le changement + la nouvelle sélection partent dans UNE seule
  // transaction CodeMirror, et c'est le `onChange` de MdxEditor (déclenché
  // par cette transaction comme par une frappe normale) qui met à jour le
  // state React — une seule voie de synchronisation, pas deux à maintenir
  // en parallèle.
  const applyFormatting = (run: (text: string, selection: Selection) => FormattingResult) => {
    const view = viewRef.current;
    if (!view) return;
    const sel = view.state.selection.main;
    const result = run(view.state.doc.toString(), { start: sel.from, end: sel.to });
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: result.text },
      selection: { anchor: result.selection.start, head: result.selection.end },
    });
    view.focus();
  };

  // Clic sur un [[lien interne]] (voir NoteRenderer.tsx) — résout par NOM
  // de note (comme Obsidian, insensible à la casse) plutôt que par relPath
  // exact, puisque c'est ce que la syntaxe du lien porte. Si la cible
  // n'existe pas encore, la crée avant de l'ouvrir par défaut (façon
  // Obsidian : un lien vers une note absente n'est pas une impasse) — sauf
  // si Paramètres → Gestion des fichiers et des liens →
  // "autoCreateWikilinkTarget" a été désactivé, auquel cas le clic se
  // contente de prévenir plutôt que de créer silencieusement.
  const handleOpenWikilink = useCallback(
    async (target: string) => {
      if (!vault) return;
      setWikilinkNotice(null);
      try {
        const notes = flattenNotes(tree);
        const existing = notes.find((note) => note.name.toLowerCase() === target.toLowerCase());
        if (existing) {
          await openNote(existing);
          return;
        }
        if (!preferences.autoCreateWikilinkTarget) {
          setWikilinkNotice(
            `Aucune note « ${target} » — création automatique désactivée (Paramètres → Gestion des fichiers et des liens).`,
          );
          return;
        }
        const entry = await vault.createNote(target);
        await refreshTree();
        await openNote({ type: 'note', ...entry });
      } catch (error) {
        console.error('[vault] échec de l’ouverture du lien interne :', error);
      }
    },
    [vault, tree, openNote, refreshTree, preferences.autoCreateWikilinkTarget],
  );

  // Ouvre une note par relPath — utilisé par CanvasEditor quand on clique
  // une carte-note (voir CanvasEditor.tsx, prop `onOpenNote`). Relit
  // l'arborescence courante en state (contrairement au mécanisme
  // `pendingOpenRelPath` d'App.tsx, réservé aux ouvertures venant d'un AUTRE
  // écran) : Canvas est maintenant embarqué ici même, pas besoin de
  // rebasculer d'onglet.
  const openNoteByRelPath = useCallback(
    (relPath: string) => {
      const found = findNodeByPath(tree, relPath);
      if (found && found.type === 'note') void openNote(found);
    },
    [tree, openNote],
  );

  // "📎 Joindre un fichier" — importe le fichier choisi dans
  // `attachments/` (voir vault:import-attachment) et insère la syntaxe
  // d'embed `![[nom]]` à la position du curseur, même mécanique que
  // applyFormatting.
  const handleInsertAttachment = useCallback(async () => {
    if (!vault || !activeNote) return;
    setAttachmentError(null);
    try {
      const result = await vault.importAttachment();
      if (!result) return; // dialogue annulé
      const embed = `![[${result.name}]]`;
      const view = viewRef.current;
      if (view) {
        const sel = view.state.selection.main;
        const newText = view.state.doc.toString().slice(0, sel.from) + embed + view.state.doc.toString().slice(sel.to);
        const cursor = sel.from + embed.length;
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: newText },
          selection: { anchor: cursor, head: cursor },
        });
        view.focus();
      } else {
        const newText = `${content}${embed}`;
        setContent(newText);
        scheduleSave(newText);
      }
    } catch (error) {
      console.error('[vault] échec de l’import de la pièce jointe :', error);
      setAttachmentError(error instanceof Error ? error.message : String(error));
    }
  }, [vault, activeNote, content, scheduleSave]);

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
          <View style={styles.listHeaderActions}>
            <Pressable
              onPress={() => void handleCreateNote()}
              style={[styles.newButton, styles.newButtonFlex, { backgroundColor: theme.accent }]}
            >
              <Text style={styles.buttonText}>+ Nouvelle note</Text>
            </Pressable>
            <Pressable
              onPress={() => setSearchOpen(true)}
              style={[styles.searchButton, { borderColor: theme.border }]}
              accessibilityLabel="Rechercher"
            >
              <Text style={{ color: theme.text }}>🔍</Text>
            </Pressable>
          </View>
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
            dragOverInsertion={dragOverInsertion}
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
              {/* Paramètres → Éditeur → "Titre en ligne" : pour une note
                  markdown, le titre est alors rendu plus bas, à l'intérieur
                  du contenu (voir juste avant le sélecteur de mode), et
                  l'en-tête fixe ne garde que le statut + le panneau
                  latéral. Canvas/graphiques n'ont pas cette zone de contenu
                  scrollable équivalente, donc gardent toujours le titre ici. */}
              {!(preferences.editorInlineTitle && activeNote.kind === 'markdown') &&
                (activeNoteIsRenaming ? (
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
                ))}
              <Text style={[styles.status, { color: theme.textMuted }]}>
                {status === 'saving' && 'Enregistrement…'}
                {status === 'saved' && 'Enregistré'}
                {status === 'error' && '⚠️ Échec de la sauvegarde'}
              </Text>
              <Pressable
                onPress={() => setSidebarOpen((open) => !open)}
                style={styles.sidebarToggle}
                accessibilityLabel={sidebarOpen ? 'Masquer le panneau latéral' : 'Afficher le panneau latéral'}
              >
                <Text style={{ color: sidebarOpen ? theme.accent : theme.textMuted }}>
                  {sidebarOpen ? '▶' : '◀'}
                </Text>
              </Pressable>
            </View>

            <View style={styles.editorMainRow}>
              <View style={styles.noteContent}>
                {activeNote.kind === 'canvas' ? (
                  <View style={styles.editorBody}>
                    <CanvasEditor relPath={activeNote.relPath} onOpenNote={openNoteByRelPath} />
                  </View>
                ) : activeNote.kind === 'chart' ? (
                  <View style={styles.editorBody}>
                    <ChartEditor relPath={activeNote.relPath} />
                  </View>
                ) : (
                  <>
                    {preferences.editorInlineTitle &&
                      (activeNoteIsRenaming ? (
                        <TextInput
                          autoFocus
                          value={renamingValue}
                          onChangeText={setRenamingValue}
                          onSubmitEditing={() => void submitRename()}
                          onBlur={() => void submitRename()}
                          onKeyPress={(event) => {
                            if (event.nativeEvent.key === 'Escape') cancelRename();
                          }}
                          style={[styles.editorTitleInline, { color: theme.text, borderColor: theme.accent }]}
                        />
                      ) : (
                        <Pressable onPress={() => startRename({ type: 'note', ...activeNote })}>
                          <Text style={[styles.editorTitleInline, { color: theme.text }]}>
                            {activeNote.name}
                          </Text>
                        </Pressable>
                      ))}
                    <View style={[styles.modeRow, { borderColor: theme.border }]}>
                      {(
                        [
                          ['source', 'Source'],
                          ['split', 'Intermédiaire'],
                          ['reading', 'Aperçu'],
                        ] as [ViewMode, string][]
                      ).map(([mode, label]) => (
                        <Pressable
                          key={mode}
                          onPress={() => setViewMode(mode)}
                          style={[
                            styles.modeButton,
                            { borderColor: theme.border },
                            viewMode === mode && { backgroundColor: theme.accent, borderColor: theme.accent },
                          ]}
                        >
                          <Text style={{ color: viewMode === mode ? '#fff' : theme.textMuted, fontSize: 12 }}>
                            {label}
                          </Text>
                        </Pressable>
                      ))}
                      <Pressable onPress={() => void handleInsertAttachment()} style={styles.attachButton}>
                        <Text style={{ color: theme.textMuted }}>📎 Joindre un fichier</Text>
                      </Pressable>
                    </View>
                    {attachmentError && <Text style={styles.error}>⚠️ {attachmentError}</Text>}
                    {wikilinkNotice && <Text style={styles.error}>⚠️ {wikilinkNotice}</Text>}

                    {viewMode !== 'reading' && (
                      <EditorToolbar
                        items={toolbarActions.map((action) => ({
                          id: action.id,
                          label: action.label,
                          onPress: () => applyFormatting(action.run),
                        }))}
                        theme={theme}
                      />
                    )}

                    <View style={styles.editorBody}>
                      {viewMode === 'reading' ? (
                        <ScrollView style={styles.previewFull}>
                          <NoteRenderer
                            content={content}
                            theme={theme}
                            onOpenWikilink={(t) => void handleOpenWikilink(t)}
                            knownOccurrenceWords={knownOccurrenceWords}
                            onOpenOccurrence={handleOpenOccurrence}
                          />
                        </ScrollView>
                      ) : (
                        <MdxEditor
                          value={content}
                          onChange={handleChangeContent}
                          livePreview={viewMode === 'split'}
                          theme={theme}
                          onOpenWikilink={(t) => void handleOpenWikilink(t)}
                          onOpenOccurrence={handleOpenOccurrence}
                          occurrenceWords={occurrenceWordList}
                          onCreateOccurrence={handleCreateOccurrence}
                          fontSize={preferences.editorFontSize}
                          closeBrackets={preferences.editorCloseBrackets}
                          onReady={(ref: ReactCodeMirrorRef) => {
                            viewRef.current = ref.view ?? null;
                          }}
                        />
                      )}
                    </View>
                  </>
                )}
              </View>

              {sidebarOpen && (
                <RightSidebar theme={theme} activeTab={sidebarTab} onSelectTab={setSidebarTab}>
                  {sidebarTab === 'properties' ? (
                    <PropertiesPanel
                      theme={theme}
                      activeNote={activeNote}
                      content={content}
                      onChangeContent={handleChangeContent}
                    />
                  ) : (
                    <OccurrencesPanel
                      theme={theme}
                      focusedWord={focusedOccurrenceWord}
                      onFocusWord={setFocusedOccurrenceWord}
                      onOpenNote={openNoteByRelPath}
                      onChanged={() => void refreshOccurrences()}
                    />
                  )}
                </RightSidebar>
              )}
            </View>
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

      {searchOpen && (
        <SearchDialog
          theme={theme}
          onOpenResult={(relPath) => {
            setSearchOpen(false);
            openNoteByRelPath(relPath);
          }}
          onCancel={() => setSearchOpen(false)}
        />
      )}
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
  listHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  newButton: {
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  newButtonFlex: {
    flex: 1,
  },
  searchButton: {
    width: 34,
    height: 34,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
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
  // Paramètres → Éditeur → "Titre en ligne" : plus grand que le titre
  // épinglé de l'en-tête, façon titre de note Obsidian, puisqu'il fait
  // partie du flux de contenu plutôt que d'une barre compacte.
  editorTitleInline: {
    fontSize: 26,
    fontWeight: '700',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 4,
  },
  status: {
    fontSize: 12,
  },
  sidebarToggle: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  editorMainRow: {
    flex: 1,
    flexDirection: 'row',
  },
  noteContent: {
    flex: 1,
  },
  modeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingBottom: 8,
    borderBottomWidth: 1,
  },
  modeButton: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  attachButton: {
    marginLeft: 'auto',
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  error: {
    color: '#dc2626',
    fontSize: 12,
    paddingHorizontal: 12,
    paddingTop: 4,
  },
  editorBody: {
    flex: 1,
    flexDirection: 'row',
  },
  previewFull: {
    flex: 1,
    padding: 16,
  },
});
