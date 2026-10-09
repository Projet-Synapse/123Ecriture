import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AppState,
  GestureResponderEvent,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';

import { EditorView, type ReactCodeMirrorRef } from '@uiw/react-codemirror';

import {
  ensureTimestamps,
  parseFrontmatter,
  serializeFrontmatter,
} from '../lib/frontmatter';
import { applyPathChange, isPathAffected, mergeRestoredOpenTabs } from '../lib/openTabs';
import type { FormattingResult, Selection } from '../lib/mdxFormatting';
import { NOTES_TOOLBAR_ACTIONS, type ToolbarAction } from '../lib/notesToolbarActions';
import { openSearchResult } from '../lib/searchResults';
import { useResizablePanel } from '../lib/useResizablePanel';
import { collectFolderRelPaths } from '../lib/treeExpansion';
import {
  findNodeByPath,
  flattenNotes,
  flattenVisibleNotes,
  getAncestorRelPaths,
  getChildrenAt,
  getParentRelPath,
} from '../lib/vaultTree';
import { countCharacters, countWords } from '../lib/wordCount';
import { useVaults } from '../lib/sync/VaultsContext';
import { usePreferences } from '../preferences/PreferencesContext';
import type { NotesActions } from './AppShell';
import { CanvasEditor } from './CanvasEditor';
import { CodeEditor } from './CodeEditor';
import { ChartEditor } from './ChartEditor';
import { EditorToolbar } from './EditorToolbar';
import { EditPathDialog } from './EditPathDialog';
import { ActionMenu } from './ActionMenu';
import { ExcalidrawEditor } from './ExcalidrawEditor';
import { MdxEditor } from './MdxEditor';
import { MdxEditorWeb } from './MdxEditorWeb';
import { MoveDialog } from './MoveDialog';
import { NoteRenderer } from './NoteRenderer';
import { OccurrencesPanel } from './OccurrencesPanel';
import { PropertiesBlock } from './PropertiesBlock';
import { PropertiesPanel } from './PropertiesPanel';
import { ResizeHandle } from './ResizeHandle';
import { RightSidebar, type SidebarTab } from './RightSidebar';
import { OutlinePanel } from './OutlinePanel';
import { SearchDialog } from './SearchDialog';
import { lintMarkdown } from '../lib/markdownLinter';
import { listTemplateNotes } from '../lib/templates';
import { VaultTreeView } from './VaultTreeView';
import { NoteIconByKind } from './FileIcons';
import { FolderPreview } from './FolderPreview';
import { errorMessage } from '../lib/errorMessage';

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
// (MoveDialog), par édition manuelle du chemin complet (EditPathDialog), ou
// en glissant DANS un dossier (curseur, voir l'effet dragstart/dragover/
// drop plus bas — zone centrale d'une ligne dossier). Le même glisser sert
// aussi à réordonner entre frères (zones haut/bas d'une ligne) — voir
// vault:move/vault:reorder dans apps/desktop/electron/vault.ts.
//
// //////////////////////////////////////////////////////////////////////
// 🗂️ SOMMAIRE — ce que ce fichier fait EN PLUS de l'édition de note
// (fichiers/explorateur, le reste — mode d'édition, barre d'outils,
// occurrences... est propre à l'édition, pas à cette liste) :
// //////////////////////////////////////////////////////////////////////
// //1. Chargement de l'arborescence — refreshTree, ouverture d'une note
//      demandée par un autre écran (pendingOpenRelPath).
// //2. Ouverture d'une note — openNote (mémorise le dernier fichier ouvert
//      par coffre), création (note/canvas/graphique/excalidraw/dossier).
// //3. Fichier ouvert par défaut au démarrage (Paramètres → "Fichier
//      ouvert par défaut") + révélation automatique dans l'explorateur
//      (déplier les dossiers ancêtres, faire défiler jusqu'à la ligne).
// //4. Renommer/déplacer/dupliquer/modifier le chemin/supprimer.
// //5. Menu contextuel de l'explorateur (clic droit) + bouton d'ordre de
//      tri.
// //6. Glisser-déposer — réordonner entre frères OU déplacer dans un
//      dossier, bascule automatique vers le tri "Manuel".
// //7. Sauvegarde (autosave débouncée) + rendu (liste + éditeur actif).
// //8. Favoris — section fixe "⭐ Favoris" en tête de l'explorateur.
// //9. Multi-sélection — Ctrl/Cmd+clic, Shift+clic, barre d'actions
//      groupées (déplacer/supprimer plusieurs éléments à la fois).
// //10. Vue Tags — bascule Fichiers/Tags de l'explorateur.
// //11. Onglets — plusieurs notes ouvertes en même temps, persistées par
//      coffre (state.json), barre au-dessus de l'éditeur + Ctrl+Tab/Ctrl+W.
// Voir aussi apps/desktop/electron/vault.ts (backend fichiers),
// VaultTreeView.tsx (rendu de l'explorateur), FilesLinksSection.tsx
// (réglages).
const AUTOSAVE_DELAY_MS = 600;

// Formatage fr-FR des compteurs (1 234 mots) — une seule instance pour tout
// le module, le format ne dépend pas du rendu.
const countFormatter = new Intl.NumberFormat('fr-FR');
const formatCount = (value: number) => countFormatter.format(value);

type Status = 'idle' | 'saving' | 'saved' | 'error';

// Voir lib/openTabs.ts — déplacée là pour être partagée avec
// applyPathChange (onglets) et testée ; mêmes règles qu'avant : un
// renommage/déplacement de DOSSIER affecte en cascade tout ce qu'il
// contient.

type Props = {
  // Demande d'ouverture d'une note depuis un AUTRE écran (Calendrier,
  // Canvas — voir App.tsx) : relPath à ouvrir dès que possible.
  // `onOpenedPendingNote` prévient le parent une fois fait, pour qu'il
  // remette ce champ à null (sinon rebasculer sur l'onglet Notes sans
  // passer par un autre écran redéclencherait l'ouverture en boucle).
  pendingOpenRelPath?: string | null;
  onOpenedPendingNote?: () => void;
  // Ouvrir un résultat de recherche globale "tâche"/"évènement" (voir
  // SearchDialog ci-dessous) bascule sur un AUTRE écran — cet écran ne sait
  // ouvrir que des notes, donc il remonte la demande à App.tsx via ces deux
  // callbacks (même généralisation que `onRequestOpenNote` de
  // CalendarScreen.tsx, voir lib/searchResults.ts `openSearchResult`).
  onRequestOpenTask?: (taskListId: string, taskId: string) => void;
  onRequestOpenCalendarDate?: (date: string) => void;
  // Enregistre "Nouvelle note"/"Nouveau dossier" auprès de App.tsx pour que
  // CommandPalette.tsx (Ctrl/Cmd+K, monté dans AppShell.tsx — donc HORS de
  // cet écran) puisse les déclencher quand Notes est l'écran actif. Solution
  // la plus simple qui reste correcte : un registre à UNE entrée (pas un
  // registre générique par écran), puisque seul Notes expose ce genre
  // d'action pour l'instant.
  onRegisterActions?: (actions: NotesActions) => void;
};

// Construit les items de la barre d'outils depuis les GROUPES (v0.4.43,
// Paramètres → Éditeur) : groupe dépliant = un bouton qui déploie sa rangée
// au survol/appui (voir EditorToolbar) ; groupe ouvert = boutons côte à
// côte séparés entre groupes. Annuler/Rétablir (commands CodeMirror
// natives) et Pièce jointe (importAttachment + insertion au curseur) sont
// des ids de la config branchés sur leurs handlers réels. Fonction HORS
// composant : elle ne touche aucun ref — l'EditorView et l'insertion
// arrivent en paramètres (l'accès à viewRef.current pendant le rendu est
// interdit par react-hooks/refs, et la règle ne voit ici que des closures
// d'évènements passées en props).
export function NotesScreen({
  pendingOpenRelPath,
  onOpenedPendingNote,
  onRequestOpenTask,
  onRequestOpenCalendarDate,
  onRegisterActions,
}: Props = {}) {
  const { preferences, preferencesLoaded, theme, setFileSortMode, toggleFavorite } = usePreferences();
  const vault = typeof window !== 'undefined' ? window.vault : undefined;
  const contextMenuBridge = typeof window !== 'undefined' ? window.contextMenu : undefined;
  // Menu contextuel unifié : pont Electron desktop (`contextMenuBridge.show`,
  // menu natif du clic droit) OU carte tactile `ActionMenu` sur natif —
  // mêmes items, mêmes handlers, un seul point de branchement (presentMenu).
  const [nativeMenu, setNativeMenu] = useState<{ title?: string; items: { id: string; label: string }[] } | null>(null);
  const nativeMenuResolver = useRef<((choice: string | null) => void) | null>(null);
  const presentMenu = useCallback(
    (title: string | undefined, items: { id: string; label: string }[]): Promise<string | null> => {
      if (Platform.OS === 'web') {
        return contextMenuBridge ? contextMenuBridge.show(items) : Promise.resolve(null);
      }
      return new Promise((resolve) => {
        nativeMenuResolver.current = resolve;
        setNativeMenu({ title, items });
      });
    },
    [contextMenuBridge],
  );
  const closeNativeMenu = useCallback((choice: string | null) => {
    setNativeMenu(null);
    nativeMenuResolver.current?.(choice);
    nativeMenuResolver.current = null;
  }, []);
  const { vaults, switchVault, activeVaultPath: vaultPath } = useVaults();

  const [tree, setTree] = useState<VaultTreeNode[]>([]);
  // Miroir de l'arbre pour les effets qui doivent le lire SANS se
  // redéclencher à chaque rafraîchissement (voir l'effet du mode
  // d'ouverture des dossiers, plus bas — re-replier ce que l'utilisatrice
  // a ouvert depuis serait une régression).
  const treeRef = useRef<VaultTreeNode[]>([]);
  useEffect(() => {
    treeRef.current = tree;
  }, [tree]);
  const [activeNote, setActiveNote] = useState<VaultEntry | null>(null);
  // APERÇU DE DOSSIER (v0.4.36, style Make.md) : quand un dossier est
  // cliqué dans l'explorateur, son chemin est mémorisé ici et la zone
  // éditeur affiche FolderPreview au lieu de l'éditeur de note. null =
  // pas d'aperçu (une note est ouverte, ou rien).
  const [previewFolderRelPath, setPreviewFolderRelPath] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [viewMode, setViewMode] = useState<ViewMode>(preferences.editorDefaultMode);
  // Sur natif, l'éditeur CodeMirror est du pur DOM (crash au montage) :
  // l'Intermédiaire embarque désormais le MÊME éditeur web que le desktop
  // dans une WebView (MdxEditorWeb — v0.4.42, demande 2026-10-02), le
  // mode Source reste un TextInput natif et l'Aperçu le NoteRenderer natif.
  const isNativeNotes = Platform.OS !== 'web';
  const effectiveViewMode: ViewMode = viewMode;
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [wikilinkNotice, setWikilinkNotice] = useState<string | null>(null);
  // Repli des dossiers de l'explorateur — persisté PAR COFFRE dans
  // .123ecriture/state.json (voir vault:get/set-collapsed-paths) pour
  // retrouver l'arborescence telle qu'elle a été laissée au redémarrage ou
  // au changement de coffre. Chargé après la première lecture de l'arbre ;
  // les chemins obsolètes (dossier renommé/supprimé depuis) sont ignorés.
  // v0.4.50 : l'état INITIAL dépend de la préférence `explorerExpandMode`
  // (Paramètres → Gestion des fichiers) — 'last' (défaut historique,
  // replis persistés), 'all' (tout déplié), 'none' (tout replié).
  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(new Set());
  // Miroir du mode dans une ref : l'effet de chargement de l'arbre (deps
  // [vault, vaultPath]) le lit sans s'abonner à la préférence — la
  // réaction aux changements à chaud vit dans l'effet dédié plus bas.
  const expandModeRef = useRef<ExplorerExpandMode>(preferences.explorerExpandMode);
  // Onglets de notes ouverts (//11) — liste de relPaths, l'ordre du tableau
  // EST l'ordre des onglets, persisté PAR COFFRE dans .123ecriture/state.json
  // (voir vault:get/set-open-tabs) pour retrouver les onglets au
  // redémarrage/changement de coffre. Les métadonnées (nom/icône) sont
  // re-résolues dans l'arbre au rendu (`openTabs`, plus bas) : ici on ne
  // garde que les chemins, source de vérité de la persistance.
  const [openTabRelPaths, setOpenTabRelPaths] = useState<string[]>([]);
  const [renamingRelPath, setRenamingRelPath] = useState<string | null>(null);
  const [renamingValue, setRenamingValue] = useState('');
  const [movingNode, setMovingNode] = useState<VaultTreeNode | null>(null);
  const [editingPathNode, setEditingPathNode] = useState<VaultTreeNode | null>(null);
  const [editPathError, setEditPathError] = useState<string | null>(null);
  // Multi-sélection (voir //9 plus bas, `handleRowPress`) — `lastClickedRelPath`
  // sert d'ancre pour Shift+clic (étendre depuis LE DERNIER élément cliqué,
  // pas depuis le début de la sélection). `bulkMoveOpen` réutilise
  // MoveDialog en mode multi (voir `multiCount`) plutôt que de dupliquer une
  // boîte de dialogue de choix de dossier.
  const [selectedRelPaths, setSelectedRelPaths] = useState<Set<string>>(new Set());
  const [lastClickedRelPath, setLastClickedRelPath] = useState<string | null>(null);
  const [bulkMoveOpen, setBulkMoveOpen] = useState(false);
  // Bascule Fichiers/Tags de l'explorateur (voir //10 plus bas) — état
  // purement local (pas de préférence à persister, contrairement au mode de
  // tri), la liste de tags n'est chargée qu'À LA DEMANDE, au moment où on
  // bascule dessus.
  const [explorerViewMode, setExplorerViewMode] = useState<'files' | 'tags'>('files');
  const [tagGroups, setTagGroups] = useState<TagGroup[]>([]);
  const [tagsLoading, setTagsLoading] = useState(false);
  const [expandedTags, setExpandedTags] = useState<Set<string>>(new Set());
  // Barre latérale droite (Propriétés/Occurrences, voir RightSidebar.tsx) —
  // repliée par défaut, un seul état partagé pour tous les types de fichier
  // (markdown/canvas/chart) plutôt qu'un état par kind, puisqu'elle vit à
  // côté du contenu quel qu'il soit.
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('properties');
  // Redimensionnement/repli au curseur des 2 barres latérales internes à
  // cet écran (voir lib/useResizablePanel.ts, components/ResizeHandle.tsx —
  // la 3e, la nav générale, est gérée par AppShell.tsx). Le panneau droit
  // n'a volontairement PAS son propre `collapsed` persisté : sa visibilité
  // reste entièrement pilotée par `sidebarOpen` ci-dessus (déjà exposé par
  // le bouton ◀/▶ de l'en-tête) — `onCollapseIntent` fait juste converger
  // le glisser-jusqu'à-zéro vers ce même bouton plutôt que d'introduire une
  // deuxième notion de "fermé" qui pourrait diverger.
  // Plafond de largeur de l'explorateur : la largeur persistée (jusqu'à
  // 480, pensée pour desktop) sur un écran de téléphone laissait ~225 px à
  // l'éditeur — titre sur 6 lignes, apparence cassée (vécu sur A13). Le
  // plafond initial (45 %) empêchait aussi TOUT élargissement au doigt —
  // demande 2026-10-03 : « gérer leur largeur à l'aide de mon doigt » —
  // relâché à 60 % : l'éditeur garde toujours ~40 % de fenêtre.
  const { width: windowWidth } = useWindowDimensions();
  const explorerPanel = useResizablePanel('explorer', { min: 180, max: 480, edge: 1 });
  // Largeur RÉELLE de l'explorateur (la même que le style du panneau plus
  // bas) — pilote l'entassement des icônes de l'en-tête.
  const explorerWidth = Math.min(explorerPanel.width, windowWidth * 0.6);
  // Sous ~280 dp, la rangée de 5 icônes (créer, recherche, tri, actualiser,
  // tags) ne tient pas à 34 dp fixes (sur un téléphone l'explorateur fait
  // ~162 dp) : elles se partagent la largeur (searchButtonFlex).
  const explorerHeaderStacked = explorerWidth < 280;
  const rightPanelWidth = useResizablePanel('rightPanel', {
    min: 220,
    max: 480,
    edge: -1,
    onCollapseIntent: () => setSidebarOpen(false),
  });
  // Recherche globale (voir SearchDialog.tsx) — modale indépendante de
  // `activeNote`, contrairement à sidebarOpen/sidebarTab qui n'ont de sens
  // qu'avec une note ouverte.
  const [searchOpen, setSearchOpen] = useState(false);
  // Dictionnaire personnel des {{occurrences}} — chargé une fois ici (pas
  // dans OccurrencesPanel/NoteRenderer/MdxEditor séparément) puisque les
  // TROIS en ont besoin : NoteRenderer pour savoir quelles {{...}} styler
  // en pastille, MdxEditor pour l'autocomplétion `{{`, OccurrencesPanel
  // pour la gestion elle-même. `refreshOccurrences` est repassé à
  // OccurrencesPanel pour qu'il puisse déclencher un nouveau chargement
  // après une création/un renommage/une suppression (pas de `onChanged`
  // poussé par le main process pour ce module, comme calendar.js — voir
  // occurrences.js — plus simple de re-tirer la liste après chaque
  // mutation locale).
  const occurrencesBridge = typeof window !== 'undefined' ? window.occurrences : undefined;
  const [occurrenceEntries, setOccurrenceEntries] = useState<OccurrenceEntry[]>([]);
  const [focusedOccurrenceWord, setFocusedOccurrenceWord] = useState<string | null>(null);
  // État de glisser-pour-réordonner/déplacer, pour l'affichage
  // (VaultTreeView) — voir aussi draggingRelPathRef ci-dessous, qui porte
  // la même info pour la LOGIQUE (évite une closure périmée dans les
  // écouteurs DOM délégués). `dragOverInsertion` : sur quelle ligne
  // afficher l'indice de dépôt — 'above'/'below' = trait d'insertion entre
  // deux frères (réordonner), 'inside' = ligne entière teintée (dossier
  // ciblé, déplacer dedans).
  const [draggingRelPath, setDraggingRelPath] = useState<string | null>(null);
  const [dragOverInsertion, setDragOverInsertion] = useState<{
    relPath: string;
    edge: 'above' | 'below' | 'inside';
  } | null>(null);
  const draggingRelPathRef = useRef<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Note active tenue à jour dans une ref, même rôle que `contentRef`
  // ci-dessous : flusher l'autosave en attente au changement de note
  // (openNote) sans dépendre du state `activeNote` d'une closure créée à un
  // rendu antérieur.
  const activeNoteRef = useRef<VaultEntry | null>(activeNote);
  useEffect(() => {
    activeNoteRef.current = activeNote;
  }, [activeNote]);
  // Contenu courant tenu à jour dans une ref (plutôt qu'ajouté aux deps de
  // flushSave/openNote) : sinon elles changeraient d'identité à chaque
  // frappe, ce qui réenregistrerait l'écouteur clavier global à chaque
  // frappe pour rien (voir l'effet Ctrl/Cmd+S/K/N plus bas). Déclaré ici
  // (avant openNote qui le lit) : react-hooks/immutability exige que la
  // mutation de la ref précède sa capture par un hook.
  const contentRef = useRef(content);
  useEffect(() => {
    contentRef.current = content;
  }, [content]);

  // Matérialise les dates système `created`/`modified` DANS le frontmatter à
  // chaque sauvegarde (demande utilisateur : les lignes « Créé/Modifié » des
  // vues deviennent de vraies clés, pour une cohérence totale entre les
  // modes source/intermédiaire/aperçu). `created` n'est écrit qu'une fois
  // (date de création du fichier, jamais une valeur existante écrasée) ;
  // `modified` est actualisé à chaque enregistrement. Le texte retourné est
  // aussi réinjecté dans `content` par les appelants (les clés ajoutées
  // doivent être visibles à l'écran, pas seulement sur disque). Sans pont
  // getTimestamps (adaptateur natif Android) : pas de matérialisation.
  // Déclaré ICI (avant openNote qui l'appelle au flush de changement de
  // note) : react-hooks exige que le hook précède sa capture.
  const materializeTimestamps = useCallback(
    // kind passé par chaque appelant (kind de la note SAUVEGARDÉE, qui peut
    // différer de la note active pendant un flush) : la matérialisation est
    // MARKDOWN-ONLY — sur un fichier code, elle insèrerait un frontmatter
    // YAML inventé dans un .py (fichier corrompu).
    async (relPath: string, text: string, kind?: VaultEntryKind): Promise<string> => {
      if (kind && kind !== 'markdown') return text;
      if (!vault?.getTimestamps) return text;
      try {
        const { data, body } = parseFrontmatter(text);
        const timestamps = await vault.getTimestamps(relPath).catch(() => null);
        const next = ensureTimestamps(data, timestamps?.createdAt ?? Date.now(), Date.now());
        const serialized = serializeFrontmatter(next, body);
        return serialized === text ? text : serialized;
      } catch (error) {
        console.error('[properties] échec de la matérialisation des dates :', error);
        return text;
      }
    },
    [vault],
  );
  // Onglets — même rôle que contentRef : lire la liste COURANTE depuis
  // openNote/closeTab/cycleOpenTabs (closures d'un rendu potentiellement
  // antérieur) sans les ajouter à leurs deps (elles se recréeraient à
  // chaque ouverture/fermeture d'onglet pour rien). Déclaré AVANT
  // applyOpenTabs qui le mute : react-hooks/immutability exige que la
  // mutation de la ref précède sa capture par un hook.
  const openTabRelPathsRef = useRef<string[]>([]);
  useEffect(() => {
    openTabRelPathsRef.current = openTabRelPaths;
  }, [openTabRelPaths]);
  // Seule voie d'écriture des onglets : met la ref en accord IMMÉDIATEMENT
  // (les callbacks qui lisent la ref ne doivent jamais voir une valeur
  // périmée), puis le state, puis la persistance disque (best-effort,
  // comme toggleCollapse plus bas).
  const applyOpenTabs = useCallback(
    (next: string[]) => {
      openTabRelPathsRef.current = next;
      setOpenTabRelPaths(next);
      void vault?.setOpenTabs(next).catch((error) => {
        console.error('[vault] échec de la persistance des onglets :', error);
      });
    },
    [vault],
  );
  // Renommage/déplacement/suppression (le leur OU celui d'un dossier qui
  // les contient) appliqué aux onglets — voir applyPathChange (lib/
  // openTabs.ts) pour les règles exactes. Appelé par submitRename/
  // performMove/submitEditPath/handleDeleteNode/submitBulkMove/
  // handleBulkDelete, en parallèle de la même logique sur activeNote.
  const updateOpenTabsAfterPathChange = useCallback(
    (oldRelPath: string, newRelPath?: string | null) => {
      const next = applyPathChange(openTabRelPathsRef.current, oldRelPath, newRelPath ?? null);
      if (next !== openTabRelPathsRef.current) applyOpenTabs(next);
    },
    [applyOpenTabs],
  );
  const listAreaRef = useRef<View>(null);
  // "Fichier ouvert par défaut" (voir l'effet dédié plus bas) : ne doit
  // s'exécuter qu'UNE fois par coffre activé, pas à chaque re-render — une
  // ref plutôt qu'un state, puisque ce n'est qu'un verrou interne, pas
  // quelque chose que l'UI doit refléter.
  const defaultOpenAttemptedForVaultRef = useRef<string | null>(null);

  // Référence vers l'EditorView CodeMirror actif (voir MdxEditor.tsx,
  // prop `onReady`) — permet de dispatcher des transactions (barre
  // d'outils, pièce jointe) directement dessus. Contrairement à l'ancien
  // `TextInput`, CodeMirror gère nativement la sélection courante dans son
  // propre état (`view.state.selection`) : plus besoin de la dupliquer dans
  // un ref/state React ni de la "forcer" après coup.
  const viewRef = useRef<EditorView | null>(null);


  // Raccourcis clavier de mise en forme (voir MdxEditor.tsx, prop
  // `shortcuts`) — dérivés de TOUTES les actions connues, pas seulement
  // `toolbarActions` (visibles) : masquer un bouton dans Paramètres est une
  // préférence d'affichage, pas une désactivation de la fonctionnalité —
  // le raccourci clavier continue de fonctionner même bouton masqué.
  const noteShortcuts = useMemo(
    () =>
      NOTES_TOOLBAR_ACTIONS.filter((action): action is ToolbarAction & { shortcut: string } =>
        Boolean(action.shortcut),
      ).map((action) => ({ key: action.shortcut, run: action.run })),
    [],
  );

  // //1. 🌳 CHARGEMENT DE L'ARBORESCENCE
  // //////////////////////////////////////////////////////////////////////

  const refreshTree = useCallback(async () => {
    if (!vault) return;
    setTree(await vault.listTree());
  }, [vault]);

  // PC : l'arbre est RELU quand la fenêtre reprend le focus — des fichiers
  // ajoutés depuis l'explorateur Windows pendant que l'app était en
  // arrière-plan apparaissent au retour (walkTree relit le disque à chaque
  // appel, pas de cache). Natif : voir rescanVault (parcours SAF).
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const onFocus = () => void refreshTree();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [vault, refreshTree]);

  useEffect(() => {
    if (!vault || !vaultPath) return;
    // Changement de coffre : vide l'éditeur ET les onglets de session
    // AVANT toute restauration. Sans ça, la note (le contenu) du coffre
    // PRÉCÉDENT restait affichée sous le coffre actif — une frappe
    // enregistrait alors l'ancien contenu dans le NOUVEAU coffre (même
    // relPath, autre dossier). Écrasement LOCAL uniquement (pas
    // applyOpenTabs, qui persisterait) : l'écriture asynchrone de « [] »
    // pourrait arriver APRÈS le get-open-tabs de la restauration et
    // renvoyer une liste vide à celle-ci. Reset en réaction à un changement
    // d'état EXTERNE (coffre actif) — même exception documentée que le
    // reset de la multi-sélection plus bas.
     
    openTabRelPathsRef.current = [];
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpenTabRelPaths([]);
     
    setActiveNote(null);
     
    setContent('');
     
    setStatus('idle');
    void (async () => {
      let freshTree: VaultTreeNode[] = [];
      try {
        freshTree = await vault.listTree();
        setTree(freshTree);
      } catch (error) {
        console.error('[vault] échec du chargement de l’arborescence :', error);
      }
      // État d'ouverture des dossiers — APRES refreshTree pour ne pas
      // s'afficher avant que l'arbre existe. Trois modes (préférence
      // `explorerExpandMode`, Paramètres → Gestion des fichiers) :
      // - 'all' : arbre entièrement déplié (aucun repli) ;
      // - 'none' : arbre entièrement replié (tous les dossiers), SAUF les
      //   ancêtres de la note déjà active — même protection que 'last',
      //   sans quoi un fichier ouvert par défaut démarrerait masqué ;
      // - 'last' (défaut) : replis persistés PAR COFFRE dans
      //   .123ecriture/state.json. Fusion "protectrice" : les dossiers
      //   ancêtres de la note active restent dépliés, sans quoi un
      //   chargement qui résout après une ouverture de note refermerait
      //   le dossier qu'on vient d'ouvrir — l'effet de révélation ne se
      //   rejoue pas sur un simple changement de collapsedPaths.
      try {
        const mode = expandModeRef.current;
        if (mode === 'all') {
          setCollapsedPaths(new Set());
        } else if (mode === 'none') {
          // activeNoteRef lu AVANT l'updater (pas dedans) : un updater peut
          // être rejoué pendant le rendu (StrictMode), et la règle
          // react-hooks/refs refuse toute lecture de ref à ce moment-là.
          const activeRelPath = activeNoteRef.current?.relPath ?? null;
          const folded = new Set(collectFolderRelPaths(freshTree));
          if (activeRelPath) getAncestorRelPaths(activeRelPath).forEach((a) => folded.delete(a));
          setCollapsedPaths(folded);
        } else {
          const persisted = vault.getCollapsedPaths ? await vault.getCollapsedPaths() : [];
          const activeRelPath = activeNoteRef.current?.relPath ?? null;
          setCollapsedPaths((prev) => {
            const next = new Set(persisted);
            if (activeRelPath) getAncestorRelPaths(activeRelPath).forEach((a) => next.delete(a));
            // Garde aussi les replis faits à chaud pendant le chargement.
            prev.forEach((p) => next.add(p));
            return next;
          });
        }
      } catch (error) {
        console.error('[vault] échec du chargement des dossiers repliés :', error);
      }
      // Onglets persistés du coffre — APRES l'arbre (il faut le fraîchir
      // pour écarter les chemins périmés) et APRES les dossiers repliés
      // (l'effet de révélation de la note active, qui déplie ses
      // ancêtres, attend une liste de replis cohérente). Fusion avec les
      // onglets ouverts ENTRE-TEMPS : l'ouverture par défaut/le
      // pendingOpen ont pu ajouter un onglet pendant ce chargement
      // asynchrone — mergeRestoredOpenTabs le conserve au lieu de laisser
      // la restauration l'écraser.
      try {
        const restored = vault.getOpenTabs ? await vault.getOpenTabs() : [];
        const valid = restored.filter((relPath) => {
          const found = findNodeByPath(freshTree, relPath);
          return found !== null && found.type === 'note';
        });
        applyOpenTabs(mergeRestoredOpenTabs(valid, openTabRelPathsRef.current));
      } catch (error) {
        console.error('[vault] échec du chargement des onglets :', error);
      }
    })();
    // Se redéclenche quand `vault` ou `vaultPath` changent (chargement
    // initial, changement de coffre actif via VaultsContext) pour
    // recharger l'arborescence ET restaurer l'état d'UI du coffre.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vault, vaultPath]);

  // Changement à chaud du mode d'ouverture des dossiers (Paramètres →
  // Gestion des fichiers) — applique le nouvel état à l'arbre AFFICHÉ
  // sans attendre un changement de coffre. `tree` n'est PAS une dépendance
  // (lecture via treeRef) : un simple rafraîchissement de l'arbre ne doit
  // pas re-replier ce qui a été ouvert depuis.
  const explorerExpandMode = preferences.explorerExpandMode;
  useEffect(() => {
    expandModeRef.current = explorerExpandMode;
    void (async () => {
      // Un tick hors du passage synchrone de l'effet : les mises à jour
      // d'état ne doivent pas arriver en rafale pendant le rendu en cours
      // (règle react-hooks set-state-in-effect).
      await Promise.resolve();
      if (explorerExpandMode === 'all') {
        setCollapsedPaths(new Set());
        return;
      }
      if (explorerExpandMode === 'none') {
        const folded = new Set(collectFolderRelPaths(treeRef.current));
        const activeRelPath = activeNoteRef.current?.relPath ?? null;
        if (activeRelPath) getAncestorRelPaths(activeRelPath).forEach((a) => folded.delete(a));
        setCollapsedPaths(folded);
        return;
      }
      // 'last' : relit l'état persisté du coffre actif.
      try {
        const persisted = vault?.getCollapsedPaths ? await vault.getCollapsedPaths() : [];
        setCollapsedPaths(new Set(persisted));
      } catch (error) {
        console.error('[vault] échec de la relecture des dossiers repliés :', error);
      }
    })();
  }, [explorerExpandMode, vault]);

  // (Ctrl/Cmd+K — palette de commandes/recherche globale — vit dans
  // AppShell.tsx, UN seul écouteur pour toute l'app : cet écran n'en a
  // plus de propre. Historique : deux listeners parallèles ici ouvraient
  // la SearchDialog SOUS la palette superposée ; la palette intègre déjà
  // la recherche globale (voir CommandPalette.tsx) et la loupe 🔍 de
  // listHeaderActions reste le clic dédié aux filtres par propriété.)

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
  // Noms des notes pour l'autocomplétion `[[` (voir MdxEditor.tsx/
  // lib/wikilinkAutocomplete.ts) — recalculé quand l'arbre change
  // (création/renommage/déplacement), pas à la frappe.
  const noteNameList = useMemo(() => flattenNotes(tree).map((note) => note.name), [tree]);

  // Résolution des embeds `![[...]]` en data URL (widget image du Live
  // Preview, voir MdxEditor.tsx/mdxLivePreview.ts) — MÊME bridge que
  // NoteRenderer (readAttachmentDataUrl, qui cherche aussi par nom dans
  // tout le coffre). Cache par coffre dans un ref : le widget est recréé à
  // chaque frappe (chaque buildDecorations), sans cache chaque caractère
  // tapé relirait le fichier image sur le disque. Quand le coffre actif
  // change, le cache repart à zéro (les chemins relatifs changent de sens)
  // — c'est l'invalidation voulue.
  const embedCacheRef = useRef({ vaultPath: null as string | null, map: new Map<string, Promise<string | null>>() });
  const embedUrlResolver = useCallback(
    (target: string): Promise<string | null> => {
      const cache = embedCacheRef.current;
      if (cache.vaultPath !== vaultPath) {
        cache.vaultPath = vaultPath;
        cache.map.clear();
      }
      let pending = cache.map.get(target);
      if (!pending) {
        pending = vault?.readAttachmentDataUrl(target).catch(() => null) ?? Promise.resolve(null);
        cache.map.set(target, pending);
      }
      return pending;
    },
    [vault, vaultPath],
  );

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

  // //2. 📂 OUVERTURE ET CRÉATION
  // //////////////////////////////////////////////////////////////////////

  const openFolder = useCallback((node: VaultFolderNode) => {
    setPreviewFolderRelPath(node.relPath);
  }, []);

  const openNote = useCallback(
    async (node: VaultNoteNode) => {
      if (!vault) return;
      try {
        // Sauvegarde débouncée en attente de la note QUITTÉE : flush AVANT
        // le changement. Le timer du debounce garde sa closure (le contenu
        // serait de toute façon écrit au bon relPath), mais ses
        // setStatus/refreshTree tardifs s'appliquaient à la NOUVELLE note
        // déjà affichée — et fermer l'app dans la fenêtre des 600 ms
        // perdait la frappe. Pas de refreshTree ici : best-effort, le
        // prochain enregistrement rafraîchira l'arbre.
        if (saveTimer.current && activeNoteRef.current && activeNoteRef.current.relPath !== node.relPath) {
          clearTimeout(saveTimer.current);
          saveTimer.current = null;
          const leftNote = activeNoteRef.current;
          void materializeTimestamps(leftNote.relPath, contentRef.current, leftNote.kind)
            .then((finalText) => vault.writeNote(leftNote.relPath, finalText))
            .catch((error) => {
              console.error('[vault] échec de la sauvegarde différée au changement de note :', error);
            });
        }
        const text = await vault.readNote(node.relPath);
        setActiveNote(node);
        setPreviewFolderRelPath(null);
        setContent(text);
        setStatus('idle');
        // Paramètres → Éditeur → "Mode d'édition par défaut" : chaque note
        // rouverte repart de ce mode plutôt que de garder celui de la note
        // précédemment ouverte dans la session.
        setViewMode(preferences.editorDefaultMode);
        // Mémorisé PAR COFFRE (voir vault.ts) pour "Fichier ouvert par
        // défaut" = "Dernier ouvert" — best-effort, une erreur ici ne doit
        // pas empêcher l'ouverture elle-même (déjà réussie à ce stade).
        void vault.setLastOpened(node.relPath).catch((error) => {
          console.error('[vault] échec de la mémorisation du dernier fichier ouvert :', error);
        });
        // Onglets : la note ouverte devient un onglet si elle ne l'était
        // déjà — position STABLE (rouvrir une note déjà ouverte ne la
        // déplace pas en fin de barre, elle ne fait que l'activer).
        const tabs = openTabRelPathsRef.current;
        if (!tabs.includes(node.relPath)) {
          applyOpenTabs([...tabs, node.relPath]);
        }
      } catch (error) {
        console.error('[vault] échec de lecture de la note :', error);
        setStatus('error');
      }
    },
    [vault, preferences.editorDefaultMode, applyOpenTabs, materializeTimestamps],
  );

  // //11. 🗂️ ONGLETS — fermeture et navigation clavier
  // //////////////////////////////////////////////////////////////////////

  // Ferme un onglet (✕ de la barre ou Ctrl+W). S'il était actif : le
  // voisin — MÊME index après retrait, sinon le dernier — devient actif ;
  // la note quittée est flushée par openNote (même chemin que tout
  // changement de note). Sans voisin : flush manuel avant de vider
  // l'éditeur (aucun openNote ne le ferait).
  const closeTab = useCallback(
    (relPath: string) => {
      const tabs = openTabRelPathsRef.current;
      const index = tabs.indexOf(relPath);
      if (index === -1) return;
      const next = tabs.filter((p) => p !== relPath);
      applyOpenTabs(next);
      if (activeNoteRef.current?.relPath !== relPath) return;

      const nextRelPath = next[Math.min(index, next.length - 1)] ?? null;
      const nextNode = nextRelPath ? findNodeByPath(tree, nextRelPath) : null;
      if (nextNode && nextNode.type === 'note') {
        void openNote(nextNode);
        return;
      }
      // Dernier onglet, ou voisin introuvable entre-temps : flush de la
      // note quittée puis éditeur vide ("Sélectionne ou crée une note").
      if (saveTimer.current && activeNoteRef.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
        void vault?.writeNote(relPath, contentRef.current).catch((error) => {
          console.error('[vault] échec de la sauvegarde différée à la fermeture du dernier onglet :', error);
        });
      }
      setActiveNote(null);
      setContent('');
      setStatus('idle');
    },
    [applyOpenTabs, openNote, tree, vault],
  );

  // Ctrl+Tab / Ctrl+Shift+Tab : onglet suivant/précédent, en boucle
  // (modulo) comme dans les navigateurs. Une note active sans onglet
  // (transitoire possible pendant un refreshTree) repart de l'extrémité
  // correspondant à la direction plutôt que de ne rien faire.
  const cycleOpenTabs = useCallback(
    (direction: 1 | -1) => {
      const tabs = openTabRelPathsRef.current;
      if (tabs.length < 2) return;
      const currentIndex = tabs.indexOf(activeNoteRef.current?.relPath ?? '');
      const base = currentIndex === -1 ? (direction === 1 ? -1 : tabs.length) : currentIndex;
      const found = findNodeByPath(tree, tabs[(base + direction + tabs.length) % tabs.length]);
      if (found && found.type === 'note') void openNote(found);
    },
    [openNote, tree],
  );

  // Notice wikilink (cible absente + création auto désactivée) — s'efface
  // seule après quelques secondes : une info ponctuelle qui ne disparaît
  // qu'au PROCHAIN clic de lien devient du bruit permanent sous l'éditeur.
  useEffect(() => {
    if (!wikilinkNotice) return;
    const timer = setTimeout(() => setWikilinkNotice(null), 6000);
    return () => clearTimeout(timer);
  }, [wikilinkNotice]);

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
    // `name` : nom EXPLICITE avec extension, utilisé par les fichiers code
    // (`Sans titre.py` — l'extension choisie dans le menu langage) ; les
    // autres kinds gardent « Sans titre » + leur extension fixe.
    async (parentRelPath?: string, kind?: VaultEntryKind, name?: string) => {
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
        const entry = await vault.createNote(name ?? 'Sans titre', resolvedParent, kind);
        await refreshTree();
        await openNote({ type: 'note', ...entry });
      } catch (error) {
        console.error('[vault] échec de création de la note :', error);
      }
    },
    [vault, refreshTree, openNote, activeNote, preferences.newNoteLocation, preferences.newNoteCustomFolder],
  );

  // //3. 🚀 FICHIER OUVERT PAR DÉFAUT + RÉVÉLATION DANS L'EXPLORATEUR
  // //////////////////////////////////////////////////////////////////////

  // "Fichier ouvert par défaut" (Paramètres → Gestion des fichiers et des
  // liens) : quoi ouvrir au tout premier affichage d'un coffre. Ne
  // s'exécute qu'UNE fois par coffre activé (`defaultOpenAttemptedForVaultRef`)
  // — sans ce verrou, ré-ouvrir la même note via un lien interne ensuite ne
  // redéclencherait rien de particulier, mais l'effet tournerait inutilement
  // à chaque changement de `tree`/préférence si on l'y avait fait dépendre.
  // Relit l'arborescence FRAÎCHE directement (comme l'effet
  // `pendingOpenRelPath` ci-dessus) plutôt que de dépendre du state `tree`,
  // qui pourrait ne pas encore être peuplé à ce stade.
  useEffect(() => {
    if (!vault || !vaultPath) return;
    // Attend le VRAI chargement des préférences avant de lire
    // `defaultOpenMode` — sinon cet effet s'exécutait avec
    // `DEFAULT_PREFERENCES` (mode 'lastOpened' par défaut) avant que
    // `bridge.get()` ait eu le temps de résoudre, posait quand même le
    // verrou ci-dessous, et le VRAI mode configuré (ex. 'specific')
    // n'avait alors plus jamais l'occasion de s'appliquer.
    if (!preferencesLoaded) return;
    if (defaultOpenAttemptedForVaultRef.current === vaultPath) return;
    defaultOpenAttemptedForVaultRef.current = vaultPath;

    void (async () => {
      try {
        if (preferences.defaultOpenMode === 'newNote') {
          await handleCreateNote();
          return;
        }

        const freshTree = await vault.listTree();

        if (preferences.defaultOpenMode === 'specific' && preferences.defaultOpenSpecificPath) {
          const found = findNodeByPath(freshTree, preferences.defaultOpenSpecificPath);
          if (found && found.type === 'note') {
            await openNote(found);
            return;
          }
          // Chemin configuré mais introuvable (renommé/supprimé depuis) —
          // repli silencieux sur "Sélectionne ou crée une note" plutôt
          // qu'une erreur, même esprit que le reste de l'app.
          return;
        }

        // 'lastOpened' (mode par défaut) : la dernière note ouverte DANS CE
        // COFFRE (voir vault.ts, .123ecriture/state.json).
        const lastRelPath = await vault.getLastOpened();
        if (lastRelPath) {
          const found = findNodeByPath(freshTree, lastRelPath);
          if (found && found.type === 'note') await openNote(found);
        }
      } catch (error) {
        console.error('[vault] échec de l’ouverture par défaut :', error);
      }
    })();
  }, [
    vault,
    vaultPath,
    preferencesLoaded,
    preferences.defaultOpenMode,
    preferences.defaultOpenSpecificPath,
    handleCreateNote,
    openNote,
  ]);

  // Quelle que soit la façon dont une note devient active (clic, lien
  // interne, "fichier ouvert par défaut" ci-dessus, Calendrier, Canvas...),
  // l'explorateur doit toujours la révéler : déplier ses dossiers ancêtres
  // s'ils étaient repliés, puis faire défiler jusqu'à sa ligne. `requestAnimationFrame`
  // laisse React peindre le déploiement AVANT de chercher la ligne dans le
  // DOM — sinon `querySelector` pourrait s'exécuter avant que la ligne
  // nouvellement dépliée n'existe.
  useEffect(() => {
    if (!activeNote) return;
    const ancestors = getAncestorRelPaths(activeNote.relPath);
    if (ancestors.length > 0) {
      // Réagit à un changement de note active (prop/état externe), pas un
      // état dérivable pendant le rendu : c'est exactement le rôle d'un
      // effet.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCollapsedPaths((prev) => {
        if (!ancestors.some((a) => prev.has(a))) return prev;
        const next = new Set(prev);
        ancestors.forEach((a) => next.delete(a));
        return next;
      });
    }

    const container = listAreaRef.current as unknown as HTMLElement | null;
    if (!container) return;
    // querySelector/scrollIntoView = DOM web uniquement (no-op natif : le
    // scroll vers la note active reviendra avec l'explorateur natif).
    if (Platform.OS !== 'web') return;
    const frame = requestAnimationFrame(() => {
      const row = container.querySelector(`[data-relpath="${CSS.escape(activeNote.relPath)}"]`);
      row?.scrollIntoView({ block: 'nearest' });
    });
    return () => cancelAnimationFrame(frame);
    // Volontairement keyé sur `activeNote?.relPath` (pas l'objet
    // `activeNote` entier, qui change d'identité à chaque `openNote` même
    // pour la MÊME note) : ne redéplier/rescroller que quand la note
    // active change VRAIMENT.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeNote?.relPath]);

  // Fraîcheur de l'arborescence (v0.4.47, demande : « les fichiers ajoutés
  // depuis l'explorateur de fichiers ne sont pas remarqués ») :
  // - PC : l'arbre est relu au retour de focus de la fenêtre ;
  // - Android : retour au premier plan OU bouton Actualiser = rescan SAF
  //   complet en arrière-plan (~1 requête par entrée), l'arbre se met à
  //   jour quand il arrive sans geler l'interface.
  const [rescanEnCours, setRescanEnCours] = useState(false);
  const rescanVault = useCallback(async () => {
    if (Platform.OS === 'web') {
      await refreshTree();
      return;
    }
    const rescan = (vault as typeof vault & { rescan?: () => Promise<void> }).rescan;
    if (!rescan) return;
    setRescanEnCours(true);
    try {
      await rescan.call(vault);
      await refreshTree();
    } catch (error) {
      console.error('[vault] échec du rescan :', error);
    } finally {
      setRescanEnCours(false);
    }
  }, [vault, refreshTree]);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' && !rescanEnCours) void rescanVault();
    });
    return () => subscription.remove();
  }, [rescanVault, rescanEnCours]);

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

  // Enregistre "Nouvelle note"/"Nouveau dossier" pour CommandPalette.tsx
  // (voir Props.onRegisterActions ci-dessus) — sans argument explicite : la
  // palette de commandes déclenche toujours la création "générique" (même
  // résolution d'emplacement par défaut que le bouton "+ Nouvelle note" de
  // l'en-tête), jamais "...ici" (qui n'a de sens que depuis le menu
  // contextuel d'un élément précis de l'arborescence).
  useEffect(() => {
    onRegisterActions?.({
      createNote: () => void handleCreateNote(),
      createFolder: () => void handleCreateFolder(),
    });
  }, [onRegisterActions, handleCreateNote, handleCreateFolder]);

  // //4. ✏️ RENOMMER / DÉPLACER / MODIFIER LE CHEMIN / SUPPRIMER
  // //////////////////////////////////////////////////////////////////////

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
      // Onglets : même accordé que activeNote ci-dessous (l'onglet exact
      // est réécrit, ceux d'un dossier renommé sont retirés).
      updateOpenTabsAfterPathChange(relPath, result.relPath);
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
      updateOpenTabsAfterPathChange(relPath, result.relPath);
      await refreshTree();
    } catch (error) {
      console.error('[vault] échec du renommage :', error);
    }
  }, [vault, renamingRelPath, renamingValue, refreshTree, updateOpenTabsAfterPathChange]);

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
        updateOpenTabsAfterPathChange(node.relPath, result.relPath);
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
    [vault, refreshTree, updateOpenTabsAfterPathChange],
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

  // Confirmation NATIVE gérée côté main process (vault.ts, `vault:delete`) —
  // ce handler n'a qu'à réagir au résultat : rafraîchir l'arborescence, et
  // fermer l'éditeur si la note ouverte (ou un dossier qui la contenait)
  // vient de disparaître, même logique que rename/move/setPath ci-dessus
  // (`isPathAffected`).
  const handleDeleteNode = useCallback(
    async (node: VaultTreeNode) => {
      if (!vault) return;
      try {
        const { deleted } = await vault.delete(node.relPath);
        if (!deleted) return; // annulé dans la boîte de confirmation
        updateOpenTabsAfterPathChange(node.relPath, null);
        setActiveNote((current) => {
          if (!current) return current;
          if (isPathAffected(current.relPath, node.relPath)) {
            setContent('');
            return null;
          }
          return current;
        });
        await refreshTree();
      } catch (error) {
        console.error('[vault] échec de la suppression :', error);
      }
    },
    [vault, refreshTree, updateOpenTabsAfterPathChange],
  );

  // "Dupliquer" (menu contextuel) — copie DANS LE MÊME dossier (voir
  // vault:duplicate, apps/desktop/electron/vault.ts, qui gère déjà le
  // suffixe " (copie)"/" (copie 2)"...), puis ouvre directement la copie :
  // même geste qu'après une création (`handleCreateNote` ci-dessus), pour
  // qu'on puisse enchaîner immédiatement dessus sans revenir cliquer dans
  // l'arborescence.
  const handleDuplicateNode = useCallback(
    async (node: VaultTreeNode) => {
      if (!vault) return;
      try {
        const entry = await vault.duplicate(node.relPath);
        await refreshTree();
        await openNote({ type: 'note', ...entry });
      } catch (error) {
        console.error('[vault] échec de la duplication :', error);
      }
    },
    [vault, refreshTree, openNote],
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
        updateOpenTabsAfterPathChange(node.relPath, result.relPath);
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
        setEditPathError(errorMessage(error));
      }
    },
    [vault, editingPathNode, refreshTree, updateOpenTabsAfterPathChange],
  );

  const toggleCollapse = useCallback(
    (relPath: string) => {
      const next = new Set(collapsedPaths);
      if (next.has(relPath)) {
        next.delete(relPath);
      } else {
        next.add(relPath);
      }
      setCollapsedPaths(next);
      // Persistance immédiate, best-effort — chaque bascule réécrit la
      // liste complète (quelques dizaines de chemins au plus) : plus
      // simple et plus sûr qu'un debounce, et l'ordre d'arrivée des
      // écritures n'importe pas (dernière = la plus récente de toute
      // façon).
      void vault?.setCollapsedPaths([...next]).catch((error) => {
        console.error('[vault] échec de la persistance des dossiers repliés :', error);
      });
    },
    [collapsedPaths, vault],
  );

  // Bouton "ordre de tri" en haut de l'explorateur (voir
  // .claude/References/Sources.md §2) — même mécanisme de choix
  // contextuel que le sélecteur de liste de TasksScreen.tsx : une entrée
  // par mode, celle active préfixée ✅. Paramètres → Gestion des fichiers
  // et des liens propose déjà ce réglage ; ce bouton n'en est qu'un accès
  // direct depuis l'explorateur lui-même, pas un doublon de logique.
  // //5. 🖱️ MENU CONTEXTUEL DE L'EXPLORATEUR + TRI
  // //////////////////////////////////////////////////////////////////////

  const showSortMenu = useCallback(() => {
    const options: { id: FileSortMode; label: string }[] = [
      { id: 'alphabetical', label: 'Alphabétique' },
      { id: 'recent', label: 'Plus récent d’abord' },
      { id: 'oldest', label: 'Moins récent d’abord' },
      { id: 'manual', label: 'Personnalisé (glisser-déposer)' },
    ];
    void presentMenu(undefined, options.map((o) => ({ id: o.id, label: o.id === preferences.fileSortMode ? `✅ ${o.label}` : o.label }))).then((choice) => {
      if (choice) void setFileSortMode(choice as FileSortMode);
    });
  }, [presentMenu, preferences.fileSortMode, setFileSortMode]);

  const showContextMenuFor = useCallback(
    (node: VaultTreeNode | null) => {
      // « Nouveau fichier de code » : deuxième menu pour choisir le LANGAGE
      // (l'extension est ce qui détermine coloration + soulignements — voir
      // lib/codeLanguages.ts). Le nom devient `Sans titre.<ext>`, modifiable
      // ensuite par renommage inline comme pour toutes les notes.
      const createCodeFile = (parentRelPath: string | undefined) => {
        const languageChoices: { id: string; label: string }[] = [
          { id: '.py', label: 'Python (.py)' },
          { id: '.js', label: 'JavaScript (.js)' },
          { id: '.ts', label: 'TypeScript (.ts)' },
          { id: '.tsx', label: 'React/TypeScript (.tsx)' },
          { id: '.html', label: 'HTML (.html)' },
          { id: '.css', label: 'CSS (.css)' },
          { id: '.json', label: 'JSON (.json)' },
          { id: '.sql', label: 'SQL (.sql)' },
          { id: '.sh', label: 'Script shell (.sh)' },
          { id: '.java', label: 'Java (.java)' },
          { id: '.cs', label: 'C# (.cs)' },
          { id: '.cpp', label: 'C++ (.cpp)' },
          { id: '.go', label: 'Go (.go)' },
          { id: '.rs', label: 'Rust (.rs)' },
          { id: '.php', label: 'PHP (.php)' },
          { id: '.rb', label: 'Ruby (.rb)' },
          { id: '.yaml', label: 'YAML (.yaml)' },
        ];
        void presentMenu('Quel langage ?', languageChoices).then((choice) => {
          if (choice) void handleCreateNote(parentRelPath, 'code', `Sans titre${choice}`);
        });
      };
      const items = !node
        ? [
            { id: 'new-note', label: 'Nouvelle note' },
            { id: 'new-canvas', label: 'Nouveau canvas' },
            { id: 'new-chart', label: 'Nouveau graphique' },
            { id: 'new-excalidraw', label: 'Nouveau excalidraw' },
            { id: 'new-code', label: 'Nouveau fichier de code…' },
            { id: 'new-folder', label: 'Nouveau dossier' },
          ]
        : node.type === 'folder'
          ? [
              { id: 'new-note-here', label: 'Nouvelle note ici' },
              { id: 'new-canvas-here', label: 'Nouveau canvas ici' },
              { id: 'new-chart-here', label: 'Nouveau graphique ici' },
              { id: 'new-excalidraw-here', label: 'Nouveau excalidraw ici' },
              { id: 'new-code-here', label: 'Nouveau fichier de code ici…' },
              { id: 'new-folder-here', label: 'Nouveau dossier ici' },
              { id: 'rename', label: 'Renommer' },
              { id: 'move', label: 'Déplacer vers…' },
              { id: 'edit-path', label: 'Modifier le chemin' },
              { id: 'delete', label: 'Supprimer' },
            ]
          : [
              { id: 'rename', label: 'Renommer' },
              { id: 'move', label: 'Déplacer vers…' },
              { id: 'edit-path', label: 'Modifier le chemin' },
              { id: 'duplicate', label: 'Dupliquer' },
              {
                id: 'toggle-favorite',
                label: preferences.favoriteRelPaths.includes(node.relPath)
                  ? 'Retirer des favoris'
                  : 'Ajouter aux favoris',
              },
              { id: 'delete', label: 'Supprimer' },
            ];

      void presentMenu(node?.name, items).then((choice) => {
        if (choice === 'new-note') void handleCreateNote();
        if (choice === 'new-canvas') void handleCreateNote(undefined, 'canvas');
        if (choice === 'new-chart') void handleCreateNote(undefined, 'chart');
        if (choice === 'new-excalidraw') void handleCreateNote(undefined, 'excalidraw');
        if (choice === 'new-code') createCodeFile(undefined);
        if (choice === 'new-folder') void handleCreateFolder();
        if (node && choice === 'new-note-here') void handleCreateNote(node.relPath);
        if (node && choice === 'new-canvas-here') void handleCreateNote(node.relPath, 'canvas');
        if (node && choice === 'new-chart-here') void handleCreateNote(node.relPath, 'chart');
        if (node && choice === 'new-excalidraw-here') void handleCreateNote(node.relPath, 'excalidraw');
        if (node && choice === 'new-code-here') createCodeFile(node.relPath);
        if (node && choice === 'new-folder-here') void handleCreateFolder(node.relPath);
        if (node && choice === 'rename') startRename(node);
        if (node && choice === 'move') startMove(node);
        if (node && choice === 'edit-path') startEditPath(node);
        if (node && choice === 'duplicate') void handleDuplicateNode(node);
        if (node && choice === 'toggle-favorite') void toggleFavorite(node.relPath);
        if (node && choice === 'delete') void handleDeleteNode(node);
      });
    },
    [
      presentMenu,
      handleCreateNote,
      handleCreateFolder,
      startRename,
      startMove,
      startEditPath,
      handleDuplicateNode,
      toggleFavorite,
      preferences.favoriteRelPaths,
      handleDeleteNode,
    ],
  );

  // Menu « ⋯ » de l'en-tête de l'éditeur (bouton rendu plus bas) — mêmes
  // actions que le clic droit sur la ligne de la note dans l'arbre
  // (showContextMenuFor), mais accessibles sans aller la retrouver dans
  // l'explorateur : la note OUVERTE se déplace/duplique/supprime d'ici,
  // quel que soit l'état de l'arbre. Le nœud est reconstruit depuis
  // activeNote (même forme que `{ type: 'note', ...activeNote }` du
  // renommage par clic titre).
  // (DÉPLACÉ plus bas, après handleChangeContent dont il dépend — déclaré
  // const plus bas dans le composant, l'utiliser avant sa déclaration
  // relevait à la fois du TDZ et de la règle react-hooks du compilateur.)
  // Insertion du CONTENU d'un modèle au curseur (le frontmatter du modèle
  // est retiré — il n'a pas de sens dans la note cible). Nécessite
  // l'EditorView (Source/Intermédiaire). Déclarée AVANT showTemplateMenu,
  // qui l'appelle au choix du menu.
  const insertTemplateById = useCallback(
    async (relPath: string) => {
      if (!vault || !activeNote) return;
      try {
        const raw = await vault.readNote(relPath);
        const body = raw.startsWith('---\n') ? raw.slice(raw.indexOf('\n---\n', 4) + 6) : raw;
        const view = viewRef.current;
        if (!view) {
          setWikilinkNotice("L'insertion se fait depuis un éditeur Source ou Intermédiaire.");
          return;
        }
        const sel = view.state.selection.main;
        const doc = view.state.doc.toString();
        view.dispatch({
          changes: { from: 0, to: doc.length, insert: doc.slice(0, sel.from) + body + doc.slice(sel.to) },
          selection: { anchor: sel.from + body.length },
        });
        view.focus();
      } catch (error) {
        console.error("[modèles] échec de l'insertion :", error);
        setWikilinkNotice("Échec de l'insertion du modèle.");
      }
    },
    [vault, activeNote],
  );

  // « 📋 Insérer un modèle » (v0.4.44, demande Templates) — liste les notes
  // des dossiers MODÈLES/TEMPLATES du coffre ; le choix insère le contenu
  // du modèle au curseur (via ActionMenu, natif ET desktop). L'insertion
  // (insertTemplateById, ci-dessus) est branchée sur le choix du menu —
  // elle était déclarée mais JAMAIS appelée (le menu s'affichait, choisir
  // un modèle ne faisait rien) : fin de branchement + fix lint.
  const showTemplateMenu = useCallback(() => {
    const notes = listTemplateNotes(tree);
    if (!activeNote) return;
    if (notes.length === 0) {
      setWikilinkNotice('Aucun modèle dans le coffre — place-les dans un dossier MODÈLES ou TEMPLATES.');
      return;
    }
    void presentMenu(
      'Insérer un modèle',
      notes.map((note) => ({ id: note.relPath, label: note.name })),
    ).then((choice) => {
      if (choice) void insertTemplateById(choice);
    });
  }, [tree, activeNote, presentMenu, insertTemplateById]);

  // (DÉPLACÉ plus bas, après handleChangeContent dont il dépend — déclaré
  // const plus bas dans le composant, l'utiliser avant sa déclaration
  // relevait à la fois du TDZ et de la règle react-hooks du compilateur.)

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

  // //6. 🖐️ GLISSER-DÉPOSER (réordonner / déplacer dans un dossier)
  // //////////////////////////////////////////////////////////////////////

  // Glisser pour RÉORDONNER OU DÉPLACER DANS UN DOSSIER (curseur), même
  // mécanisme de délégation que le clic droit ci-dessus : un seul jeu
  // d'écouteurs DOM (dragstart/dragover/drop/dragend) sur le conteneur de
  // la liste plutôt qu'un handler par ligne — chaque ligne porte juste
  // `draggable` (voir VaultTreeView.tsx) et son `data-relpath`.
  // `draggingRelPathRef` (pas seulement le state) sert de source de vérité
  // à la logique : cet effet ne se re-crée qu'au changement de
  // `tree`/`vault`/`performMove`, donc les closures ci-dessous figeraient
  // une valeur périmée du state si elles le lisaient directement — la ref,
  // elle, reste toujours à jour.
  useEffect(() => {
    // Glisser-déposer DOM = desktop/web uniquement — sur natif, les refs RN
    // ne sont pas des HTMLElement (crash « undefined is not a function »,
    // offset 1:1903343 v0.4.41-fix2, au premier coffre actif). Le
    // réordonnancement tactile reviendra avec une vraie implémentation RN.
    if (Platform.OS !== 'web') return;
    const container = listAreaRef.current as unknown as HTMLElement | null;
    if (!container || !vault) return;

    // Résout la zone survolée. Trois cas :
    // - Tiers central d'un DOSSIER (n'importe lequel, pas seulement un
    //   frère) → 'inside', déplacer DEDANS (vault:move) — sauf le dossier
    //   glissé lui-même ou un de ses propres descendants (mêmes règles que
    //   vault:move, qui les revérifie de toute façon côté main process ;
    //   ceci n'est qu'un indice visuel côté renderer, `isPathAffected` fait
    //   déjà exactement ce test ailleurs dans ce fichier).
    // - Tiers haut/bas d'une ligne FRÈRE (même dossier parent) → 'above'/
    //   'below', réordonnancement classique (vault:reorder) — inchangé.
    // - Sinon → null (dépôt refusé, curseur par défaut du navigateur).
    const resolveInsertion = (
      event: DragEvent,
      draggedRelPath: string,
    ): { relPath: string; edge: 'above' | 'below' | 'inside' } | null => {
      const target = event.target as HTMLElement | null;
      const rowEl = target?.closest ? (target.closest('[data-relpath]') as HTMLElement | null) : null;
      const hoveredRelPath = rowEl?.getAttribute('data-relpath') ?? null;
      if (!rowEl || !hoveredRelPath || hoveredRelPath === draggedRelPath) return null;

      const rect = rowEl.getBoundingClientRect();
      const relativeY = event.clientY - rect.top;

      const hoveredNode = findNodeByPath(tree, hoveredRelPath);
      const isMiddleThird = relativeY > rect.height / 3 && relativeY < (rect.height * 2) / 3;
      if (hoveredNode?.type === 'folder' && isMiddleThird && !isPathAffected(hoveredRelPath, draggedRelPath)) {
        return { relPath: hoveredRelPath, edge: 'inside' };
      }

      const draggedParent = getParentRelPath(draggedRelPath);
      const hoveredParent = getParentRelPath(hoveredRelPath);
      if (draggedParent !== hoveredParent) return null;

      const edge = relativeY < rect.height / 2 ? 'above' : 'below';
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
      void handleDropAsync(event);
    };

    const handleDropAsync = async (event: DragEvent) => {
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

      if (insertion.edge === 'inside') {
        // Déplacer DANS le dossier ciblé — même opération que "Déplacer
        // vers…" (performMove, déjà géré : met à jour la note active si
        // affectée, rafraîchit l'arborescence). Ne dépend pas de l'ordre de
        // tri (contrairement au réordonnancement ci-dessous) : pas de
        // bascule vers le mode "Manuel" ici.
        void performMove(draggedNode, targetNode.relPath);
        return;
      }

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

      // Un réordonnancement manuel n'a d'effet visible qu'en mode "Manuel"
      // (voir walkTree dans apps/desktop/electron/vault.ts, qui ignore
      // l'ordre enregistré dans les deux autres modes) — plutôt que
      // d'exiger que l'utilisatrice bascule ce réglage AVANT de pouvoir
      // glisser quoi que ce soit (sans quoi glisser ne fait rigoureusement
      // rien de visible, `draggable` restant à `false`), on bascule ICI,
      // seulement quand un glisser aboutit vraiment — l'intention "je veux
      // ranger mes fichiers à la main" est alors sans ambiguïté. ATTENDU
      // (pas fire-and-forget) AVANT `vault.reorder` : `preferences.set`
      // écrit `fileSortMode` sur le DISQUE de façon asynchrone, et
      // `vault:reorder` relit ce même fichier à CHAQUE appel côté main
      // process pour décider s'il applique l'ordre glissé-déposé — sans
      // cette attente, `vault:reorder` s'exécutait souvent encore avec
      // l'ancien mode (ex. 'alphabetical'), ignorait l'ordre qu'on venait
      // de lui donner, et le fichier glissé "revenait à sa place"
      // instantanément (course gagnée par `vault.reorder`, perdue par
      // l'écriture de préférence).
      if (preferences.fileSortMode !== 'manual') {
        try {
          await setFileSortMode('manual');
        } catch (error) {
          console.error('[preferences] échec du passage en tri manuel :', error);
        }
      }

      try {
        setTree(await vault.reorder(parentRelPath, reordered));
      } catch (error) {
        console.error('[vault] échec du réordonnancement :', error);
      }
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
    // `preferences.fileSortMode`/`setFileSortMode` volontairement absents
    // des deps : cet effet ne doit se recréer (et redélégeur ses
    // écouteurs) que si `vault`/`tree` changent, pas à chaque bascule de
    // réglage — `handleDrop` lit `preferences.fileSortMode` au moment du
    // DÉPÔT réel, pas besoin que l'effet lui-même en dépende.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vault, tree, performMove]);

  // Pose l'attribut HTML `draggable` réel sur chaque ligne — react-native-
  // web 0.21 ne transmet PAS les props inconnues comme `draggable` jusqu'au
  // DOM pour Pressable/View (seul `Image` le fait nativement, vérifié dans
  // ses sources), donc `draggable={...}` passé en prop à VaultTreeView
  // resterait un no-op silencieux sans ceci. Posé impérativement plutôt que
  // par prop, sur tous les `[data-relpath]` du conteneur, à chaque fois que
  // la liste ou la ligne en cours de renommage change. TOUJOURS activé,
  // quel que soit Paramètres → Gestion des fichiers et des liens → "Ordre
  // des fichiers" — glisser un fichier fait désormais basculer ce réglage
  // sur "Manuel" tout seul dès qu'un dépôt aboutit (voir handleDrop
  // ci-dessus) plutôt que d'exiger ce réglage AU PRÉALABLE : le geste de
  // glisser ne faisait sinon rigoureusement rien de visible en dehors du
  // mode manuel, ce qui ressemblait à une fonctionnalité cassée.
  useEffect(() => {
    // Attribut `draggable` des lignes = DOM web uniquement (même raison que
    // le glisser-déposer ci-dessus — offset 1:1902664 sur fix2).
    if (Platform.OS !== 'web') return;
    const container = listAreaRef.current as unknown as HTMLElement | null;
    if (!container) return;
    const rows = container.querySelectorAll<HTMLElement>('[data-relpath]');
    rows.forEach((row) => {
      const relPath = row.getAttribute('data-relpath');
      row.draggable = relPath !== renamingRelPath;
    });
  }, [tree, renamingRelPath]);

  // //7. 💾 SAUVEGARDE + RENDU
  // //////////////////////////////////////////////////////////////////////

  const scheduleSave = useCallback(
    () => {
      if (!vault || !activeNote) return;
      // PAS de setStatus('saving') ici : cette fonction tourne à CHAQUE
      // frappe, et un setState supplémentaire = un re-render complet de
      // NotesScreen par caractère (l'app est déjà re-rendue par
      // setContent). Le statut passe à "saving" dans le timer, au moment
      // où l'écriture a réellement lieu.
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        void (async () => {
          try {
            // La note a été quittée pendant les 600 ms (openNote a flushé
            // elle-même) : abandonner plutôt que réécrire l'ancien fichier
            // avec le contenu courant d'une AUTRE note.
            if (activeNoteRef.current?.relPath !== activeNote.relPath) return;
            setStatus('saving');
            // Texte lu au MOMENT de l'exécution (pas au schedule) : une
            // frappe arrivée entre les deux doit être incluse — sinon la
            // sauvegarde écrasait le disque avec une version périmée.
            const finalText = await materializeTimestamps(activeNote.relPath, contentRef.current, activeNote.kind);
            // PAS de setContent(finalText) : réinjecter le texte matérialisé
            // dans l'éditeur le remplaçait ENTIÈREMENT côté CodeMirror
            // (mode Source : value=content) — si l'utilisatrice reprenait
            // sa frappe pendant l'aller-retour, ses frappes étaient
            // écrasées (« des morceaux s'annulent tout seuls ») et le
            // curseur sautait. La matérialisation des dates va sur le
            // DISQUE ; l'éditeur reste la source de l'affichage, les clés
            // créées (created/modified) apparaissent à la réouverture.
            await vault.writeNote(activeNote.relPath, finalText);
            setStatus('saved');
            // PAS de refreshTree() ici (contrairement à flushSave) : un
            // simple edit ne change pas la structure du coffre, et un walk
            // complet du coffre + re-render de l'explorateur après CHAQUE
            // pause de frappe étranglait l'écriture (l'arbre est
            // rafraîchi par les chemins qui changent réellement la
            // structure : création, renommage, suppression, déplacement).
          } catch (error) {
            console.error('[vault] échec de sauvegarde :', error);
            setStatus('error');
          }
        })();
      }, AUTOSAVE_DELAY_MS);
    },
    [vault, activeNote, materializeTimestamps],
  );

  // useCallback (pas une simple flèche) : dépendre de showEditorActionsMenu
  // ci-dessous — une fonction recréée à chaque rendu aurait fait tourner ce
  // callback à chaque frappe (react-hooks/exhaustive-deps).
  const handleChangeContent = useCallback(
    (text: string) => {
      setContent(text);
      scheduleSave();
    },
    [scheduleSave],
  );

  // Menu « ⋯ » de l'en-tête de l'éditeur (bouton rendu plus bas) — mêmes
  // actions que le clic droit sur la ligne de la note dans l'arbre
  // (showContextMenuFor), mais accessibles sans aller la retrouver dans
  // l'explorateur. ICI (et pas plus haut) car il appelle handleChangeContent
  // (« ✨ Formater la note ») — déclaré const plus haut dans le composant,
  // l'utiliser avant sa déclaration relevait à la fois du TDZ et de la
  // règle react-hooks du compilateur.
  const showEditorActionsMenu = useCallback(() => {
    if (!activeNote) return;
    const node: VaultTreeNode = { type: 'note', ...activeNote };
    void presentMenu(node.name, [
      { id: 'rename', label: 'Renommer' },
      { id: 'move', label: 'Déplacer vers…' },
      { id: 'edit-path', label: 'Modifier le chemin' },
      { id: 'duplicate', label: 'Dupliquer' },
      { id: 'lint-note', label: '✨ Formater la note' },
      {
        id: 'toggle-favorite',
        label: preferences.favoriteRelPaths.includes(node.relPath)
          ? 'Retirer des favoris'
          : 'Ajouter aux favoris',
      },
      { id: 'delete', label: 'Supprimer' },
    ]).then((choice) => {
      if (choice === 'rename') startRename(node);
      if (choice === 'move') startMove(node);
      if (choice === 'edit-path') startEditPath(node);
      if (choice === 'duplicate') void handleDuplicateNode(node);
      if (choice === 'lint-note') handleChangeContent(lintMarkdown(contentRef.current));
      if (choice === 'toggle-favorite') void toggleFavorite(node.relPath);
      if (choice === 'delete') void handleDeleteNode(node);
    });
  }, [
    presentMenu,
    activeNote,
    preferences.favoriteRelPaths,
    startRename,
    startMove,
    startEditPath,
    handleDuplicateNode,
    toggleFavorite,
    handleDeleteNode,
    handleChangeContent,
  ]);


  // Sauvegarde immédiate (Ctrl/Cmd+S) : court-circuite le debounce de
  // scheduleSave plutôt que d'attendre AUTOSAVE_DELAY_MS — l'autosave existe
  // déjà pour ne rien perdre, mais un raccourci "Enregistrer" qui attend
  // quand même 600ms avant d'écrire donnerait l'impression de ne rien faire.
  const flushSave = useCallback(() => {
    if (!vault || !activeNote) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setStatus('saving');
    void (async () => {
      try {
        // Mêmes garde-fous que scheduleSave : ne pas réécrire l'ancien
        // fichier si la note a changé pendant l'aller-retour, et ne pas
        // réinjecter le texte matérialisé dans l'éditeur (remplacement
        // intégral CodeMirror = curseur déplacé, frappes écrasées).
        if (activeNoteRef.current?.relPath !== activeNote.relPath) return;
        const finalText = await materializeTimestamps(activeNote.relPath, contentRef.current, activeNote.kind);
        await vault.writeNote(activeNote.relPath, finalText);
        setStatus('saved');
        await refreshTree();
      } catch (error) {
        console.error('[vault] échec de sauvegarde immédiate (Ctrl+S) :', error);
        setStatus('error');
      }
    })();
  }, [vault, activeNote, refreshTree, materializeTimestamps]);

  // Raccourcis clavier globaux (Ctrl sur Windows/Linux, Cmd sur macOS) —
  // Ctrl/Cmd+S force la sauvegarde immédiate, Ctrl/Cmd+N crée une nouvelle
  // note (même emplacement par défaut que le bouton "+ Nouvelle note").
  // Ctrl/Cmd+W ferme l'onglet actif, Ctrl/Cmd+Tab / Ctrl/Cmd+Shift+Tab
  // naviguent entre les onglets (//11). Menu Electron désactivé
  // (Menu.setApplicationMenu(null), voir main.ts) : aucun accélérateur ne
  // court-circuite ces touches côté main process, et Ctrl+W n'a pas
  // d'action par défaut dans un BrowserWindow. Ctrl/Cmd+K (palette/
  // recherche globale) vit dans AppShell.tsx, pas ici — voir le
  // commentaire du bloc retiré ci-dessus ("1.5"). La recherche DANS la
  // note (Ctrl/Cmd+F) vit dans MdxEditor.tsx (keymap CodeMirror).
  // Web/Electron uniquement — `typeof window` ne suffit pas : window existe
  // sous Hermes natif mais addEventListener n'y est pas une fonction (crash
  // au démarrage v0.4.41). Garde Platform.OS.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      switch (event.key.toLowerCase()) {
        case 's':
          event.preventDefault();
          flushSave();
          break;
        case 'n':
          event.preventDefault();
          void handleCreateNote();
          break;
        case 'w':
          event.preventDefault();
          if (activeNoteRef.current) closeTab(activeNoteRef.current.relPath);
          break;
        case 'tab':
          event.preventDefault();
          cycleOpenTabs(event.shiftKey ? -1 : 1);
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [flushSave, handleCreateNote, closeTab, cycleOpenTabs]);

  // Dernier filet pour la même fenêtre de debouncing : fermer la fenêtre
  // dans les 600 ms suivant une frappe perdait la frappe silencieusement.
  // Best-effort assumé — ipcRenderer.invoke est asynchrone et le renderer
  // peut être détruit avant la résolution, mais le message est déjà parti
  // au main process, qui termine l'écriture de son côté.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const handleBeforeUnload = () => {
      const note = activeNoteRef.current;
      if (!saveTimer.current || !note) return;
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
      void vault?.writeNote(note.relPath, contentRef.current).catch(() => undefined);
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [vault]);

  // Le bloc "Propriétés" (PropertiesBlock.tsx) affiche déjà le frontmatter
  // de façon structurée en mode Intermédiaire/Aperçu — sans ça, le bloc YAML
  // brut ("---\ntitre: ...\n---") apparaissait EN PLUS, en texte littéral,
  // dans l'éditeur/le rendu juste en dessous : deux représentations de la
  // même donnée à l'écran (bug rapporté). En mode Source, `content` reste
  // inchangé (le YAML brut redevient la seule représentation, directement
  // éditable). `bodyOnly`/`handleChangeBody` reconstruisent le frontmatter
  // complet à l'écriture à partir du dernier `data` connu (le bloc
  // Propriétés écrit lui-même dans `content` en parallèle via son propre
  // serializeFrontmatter — les deux restent cohérents puisqu'ils partent du
  // même state `content`).
  const { data: frontmatterData, body: bodyOnly } = useMemo(() => parseFrontmatter(content), [content]);
  // Compteur mots/caractères (barre d'en-tête, markdown uniquement) —
  // compté sur le CORPS (frontmatter exclu) quel que soit le mode
  // d'affichage : c'est le texte lu/écrit qui compte, pas la config YAML.
  // DÉBOUNCÉ (l'ancien useMemo recalculait à chaque frappe) : le comptage
  // est linéaire sur TOUT le corps, négligeable sur une note normale
  // (~1 ms) mais catastrophique sur une note géante (2,3 s mesuré sur une
  // note de 32 Mo → chaque caractère tapé gelait l'éditeur). Un retard de
  // 400 ms sur l'affichage du compteur est invisible ; un gel par frappe
  // ne l'est pas.
  const [wordStats, setWordStats] = useState({ words: 0, characters: 0 });
  useEffect(() => {
    const timer = setTimeout(() => {
      setWordStats({ words: countWords(bodyOnly), characters: countCharacters(bodyOnly) });
    }, 400);
    return () => clearTimeout(timer);
  }, [bodyOnly]);
  const handleChangeBody = (newBody: string) => handleChangeContent(serializeFrontmatter(frontmatterData, newBody));

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
        scheduleSave();
      }
    } catch (error) {
      console.error('[vault] échec de l’import de la pièce jointe :', error);
      setAttachmentError(errorMessage(error));
    }
  }, [vault, activeNote, content, scheduleSave]);

  // Barre d'outils depuis les GROUPES (v0.4.43, Paramètres → Éditeur) :
  // groupe dépliant = un bouton qui déploie sa rangée au survol/appui ;
  // groupe ouvert = boutons côte à côte, séparés entre groupes. Annuler/
  // Rétablir (commands CodeMirror natives) et Pièce jointe (importAttachment
  // + insert au curseur) sont des ids de la config branchés sur leurs
  // handlers réels.




  // //8. ⭐ FAVORIS
  // //////////////////////////////////////////////////////////////////////

  // Résout chaque relPath favori (préférence app-level, voir
  // PreferencesContext.tsx) en son nœud RÉEL dans l'arbre courant — un
  // chemin qui ne correspond plus à rien (note renommée/déplacée/supprimée
  // depuis qu'elle a été mise en favori) est ignoré silencieusement plutôt
  // que de planter ou d'afficher une ligne fantôme.
  const favoriteNotes = useMemo(() => {
    const notes: VaultNoteNode[] = [];
    for (const relPath of preferences.favoriteRelPaths) {
      const found = findNodeByPath(tree, relPath);
      if (found && found.type === 'note') notes.push(found);
    }
    return notes;
  }, [preferences.favoriteRelPaths, tree]);

  // //11. 🗂️ ONGLETS — résolution pour le rendu
  // //////////////////////////////////////////////////////////////////////

  // Les relPaths des onglets n'ont ni nom ni kind : chaque onglet est
  // re-résolu dans l'arbre (même logique que favoriteNotes ci-dessus). Un
  // chemin devenu obsolète disparaît de la BARRE mais reste dans la liste
  // persistée jusqu'au prochain applyOpenTabs (la restauration au
  // changement de coffre le purge aussi) — jamais de ligne fantôme.
  const openTabs = useMemo(() => {
    const nodes: VaultNoteNode[] = [];
    for (const relPath of openTabRelPaths) {
      const found = findNodeByPath(tree, relPath);
      if (found && found.type === 'note') nodes.push(found);
    }
    return nodes;
  }, [openTabRelPaths, tree]);

  // //9. 🖱️ MULTI-SÉLECTION
  // //////////////////////////////////////////////////////////////////////

  // Reçoit tous les clics sur une ligne NOTE de l'explorateur (voir
  // VaultTreeView.tsx, prop `onOpenNote`) — les dossiers restent gérés à
  // part (toggle du repli) et ne passent jamais par ici. Ctrl/Cmd+clic
  // bascule la ligne dans la sélection SANS ouvrir la note ; Shift+clic
  // étend la sélection depuis `lastClickedRelPath` (le dernier élément
  // cliqué, PAS le début de la sélection courante) jusqu'à la ligne
  // cliquée, dans l'ordre d'affichage APLATI et VISIBLE de l'arbre
  // (flattenVisibleNotes — dossiers repliés exclus, comme ce que
  // l'utilisatrice voit réellement à l'écran) ; un clic simple sans
  // modificateur vide la sélection multiple et ouvre la note normalement
  // (comportement inchangé pour qui n'utilise jamais la multi-sélection).
  const handleRowPress = useCallback(
    (node: VaultNoteNode, modifiers: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => {
      if (modifiers.ctrlKey || modifiers.metaKey) {
        setSelectedRelPaths((prev) => {
          const next = new Set(prev);
          if (next.has(node.relPath)) next.delete(node.relPath);
          else next.add(node.relPath);
          return next;
        });
        setLastClickedRelPath(node.relPath);
        return;
      }

      if (modifiers.shiftKey && lastClickedRelPath) {
        const visible = flattenVisibleNotes(tree, collapsedPaths);
        const fromIndex = visible.findIndex((n) => n.relPath === lastClickedRelPath);
        const toIndex = visible.findIndex((n) => n.relPath === node.relPath);
        if (fromIndex !== -1 && toIndex !== -1) {
          const [start, end] = fromIndex < toIndex ? [fromIndex, toIndex] : [toIndex, fromIndex];
          setSelectedRelPaths(new Set(visible.slice(start, end + 1).map((n) => n.relPath)));
        } else {
          // L'un des deux repères a disparu de la vue actuelle (dossier
          // replié entre-temps) — repli sur une sélection d'un seul élément
          // plutôt que planter ou étendre sur une plage incohérente.
          setSelectedRelPaths(new Set([node.relPath]));
        }
        setLastClickedRelPath(node.relPath);
        return;
      }

      setSelectedRelPaths(new Set());
      setLastClickedRelPath(node.relPath);
      void openNote(node);
    },
    [tree, collapsedPaths, lastClickedRelPath, openNote],
  );

  // Changer de coffre invalide toute sélection en cours — les relPaths
  // n'ont plus aucun sens dans le nouveau vault. Réagit à un changement
  // d'état EXTERNE (coffre actif, voir VaultsContext), pas un état
  // dérivable pendant le rendu : c'est exactement le rôle d'un effet (même
  // exception que l'effet de révélation de la note active plus haut).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedRelPaths(new Set());
    setLastClickedRelPath(null);
  }, [vaultPath]);

  // "Déplacer…" de la barre d'actions groupées — MoveDialog en mode multi
  // (voir sa prop `multiCount`), déplace chaque relPath sélectionné
  // séquentiellement vers LA MÊME destination choisie (réutilise
  // `vault.move`, comme `performMove` ci-dessus mais sans son
  // `refreshTree()` à chaque itération — un seul rafraîchissement à la fin
  // suffit pour un lot). Même mise à jour de `activeNote` que `performMove`
  // si l'un des éléments déplacés est (ou contient) la note ouverte.
  const submitBulkMove = useCallback(
    async (destinationRelPath?: string) => {
      if (!vault) return;
      const relPaths = [...selectedRelPaths];
      setBulkMoveOpen(false);
      for (const relPath of relPaths) {
        try {
          const result = await vault.move(relPath, destinationRelPath);
          updateOpenTabsAfterPathChange(relPath, result.relPath);
          setActiveNote((current) => {
            if (!current) return current;
            if (current.relPath === relPath) {
              return { ...current, relPath: result.relPath, name: result.name };
            }
            if (isPathAffected(current.relPath, relPath)) {
              setContent('');
              return null;
            }
            return current;
          });
        } catch (error) {
          console.error('[vault] échec du déplacement groupé :', error);
        }
      }
      setSelectedRelPaths(new Set());
      await refreshTree();
    },
    [vault, selectedRelPaths, refreshTree, updateOpenTabsAfterPathChange],
  );

  // "Supprimer" de la barre d'actions groupées — boucle sur `vault.delete`
  // (même handler que la suppression simple) : CHAQUE élément déclenche
  // donc sa propre confirmation native (voir vault:delete dans
  // apps/desktop/electron/vault.ts) — jamais de suppression groupée
  // silencieuse, au prix d'une boîte de dialogue par fichier plutôt qu'une
  // seule pour tout le lot (pas de nouvel handler IPC dédié pour ce
  // scénario, cohérent avec la consigne de réutiliser vault.delete tel
  // quel). Annuler la confirmation d'UN fichier n'annule pas les suivants.
  const handleBulkDelete = useCallback(async () => {
    if (!vault) return;
    const relPaths = [...selectedRelPaths];
    for (const relPath of relPaths) {
      try {
        const { deleted } = await vault.delete(relPath);
        if (!deleted) continue; // annulé pour CE fichier précis
        updateOpenTabsAfterPathChange(relPath, null);
        setActiveNote((current) => {
          if (!current) return current;
          if (isPathAffected(current.relPath, relPath)) {
            setContent('');
            return null;
          }
          return current;
        });
      } catch (error) {
        console.error('[vault] échec de la suppression groupée :', error);
      }
    }
    setSelectedRelPaths(new Set());
    await refreshTree();
  }, [vault, selectedRelPaths, refreshTree, updateOpenTabsAfterPathChange]);

  // //10. 🏷️ VUE TAGS
  // //////////////////////////////////////////////////////////////////////

  // Bascule Fichiers ⇄ Tags (bouton à côté du tri ⇅) — charge la liste des
  // tags À LA DEMANDE, seulement au moment où on bascule VERS la vue Tags
  // (pas en permanence, pas de flux poussé) : voir vault:list-tags
  // (apps/desktop/electron/search.ts), qui reparcourt le coffre à chaque
  // appel comme le reste de la recherche.
  const toggleExplorerViewMode = useCallback(async () => {
    if (explorerViewMode === 'tags') {
      setExplorerViewMode('files');
      return;
    }
    setExplorerViewMode('tags');
    if (!vault) return;
    setTagsLoading(true);
    try {
      setTagGroups(await vault.listTags());
    } catch (error) {
      console.error('[vault] échec du chargement des tags :', error);
    } finally {
      setTagsLoading(false);
    }
  }, [explorerViewMode, vault]);

  const toggleExpandedTag = useCallback((tag: string) => {
    setExpandedTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  }, []);

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
    // Cas web (File System Access API) : un coffre ENREGISTRÉ mais dont la
    // permission a expiré (le navigateur ne la garde pas d'une session à
    // l'autre) atterrit ici — le registre IndexedDB le connaît toujours. On
    // propose de le RÉACTIVER en un clic (requestPermission dans le geste,
    // voir webVaultRegistry.activate) plutôt que de le faire re-choisir le
    // dossier : sans ça, chaque session semblait « réinstaller » l'app de
    // zéro alors qu'un seul clic suffisait.
    return (
      <View style={styles.centered}>
        <Text style={[styles.title, { color: theme.text }]}>📝 Notes</Text>
        {vaults.length > 0 && (
          <>
            <Text style={[styles.muted, { color: theme.textMuted }]}>
              Réactive ton coffre pour cette session — le navigateur demande à nouveau la permission des dossiers locaux à chaque ouverture.
            </Text>
            {vaults.map((vaultEntry) => (
              <Pressable
                key={vaultEntry.id}
                onPress={() => void switchVault(vaultEntry.id)}
                style={[styles.button, { backgroundColor: theme.accent }]}
              >
                <Text style={styles.buttonText}>Réactiver « {vaultEntry.name} »</Text>
              </Pressable>
            ))}
          </>
        )}
        {vaults.length === 0 && (
          <Text style={[styles.muted, { color: theme.textMuted }]}>
            Choisis un dossier local pour en faire ton vault.
          </Text>
        )}
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
    // paddingTop : rien ne réservait la hauteur de la barre système — le
    // chemin du coffre et le titre inline passaient SOUS l'horloge.
    <View style={[styles.row, { paddingTop: StatusBar.currentHeight ?? 0 }]}>
      <View
        ref={listAreaRef}
        style={[
          styles.list,
          {
            // Même largeur que explorerWidth (plus haut) — qui pilote aussi
            // l'empilement de l'en-tête.
            width: explorerWidth,
            borderColor: theme.border,
            backgroundColor: theme.surface,
          },
        ]}
      >
        <View style={styles.listHeader}>
          <Text style={[styles.vaultPath, { color: theme.textMuted }]} numberOfLines={1}>
            {vaultPath}
          </Text>
          {/* Bouton « + » (v0.4.50, demande : remplacer le large « + Nouvelle
              note » par une icône à côté des autres) — il ouvre le MÊME menu
              de création que le clic droit dans le vide de l'explorateur
              (showContextMenuFor(null)) : nouvelle note, dossier, canvas,
              graphique, excalidraw, fichier de code (choix du langage).
              Menu natif Electron sur desktop, carte tactile ActionMenu sur
              Android — un seul branchement, presentMenu. À l'étroit, les
              icônes se partagent la ligne (searchButtonFlex). */}
          <View style={styles.listHeaderActions}>
            <View style={styles.listHeaderIcons}>
              <Pressable
                onPress={() => showContextMenuFor(null)}
                accessibilityLabel="Créer (note, dossier, canvas…)"
                style={[styles.searchButton, explorerHeaderStacked && styles.searchButtonFlex, { borderColor: theme.border }]}
              >
                <Text style={{ color: theme.text }}>+</Text>
              </Pressable>
              <Pressable
                onPress={() => setSearchOpen(true)}
                style={[styles.searchButton, explorerHeaderStacked && styles.searchButtonFlex, { borderColor: theme.border }]}
                accessibilityLabel="Rechercher"
              >
                <Text style={{ color: theme.text }}>🔍</Text>
              </Pressable>
              <Pressable
                onPress={showSortMenu}
                style={[styles.searchButton, explorerHeaderStacked && styles.searchButtonFlex, { borderColor: theme.border }]}
                accessibilityLabel="Ordre de tri"
              >
                <Text style={{ color: theme.text }}>⇅</Text>
              </Pressable>
              <Pressable
                onPress={() => void rescanVault()}
                disabled={rescanEnCours}
                accessibilityLabel="Actualiser l'arborescence du coffre"
                style={[styles.searchButton, rescanEnCours && { opacity: 0.5 }, { borderColor: theme.border }]}
              >
                <Text style={{ color: rescanEnCours ? theme.accent : theme.text }}>
                  {rescanEnCours ? '…' : '🔄'}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => void toggleExplorerViewMode()}
                style={[
                  styles.searchButton,
                  explorerHeaderStacked && styles.searchButtonFlex,
                  { borderColor: theme.border },
                  explorerViewMode === 'tags' && { backgroundColor: theme.accent, borderColor: theme.accent },
                ]}
                accessibilityLabel={explorerViewMode === 'tags' ? 'Revenir aux fichiers' : 'Voir les tags'}
              >
                <Text style={{ color: explorerViewMode === 'tags' ? '#fff' : theme.text }}>🏷️</Text>
              </Pressable>
            </View>
          </View>
        </View>

        {/* Barre d'actions groupées — visible uniquement à partir de 2
            éléments sélectionnés (voir //9, `handleRowPress`) : 1 seul élément
            n'a pas besoin d'un bandeau dédié, le menu contextuel classique
            suffit déjà pour agir dessus seul. */}
        {rescanEnCours && (
          <Text style={{ color: theme.textMuted, fontSize: 11, paddingHorizontal: 12 }}>
            Actualisation du coffre en arrière-plan…
          </Text>
        )}
        {selectedRelPaths.size >= 2 && (
          <View style={[styles.bulkBar, { borderColor: theme.border, backgroundColor: theme.surface }]}>
            <Text style={[styles.bulkBarText, { color: theme.text }]}>
              {selectedRelPaths.size} éléments sélectionnés
            </Text>
            <Pressable onPress={() => setBulkMoveOpen(true)}>
              <Text style={[styles.bulkBarAction, { color: theme.accent }]}>Déplacer…</Text>
            </Pressable>
            <Pressable onPress={() => void handleBulkDelete()}>
              <Text style={[styles.bulkBarAction, { color: theme.danger }]}>Supprimer</Text>
            </Pressable>
            <Pressable onPress={() => setSelectedRelPaths(new Set())}>
              <Text style={[styles.bulkBarAction, { color: theme.textMuted }]}>Annuler</Text>
            </Pressable>
          </View>
        )}

        {/* "⭐ Favoris" — section FIXE en tête d'explorateur (pas dans le
            ScrollView du dessous) : reste visible même en scrollant une longue
            arborescence, comme une barre de raccourcis. N'apparaît que s'il y
            a au moins un favori RÉSOLU (voir favoriteNotes, //8) — jamais un
            bandeau vide. */}
        {favoriteNotes.length > 0 && (
          <View style={[styles.favoritesSection, { borderColor: theme.border }]}>
            <Text style={[styles.favoritesHeader, { color: theme.textMuted }]}>⭐ Favoris</Text>
            {favoriteNotes.map((node) => (
              <Pressable
                key={node.relPath}
                onPress={() => void openNote(node)}
                style={[
                  styles.favoriteRow,
                  node.relPath === activeNote?.relPath && { backgroundColor: `${theme.accent}22` },
                ]}
              >
                <Text style={styles.icon}><NoteIconByKind kind={node.kind} size={14} /></Text>
                <Text style={{ color: theme.text }} numberOfLines={1}>
                  {node.name}
                </Text>
              </Pressable>
            ))}
          </View>
        )}

        {explorerViewMode === 'files' ? (
          <ScrollView>
            <VaultTreeView
              onOpenFolder={openFolder}
              activeFolderRelPath={previewFolderRelPath}
              nodes={tree}
              theme={theme}
              activeRelPath={activeNote?.relPath}
              collapsedPaths={collapsedPaths}
              onToggleCollapse={toggleCollapse}
              onOpenNote={handleRowPress}
              selectedRelPaths={selectedRelPaths}
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
              onNodeLongPress={showContextMenuFor}
            />
            {tree.length === 0 && (
              <Text style={[styles.muted, { color: theme.textMuted, padding: 16 }]}>
                Aucune note pour l’instant. Clic droit ici pour en créer une.
              </Text>
            )}
          </ScrollView>
        ) : (
          <ScrollView>
            {tagsLoading && (
              <Text style={[styles.muted, { color: theme.textMuted, padding: 16 }]}>Chargement des tags…</Text>
            )}
            {!tagsLoading && tagGroups.length === 0 && (
              <Text style={[styles.muted, { color: theme.textMuted, padding: 16 }]}>
                Aucun mot-clé #tag trouvé dans ce coffre.
              </Text>
            )}
            {!tagsLoading &&
              tagGroups.map((group) => {
                const isExpanded = expandedTags.has(group.tag);
                return (
                  <View key={group.tag}>
                    <Pressable onPress={() => toggleExpandedTag(group.tag)} style={styles.tagRow}>
                      <Text style={styles.icon}>{isExpanded ? '📂' : '📁'}</Text>
                      <Text style={{ color: theme.text }} numberOfLines={1}>
                        #{group.tag} ({group.notes.length})
                      </Text>
                    </Pressable>
                    {isExpanded &&
                      group.notes.map((note) => (
                        <Pressable
                          key={note.relPath}
                          onPress={() => openNoteByRelPath(note.relPath)}
                          style={styles.tagNoteRow}
                        >
                          <Text style={styles.icon}>📝</Text>
                          <Text style={{ color: theme.text }} numberOfLines={1}>
                            {note.name}
                          </Text>
                        </Pressable>
                      ))}
                  </View>
                );
              })}
          </ScrollView>
        )}
      </View>
      <ResizeHandle
        theme={theme}
        side="left"
        collapsed={explorerPanel.collapsed}
        isDragging={explorerPanel.isDragging}
        onMouseDown={explorerPanel.onHandleMouseDown}
        onTouchStart={explorerPanel.onHandleTouchStart}
        onTouchMove={explorerPanel.onHandleTouchMove}
        onTouchEnd={explorerPanel.onHandleTouchEnd}
        onToggleCollapsed={explorerPanel.toggleCollapsed}
      />
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
                  // Validation explicite (Entrée ou ✓) — voir le titre inline
                  // plus bas pour le pourquoi de l'absence de onBlur.
                  <View style={styles.renameRow}>
                    <TextInput
                      autoFocus
                      value={renamingValue}
                      onChangeText={setRenamingValue}
                      onSubmitEditing={() => void submitRename()}
                      onKeyPress={(event) => {
                        if (event.nativeEvent.key === 'Escape') cancelRename();
                      }}
                      style={[styles.editorTitleInput, { color: theme.text, borderColor: theme.accent, flex: 1 }]}
                    />
                    <Pressable
                      onPress={() => void submitRename()}
                      style={[styles.renameAction, { backgroundColor: theme.accent }]}
                      accessibilityLabel="Valider le titre"
                    >
                      <Text style={styles.buttonText}>✓</Text>
                    </Pressable>
                    <Pressable
                      onPress={cancelRename}
                      style={[styles.renameAction, { borderColor: theme.border }]}
                      accessibilityLabel="Annuler le renommage"
                    >
                      <Text style={{ color: theme.textMuted }}>✕</Text>
                    </Pressable>
                  </View>
                ) : (
                  <Pressable onPress={() => startRename({ type: 'note', ...activeNote })}>
                    <Text style={[styles.editorTitle, { color: theme.text }]}>{activeNote.name}</Text>
                  </Pressable>
                ))}
              {/* Groupe de droite de l'en-tête : compteur (markdown
                  uniquement), statut de sauvegarde, menu ⋯ des actions de
                  la note, panneau latéral — regroupés pour que
                  space-between ne disperse pas quatre éléments sur toute
                  la largeur (le titre reste seul à gauche). */}
              <View style={styles.editorHeaderRight}>
                <Text style={[styles.status, { color: theme.textMuted }]}>
                  {status === 'saving' && 'Enregistrement…'}
                  {status === 'saved' && 'Enregistré'}
                  {status === 'error' && '⚠️ Échec de la sauvegarde'}
                </Text>
                <Pressable
                  onPress={showEditorActionsMenu}
                  style={styles.sidebarToggle}
                  accessibilityLabel="Actions de la note (renommer, déplacer, dupliquer, supprimer)"
                >
                  <Text style={{ color: theme.textMuted }}>⋯</Text>
                </Pressable>
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
            </View>

            {/* Barre d'onglets (//11) — montrée à partir de DEUX onglets :
                avec un seul, le titre de l'en-tête joue déjà ce rôle et la
                barre ne serait qu'un doublon visuel. Défilement horizontal
                si les onglets débordent (longues arborescences). */}
            {openTabs.length >= 2 && (
              <View style={[styles.tabBar, { borderBottomColor: theme.border }]}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  {openTabs.map((node) => {
                    const isActive = node.relPath === activeNote.relPath;
                    return (
                      <View
                        key={node.relPath}
                        style={[
                          styles.tab,
                          { borderColor: theme.border },
                          isActive && { backgroundColor: `${theme.accent}22`, borderColor: theme.accent },
                        ]}
                      >
                        <Pressable
                          onPress={() => void openNote(node)}
                          style={styles.tabLabel}
                          accessibilityLabel={
                            isActive ? `Onglet actif : ${node.name}` : `Activer l'onglet ${node.name}`
                          }
                        >
                          <Text style={styles.tabIcon}><NoteIconByKind kind={node.kind} size={14} /></Text>
                          <Text
                            style={[styles.tabName, { color: isActive ? theme.accent : theme.textMuted }]}
                            numberOfLines={1}
                          >
                            {node.name}
                          </Text>
                        </Pressable>
                        <Pressable
                          onPress={() => closeTab(node.relPath)}
                          style={styles.tabClose}
                          accessibilityLabel={`Fermer l'onglet ${node.name}`}
                        >
                          <Text style={{ color: theme.textMuted, fontSize: 12 }}>✕</Text>
                        </Pressable>
                      </View>
                    );
                  })}
                </ScrollView>
              </View>
            )}

            <View style={styles.editorMainRow}>
              <View style={styles.noteContent}>
                {activeNote.kind === 'canvas' ? (
                  <View style={styles.editorBody}>
                    {isNativeNotes ? (
                      <NativeFileTypeUnavailable color={theme.textMuted} />
                    ) : (
                      <CanvasEditor relPath={activeNote.relPath} onOpenNote={openNoteByRelPath} />
                    )}
                  </View>
                ) : activeNote.kind === 'chart' ? (
                  <View style={styles.editorBody}>
                    {isNativeNotes ? (
                      <NativeFileTypeUnavailable color={theme.textMuted} />
                    ) : (
                      <ChartEditor relPath={activeNote.relPath} />
                    )}
                  </View>
                ) : activeNote.kind === 'excalidraw' ? (
                  <View style={styles.editorBody}>
                    {isNativeNotes ? (
                      <NativeFileTypeUnavailable color={theme.textMuted} />
                    ) : (
                      <ExcalidrawEditor relPath={activeNote.relPath} />
                    )}
                  </View>
                ) : activeNote.kind === 'code' ? (
                  // Fichier de programmation (.py/.ts/.js/…) — CodeEditor
                  // (coloration syntaxique + soulignements d'erreurs/
                  // avertissements, voir lib/codeLanguages.ts/codeLint.ts).
                  // PC/web uniquement : CodeMirror est un composant web,
                  // comme MdxEditor (le natif garde son message dédié).
                  <View style={styles.editorBody}>
                    {isNativeNotes ? (
                      <NativeFileTypeUnavailable color={theme.textMuted} />
                    ) : (
                      <CodeEditor
                        value={content}
                        onChange={handleChangeContent}
                        fileName={activeNote.name}
                        theme={theme}
                        fontSize={Math.min(preferences.editorFontSize, 16)}
                        onReady={(ref) => {
                          viewRef.current = ref.view ?? null;
                        }}
                      />
                    )}
                  </View>
                ) : (
                  <>
                    {preferences.editorInlineTitle &&
                      (activeNoteIsRenaming ? (
                        // Validation EXPLICITE uniquement (Entrée ou ✓) : le
                        // onBlur auto-submit ferait fermer le champ à la
                        // première secousse de mise en page (clavier
                        // Android, focus volé par l'éditeur web sur PC) —
                        // « n'ouvre pas de champ » sur PC, « 2 » ajoutés
                        // sur Android (vécu 2026-10-02).
                        <View style={styles.renameRow}>
                          <TextInput
                            autoFocus
                            value={renamingValue}
                            onChangeText={setRenamingValue}
                            onSubmitEditing={() => void submitRename()}
                            onKeyPress={(event) => {
                              if (event.nativeEvent.key === 'Escape') cancelRename();
                            }}
                            style={[styles.editorTitleInline, { color: theme.text, borderColor: theme.accent, flex: 1 }]}
                          />
                          <Pressable
                            onPress={() => void submitRename()}
                            style={[styles.renameAction, { backgroundColor: theme.accent }]}
                            accessibilityLabel="Valider le titre"
                          >
                            <Text style={styles.buttonText}>✓</Text>
                          </Pressable>
                          <Pressable
                            onPress={cancelRename}
                            style={[styles.renameAction, { borderColor: theme.border }]}
                            accessibilityLabel="Annuler le renommage"
                          >
                            <Text style={{ color: theme.textMuted }}>✕</Text>
                          </Pressable>
                        </View>
                      ) : (
                        <Pressable onPress={() => startRename({ type: 'note', ...activeNote })}>
                          <Text style={[styles.editorTitleInline, { color: theme.text }]}>
                            {activeNote.name}
                          </Text>
                        </Pressable>
                      ))}
                    <View style={[styles.modeRow, { borderColor: theme.border }]}>
                      {((
                        isNativeNotes
                          ? ([['source', 'Source'], ['split', 'Intermédiaire'], ['reading', 'Aperçu']] as [ViewMode, string][])
                          : ([['source', 'Source'], ['split', 'Intermédiaire'], ['reading', 'Aperçu']] as [ViewMode, string][])
                      )).map(([mode, label]) => (
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
                      {/* Pièce jointe : désormais un bouton de la barre
                          d'outils (groupe « Divers » par défaut, demande
                          2026-10-05) — ce bouton à part est retiré. */}
                    </View>
                    {attachmentError && <Text style={[styles.error, { color: theme.danger }]}>⚠️ {attachmentError}</Text>}
                    {wikilinkNotice && <Text style={[styles.error, { color: theme.danger }]}>⚠️ {wikilinkNotice}</Text>}

                    {/* Mode Intermédiaire uniquement ici (avant la barre d'outils/CodeMirror) —
                        en mode Aperçu, la même carte est rendue PLUS BAS, à
                        l'intérieur du ScrollView de lecture, pour qu'elle défile
                        avec le reste de la note au lieu de rester figée en haut
                        (bug rapporté). CodeMirror gère son propre scroll interne
                        (voir MdxEditor.tsx) — l'y imbriquer de la même façon
                        casserait exactement le genre de flexbug déjà rencontré
                        sur cet éditeur (éditeur figé/largeur cassée) ; la carte
                        reste donc fixe au-dessus en Intermédiaire, mais
                        repliable (voir PropertiesBlock.tsx) pour rester moins
                        gênante pendant la frappe. */}
                    {!isNativeNotes && effectiveViewMode !== 'reading' && (
                      <EditorToolbar
                        items={(() => {
                          const items: { id: string; label: string; divider?: boolean; subItems?: { id: string; label: string }[]; run?: { id: string; formatRun?: (text: string, selection: Selection) => FormattingResult } }[] = [];
                          preferences.notesToolbarGroups.forEach((group, groupIndex) => {
                            if (groupIndex > 0) {
                              items.push({ id: `divider-${group.id}`, label: '', divider: true });
                            }
                            const resolved = group.buttons
                              .map((id) => NOTES_TOOLBAR_ACTIONS.find((action) => action.id === id))
                              .filter((action): action is ToolbarAction => Boolean(action));
                            if (group.collapsible) {
                              items.push({
                                id: `group-${group.id}`,
                                label: group.label,
                                subItems: resolved.map((action) => ({ id: action.id, label: action.label })),
                              });
                            } else {
                              resolved.forEach((action, index) => {
                                if (index > 0) items.push({ id: `divider-${group.id}-${index}`, label: '', divider: true });
                                items.push({ id: action.id, label: action.label, run: { id: action.id, formatRun: action.run } });
                              });
                            }
                          });
                          return items;
                        })()}
                        theme={theme}
                        onItemRun={(item) => {
                          if (!item.run) return;
                          if (item.run.id === 'template') {
                            showTemplateMenu();
                            return;
                          }
                          if (item.run.id === 'lint') {
                            handleChangeContent(lintMarkdown(contentRef.current));
                            return;
                          }
                          if (item.run.id === 'attach') {
                            void handleInsertAttachment();
                            return;
                          }
                          if (item.run.id === 'undo' || item.run.id === 'redo') {
                            const view = viewRef.current;
                            if (view) {
                              void import('@codemirror/commands').then((commands) => (item.run!.id === 'undo' ? commands.undo : commands.redo)(view));
                            }
                            return;
                          }
                          if (item.run.formatRun) applyFormatting(item.run.formatRun);
                        }}
                      />
                    )}

                    <View style={styles.editorBody}>
                      {effectiveViewMode === 'reading' ? (
                        <NativeReadingScroll scrollbarColor={`${theme.accent}88`}>
                          {/* À l'intérieur du ScrollView (pas au-dessus, contrairement
                              au mode Intermédiaire) : défile avec le reste de la note
                              plutôt que de rester figée en haut — possible ici sans
                              risque, `NoteRenderer` est un simple rendu, pas un
                              CodeMirror avec son propre scroll interne à préserver. */}
                          <PropertiesBlock
                            theme={theme}
                            activeNote={activeNote}
                            content={content}
                            onChangeContent={handleChangeContent}
                            tree={tree}
                          />
                          <NoteRenderer
                            content={bodyOnly}
                            theme={theme}
                            onOpenWikilink={(t) => void handleOpenWikilink(t)}
                            knownOccurrenceWords={knownOccurrenceWords}
                            onOpenOccurrence={handleOpenOccurrence}
                          />
                        </NativeReadingScroll>
                      ) : isNativeNotes && effectiveViewMode === 'split' ? (
                        // Intermédiaire natif — le MÊME éditeur web que le
                        // desktop (CodeMirror + aperçu vivant) embarqué dans
                        // une WebView en HAUTEUR AUTO : le bloc Propriétés
                        // ET le texte défilent ENSEMBLE dans le ScrollView
                        // natif (demande 2026-10-02 : « il doit se défiler
                        // comme le reste ») — même esprit que le scroll
                        // commun du desktop. Même coquille que la lecture :
                        // barre de défilement maintenable au doigt
                        // (demande 2026-10-03).
                        <NativeReadingScroll scrollbarColor={`${theme.accent}88`}>
                          <PropertiesBlock
                            theme={theme}
                            activeNote={activeNote}
                            content={content}
                            onChangeContent={handleChangeContent}
                            tree={tree}
                          />
                          <MdxEditorWeb
                            value={content}
                            onChange={handleChangeContent}
                            onOpenWikilink={(t) => void handleOpenWikilink(t)}
                            onCreateOccurrence={handleCreateOccurrence}
                            occurrenceWords={occurrenceWordList}
                            noteNames={noteNameList}
                            theme={theme}
                            fontSize={preferences.editorFontSize}
                            fontFamily={preferences.editorFontFamily}
                            closeBrackets={preferences.editorCloseBrackets}
                            autoHeight
                          />
                        </NativeReadingScroll>
                      ) : isNativeNotes ? (
                        // Mode Source natif — le MÊME éditeur web que
                        // l'Intermédiaire, SANS l'aperçu vivant (l'extension
                        // n'est pas envoyée à la WebView) : l'ancien
                        // TextInput natif ne permettait ni coloration ni
                        // barre de défilement manipulable (Android ne sait
                        // pas faire défiler un TextInput par programme —
                        // vécu 2026-10-04 : « le glisser ne répond pas »).
                        <NativeReadingScroll scrollbarColor={`${theme.accent}88`}>
                          <MdxEditorWeb
                            value={content}
                            onChange={handleChangeContent}
                            onOpenWikilink={(t) => void handleOpenWikilink(t)}
                            onCreateOccurrence={handleCreateOccurrence}
                            occurrenceWords={occurrenceWordList}
                            noteNames={noteNameList}
                            theme={theme}
                            fontSize={preferences.editorFontSize}
                            fontFamily={preferences.editorFontFamily}
                            closeBrackets={preferences.editorCloseBrackets}
                            livePreview={false}
                            autoHeight
                          />
                        </NativeReadingScroll>
                      ) : effectiveViewMode === 'split' ? (
                        /* v0.4.37 : le bloc Propriétés fait partie du MÊME
                           scroll que le texte (demande : « qu'elle fasse partie
                           du scroll ») — ScrollView commune, CodeMirror en
                           hauteur auto (pas de scroll interne propre). */
                        <ScrollView style={styles.previewFull} contentContainerStyle={{ paddingBottom: 40 }}>
                          <PropertiesBlock
                            theme={theme}
                            activeNote={activeNote}
                            content={content}
                            onChangeContent={handleChangeContent}
                            tree={tree}
                          />
                          <MdxEditor
                            value={bodyOnly}
                            onChange={handleChangeBody}
                            livePreview
                            autoHeight
                            theme={theme}
                            onOpenWikilink={(t) => void handleOpenWikilink(t)}
                            onOpenOccurrence={handleOpenOccurrence}
                            occurrenceWords={occurrenceWordList}
                            onCreateOccurrence={handleCreateOccurrence}
                            noteNames={noteNameList}
                            resolveEmbedUrl={embedUrlResolver}
                            fontSize={preferences.editorFontSize}
                            fontFamily={preferences.editorFontFamily}
                            closeBrackets={preferences.editorCloseBrackets}
                            shortcuts={noteShortcuts}
                            onReady={(ref: ReactCodeMirrorRef) => {
                              viewRef.current = ref.view ?? null;
                            }}
                          />
                        </ScrollView>
                      ) : (
                        <MdxEditor
                          value={content}
                          onChange={handleChangeContent}
                          livePreview={false}
                          theme={theme}
                          onOpenWikilink={(t) => void handleOpenWikilink(t)}
                          onOpenOccurrence={handleOpenOccurrence}
                          occurrenceWords={occurrenceWordList}
                          onCreateOccurrence={handleCreateOccurrence}
                          noteNames={noteNameList}
                          fontSize={preferences.editorFontSize}
                          fontFamily={preferences.editorFontFamily}
                          closeBrackets={preferences.editorCloseBrackets}
                          shortcuts={noteShortcuts}
                          onReady={(ref: ReactCodeMirrorRef) => {
                            viewRef.current = ref.view ?? null;
                          }}
                        />
                      )}
                    </View>
                    {/* Barre bas d'éditeur : compteur + statut de sauvegarde
                        (demande 2026-10-02 — sortis de l'en-tête où ils
                        écrasaient le titre sur téléphone). Toujours visible
                        quand une note markdown est ouverte. */}
                    <View style={[styles.editorStatusBar, { borderTopColor: theme.border }]}>
                      <Text style={[styles.status, { color: theme.textMuted }]}>
                        {formatCount(wordStats.words)} mots · {formatCount(wordStats.characters)} caractères
                      </Text>
                      <Text style={[styles.status, { color: theme.textMuted }]}>
                        {status === 'saving' && 'Enregistrement…'}
                        {status === 'saved' && 'Enregistré'}
                        {status === 'error' && '⚠️ Échec de la sauvegarde'}
                      </Text>
                    </View>
                  </>
                )}
              </View>

              {sidebarOpen && (
                <>
                  <ResizeHandle
                    theme={theme}
                    side="right"
                    collapsed={false}
                    isDragging={rightPanelWidth.isDragging}
                    onMouseDown={rightPanelWidth.onHandleMouseDown}
                    onTouchStart={rightPanelWidth.onHandleTouchStart}
                    onTouchMove={rightPanelWidth.onHandleTouchMove}
                    onTouchEnd={rightPanelWidth.onHandleTouchEnd}
                    onToggleCollapsed={() => setSidebarOpen(false)}
                  />
                  <RightSidebar
                    theme={theme}
                    activeTab={sidebarTab}
                    onSelectTab={setSidebarTab}
                    width={rightPanelWidth.width}
                  >
                    {sidebarTab === 'properties' ? (
                      <PropertiesPanel
                        theme={theme}
                        activeNote={activeNote}
                        content={content}
                        onChangeContent={handleChangeContent}
                        tree={tree}
                      />
                    ) : sidebarTab === 'outline' ? (
                      // Plan de la note (v0.4.44) : titres cliquables = saut
                      // dans l'éditeur (Source/Intermédiaire via l'EditorView ;
                      // en Aperçu ou en WebView native, la liste reste
                      // consultable sans saut). canJump reflète la condition
                      // « un éditeur CodeMirror est monté » SANS lire le ref
                      // pendant le rendu (interdit par react-hooks/refs) :
                      // l'éditeur est monté ssi mode non-lecture côté web.
                      <OutlinePanel
                        body={bodyOnly}
                        theme={theme}
                        canJump={!isNativeNotes && effectiveViewMode !== 'reading'}
                        onJump={(offset) => {
                          const view = viewRef.current;
                          if (!view) return;
                          view.dispatch({ selection: { anchor: offset }, scrollIntoView: true });
                          view.focus();
                        }}
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
                </>
              )}
            </View>
          </>
        ) : previewFolderRelPath && tree.length > 0 ? (
          <FolderPreview
            folderRelPath={previewFolderRelPath}
            tree={tree}
            theme={theme}
            onOpenNote={(node) => void openNote(node)}
            onOpenFolder={openFolder}
          />
        ) : (
          <View style={styles.centered}>
            <Text style={[styles.muted, { color: theme.textMuted }]}>
              Sélectionne ou crée une note.
            </Text>
          </View>
        )}
      </View>

      {/* Un seul MoveDialog pour les deux usages — "Déplacer vers…" sur UN
          élément (movingNode) et "Déplacer…" groupé sur la multi-sélection
          (bulkMoveOpen, voir //9) : les deux ne peuvent jamais être actifs en
          même temps (rien dans l'UI ne permet d'ouvrir l'un pendant que
          l'autre est déjà ouvert), donc dispatcher `onSelect`/`onCancel`
          selon lequel des deux est actif suffit, pas besoin de deux Modal
          montés. */}
      {/* Menu d'actions natif (tactile) — voit les items posés par
          presentMenu ; sur web c'est le pont Electron qui tient ce rôle. */}
      <ActionMenu
        visible={nativeMenu !== null}
        title={nativeMenu?.title}
        items={nativeMenu?.items ?? []}
        onPick={(id) => closeNativeMenu(id)}
        onClose={() => closeNativeMenu(null)}
        theme={theme}
      />

      <MoveDialog
        node={movingNode}
        multiCount={bulkMoveOpen ? selectedRelPaths.size : undefined}
        tree={tree}
        theme={theme}
        onSelect={(destination) => (bulkMoveOpen ? void submitBulkMove(destination) : void submitMove(destination))}
        onCancel={() => (bulkMoveOpen ? setBulkMoveOpen(false) : cancelMove())}
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
          onOpenResult={(result) => {
            setSearchOpen(false);
            // Note/canvas/graphique/excalidraw : s'ouvre directement ICI
            // (openNoteByRelPath, pas besoin de repasser par App.tsx
            // puisqu'on est déjà sur Notes) — tâche/évènement : remontés à
            // App.tsx via onRequestOpenTask/onRequestOpenCalendarDate, qui
            // basculent d'écran ET révèlent l'élément (voir Props
            // ci-dessus).
            openSearchResult(result, {
              openNote: openNoteByRelPath,
              openTask: (taskListId, taskId) => onRequestOpenTask?.(taskListId, taskId),
              openCalendarEvent: (date) => onRequestOpenCalendarDate?.(date),
            });
          }}
          onCancel={() => setSearchOpen(false)}
        />
      )}
    </View>
  );
}

// Aperçu des types de fichier non portés sur natif (canvas / chart /
// excalidraw = bibliothèques DOM, cf. leurs .tsx) — un placeholder vaut
// mieux qu'un crash au montage ; le portage viendra avec le chantier
// d'édition mobile (WebView ou éditeurs natifs).
function NativeFileTypeUnavailable({ color }: { color: string }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <Text style={{ color, textAlign: 'center', fontSize: 13 }}>
        {"L'aperçu de ce type de fichier (canvas, graphique, excalidraw) n'est pas encore disponible\nsur mobile — ouvre-le depuis la version desktop."}
      </Text>
    </View>
  );
}

// Barre de défilement fine à droite de l'éditeur natif — React Native
// n'affiche ses barres qu'un instant pendant le geste, inutilisable pour
// se repérer dans une note longue (demande explicite). Un pouce simple
// positionné par onScroll ; masqué quand le contenu tient dans la vue.
// MAINTENABLE AU DOIGT (demande 2026-10-03 : « la maintenir avec mon doigt
// et la diriger ») : quand `scrollTo` est fourni, la bande de 24 dp à
// droite capte le toucher — la saisie saute à la position du doigt puis le
// suit ; le pouce s'élargit pendant la prise. Sans `scrollTo` (TextInput
// de mode Source : pas de scroll programmatique), elle reste un simple
// indicateur non interactif.
function NativeScrollbar({ viewportHeight, contentHeight, scrollOffset, color, scrollTo }: {
  viewportHeight: number;
  contentHeight: number;
  scrollOffset: number;
  color: string;
  scrollTo?: (y: number) => void;
}) {
  const [dragging, setDragging] = useState(false);
  // Position du pouce PENDANT la prise, pilotée par le doigt : le
  // scrollOffset remonte par un évènement asynchrone (aller-retour natif)
  // et arrive en retard sur le doigt — s'en servir pendant le glisser
  // fait trembler le pouce (vécu 2026-10-04 : « assez instable »). On
  // fige donc la position au geste, puis on rend la main à scrollOffset.
  const [dragThumbTop, setDragThumbTop] = useState<number | null>(null);
  if (contentHeight <= viewportHeight + 1) return null;
  const track = viewportHeight - 8;
  const thumbHeight = Math.max(32, (viewportHeight / contentHeight) * track);
  const maxScroll = contentHeight - viewportHeight;
  const thumbTopFromScroll = maxScroll > 0 ? 4 + (scrollOffset / maxScroll) * (track - thumbHeight) : 4;
  // Position du pouce visée par le doigt : centre du pouce aligné sur le
  // toucher (locationY = position dans la bande), borné au parcours.
  const applyAt = (touchY: number) => {
    const usable = track - thumbHeight;
    if (maxScroll <= 0 || usable <= 0) return;
    const fraction = Math.min(1, Math.max(0, (touchY - thumbHeight / 2) / usable));
    setDragThumbTop(4 + fraction * usable);
    scrollTo?.(fraction * maxScroll);
  };
  const thumbTop = dragThumbTop !== null ? dragThumbTop : thumbTopFromScroll;
  return (
    <View
      pointerEvents={scrollTo ? 'auto' : 'none'}
      style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 24, alignItems: 'flex-end' }}
      {...(scrollTo
        ? {
            onStartShouldSetResponder: () => true,
            onMoveShouldSetResponder: () => true,
            onResponderGrant: (event: GestureResponderEvent) => {
              setDragging(true);
              applyAt(event.nativeEvent.locationY);
            },
            onResponderMove: (event: GestureResponderEvent) => applyAt(event.nativeEvent.locationY),
            onResponderRelease: () => {
              setDragging(false);
              setDragThumbTop(null);
            },
            onResponderTerminate: () => {
              setDragging(false);
              setDragThumbTop(null);
            },
          }
        : {})}
    >
      <View
        style={{
          position: 'absolute',
          right: 2,
          width: dragging ? 8 : 5,
          borderRadius: dragging ? 4 : 2.5,
          backgroundColor: color,
          height: thumbHeight,
          top: Math.min(thumbTop, 4 + track - thumbHeight),
        }}
      />
    </View>
  );
}

// Lecteur du mode Aperçu — le ScrollView existant + la barre de
// défilement (maintenant maintenable au doigt, voir NativeScrollbar).
// Utilisé aussi sur web (même comportement, overlay en plus), et par le
// mode Intermédiaire natif (WebView en hauteur auto — même scroll commun).
function NativeReadingScroll({ scrollbarColor, children }: { scrollbarColor: string; children: ReactNode }) {
  const [viewHeight, setViewHeight] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        ref={scrollRef}
        style={styles.previewFull}
        contentContainerStyle={{ paddingBottom: 40 }}
        onScroll={(event) => setScrollOffset(event.nativeEvent.contentOffset.y)}
        onLayout={(event) => setViewHeight(event.nativeEvent.layout.height)}
        onContentSizeChange={(_, height) => setContentHeight(height)}
        scrollEventThrottle={16}
      >
        {children}
      </ScrollView>
      <NativeScrollbar
        viewportHeight={viewHeight}
        contentHeight={contentHeight}
        scrollOffset={scrollOffset}
        color={scrollbarColor}
        scrollTo={(y) => scrollRef.current?.scrollTo({ y, animated: false })}
      />
    </View>
  );
}

// (L'ancien éditeur Source natif TextInput a été retiré : Android ne sait
// pas faire défiler un TextInput par programme, sa barre de défilement
// restait purement décorative. Le mode Source passe désormais par le même
// éditeur web que l'Intermédiaire, sans aperçu vivant — voir la branche
// `isNativeNotes` du rendu.)

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
    // Replié (largeur 0), l'en-tête ne doit PAS déborder sur l'éditeur —
    // c'était les « boutons parasites » vus par-dessus la note ouverte.
    overflow: 'hidden',
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
  // Groupe des icônes de l'en-tête de l'explorateur (créer / recherche /
  // tri / actualiser / tags).
  listHeaderIcons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  searchButton: {
    width: 34,
    height: 34,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // À l'étroit (rangée dédiée sous le bouton) : les icônes se partagent
  // la largeur au lieu de rester collées à 34 dp.
  searchButtonFlex: {
    flex: 1,
  },
  // Barre d'actions groupées (multi-sélection, //9) — bandeau compact entre
  // l'en-tête de l'explorateur et l'arbre, même esprit visuel que
  // listHeader (bordures/fond du thème).
  bulkBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
  },
  bulkBarText: {
    fontSize: 12,
    fontWeight: '600',
    flex: 1,
  },
  bulkBarAction: {
    fontSize: 12,
    fontWeight: '600',
  },
  // "⭐ Favoris" (//8) — section fixe en tête de l'explorateur.
  favoritesSection: {
    borderBottomWidth: 1,
    paddingVertical: 4,
  },
  favoritesHeader: {
    fontSize: 11,
    fontWeight: '700',
    paddingHorizontal: 12,
    paddingTop: 6,
    paddingBottom: 2,
  },
  favoriteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  // Vue Tags (//10) — un tag dépliable, ses notes indentées dessous.
  tagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  tagNoteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
    paddingLeft: 28,
    paddingRight: 12,
  },
  icon: {
    fontSize: 14,
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
  // Renommage de titre (en-tête et inline) : champ + boutons explicites
  // valider/annuler — voir les commentaires des deux blocs de rendu.
  renameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  renameAction: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
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
  // Groupe de droite de l'en-tête éditeur (compteur + statut + ⋯ + ◀) —
  // voir le commentaire du rendu.
  editorHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  editorMainRow: {
    flex: 1,
    flexDirection: 'row',
  },
  // Barre d'onglets (//11) — rangée fine entre l'en-tête de l'éditeur et
  // la zone de contenu, même esprit visuel que modeRow (bordures du
  // thème). `flexShrink: 1` sur le nom pour que le texte tronque AVANT de
  // pousser le ✕ hors de l'onglet.
  tabBar: {
    borderBottomWidth: 1,
    paddingHorizontal: 6,
    paddingTop: 4,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderBottomWidth: 0,
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    maxWidth: 200,
    marginRight: 4,
  },
  tabLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
    flexShrink: 1,
  },
  tabIcon: {
    fontSize: 12,
  },
  tabName: {
    fontSize: 12,
    flexShrink: 1,
  },
  tabClose: {
    paddingHorizontal: 6,
    paddingVertical: 6,
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
    fontSize: 12,
    paddingHorizontal: 12,
    paddingTop: 4,
  },
  editorBody: {
    flex: 1,
    flexDirection: 'row',
  },
  editorStatusBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderTopWidth: 1,
  },
  previewFull: {
    flex: 1,
    padding: 16,
  },
});
