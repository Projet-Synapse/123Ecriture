import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, PanResponder, Platform, Pressable, StyleSheet, Text, TextInput, View, type LayoutChangeEvent } from 'react-native';
import Svg, { G, Path, Polygon, Text as SvgText } from 'react-native-svg';

import {
  addEdgeIfNew,
  createFileNode,
  createTextNode,
  removeEdge,
  removeNodeCascade,
} from '../../lib/editor/canvas';
import {
  canvasBounds,
  canvasColor,
  edgeGeometry,
  fileNodeLabel,
  fitViewport,
  paintOrder,
  parseCanvas,
  screenToWorld,
  zoomAt,
  type CanvasViewport,
} from '../../lib/editor/canvasView';
import { CANVAS_TOOLBAR_ACTIONS, type CanvasToolbarActionId } from '../../lib/editor/canvasToolbarActions';
import { flattenNotes } from '../../lib/notes/vaultTree';
import { useVaults } from '../../lib/sync/VaultsContext';
import { usePreferences } from '../../preferences/PreferencesContext';
import { DraggablePressable } from '../vault/VaultTreeView';
import { EditorToolbar } from './EditorToolbar';

// ✒️ 123ECRITURE — components/editors/CanvasEditor.tsx — éditeur de canvas (cartes reliées)
//////////////////////////////////////////////////////////////////////////////
//
// Éditeur d'un fichier `.canvas` du coffre (scopé à `relPath`, ouvert/
// fermé/renommé comme n'importe quel fichier de l'arborescence, voir
// NotesScreen.tsx) : cartes — texte ou référence à une note — reliées par
// des flèches sur un plan pannable et zoomable. Lit les vrais fichiers
// Obsidian (JSON Canvas : nœuds text/file/link/group, couleurs, liens
// ancrés par côté — lib/editor/canvasView.ts) et CADRE la vue sur le
// contenu à l'ouverture (avant : vue fixe sur le centre d'un monde de
// 4000 px — un canvas Obsidian, centré sur (0, 0), s'ouvrait VIDE).
// Coordonnées LIBRES (négatives comprises) : le monde n'a plus de bornes.
//
// Invariants du fichier :
//   • Toutes les interactions (glisser une carte, tirer une connexion,
//     panoramiquer le fond) réutilisent le mécanisme HTML5 draggable +
//     évènements délégués sur le conteneur (voir VaultTreeView.tsx/
//     NotesScreen.tsx) — en suivant la position en continu via `drag`,
//     pas seulement au `drop`.
//   • Le déplacement d'une carte ne sauvegarde PAS à chaque frame :
//     updateData(..., false) pendant `drag`, scheduleSave au `drop`.
//   • Un .canvas vide ou au JSON invalide ne fait JAMAIS crasher l'éditeur
//     au montage — repli sur EMPTY_DATA.
//   • Édition (glisser, connecter) : desktop/web (DOM draggable). Mobile :
//     affichage complet, panoramique au doigt, zoom/recadrage aux boutons.
//
// SOMMAIRE :
//   1. État du composant et persistance (chargement, autosave)
//   2. Cartes et barre d'outils
//   3. Glisser, panoramique et connexions (écouteurs délégués)
//   4. Rendu (surface, monde, cartes) et styles
//
//////////////////////////////////////////////////////////////////////////////

//////// 1. État du composant et persistance (chargement, autosave) ////////
const AUTOSAVE_DELAY_MS = 600;
const IS_WEB = Platform.OS === 'web';
// Marge autour du dessin des liens (courbes qui débordent des nœuds).
const EDGE_MARGIN = 240;

type PreviewLine = { x1: number; y1: number; x2: number; y2: number };

function makeId() {
  return Math.random().toString(36).slice(2);
}

type DragInfo =
  | { kind: 'pan'; startClientX: number; startClientY: number; startOffsetX: number; startOffsetY: number }
  | { kind: 'node'; nodeId: string; startClientX: number; startClientY: number; startNodeX: number; startNodeY: number }
  | { kind: 'connector'; fromNodeId: string };

type Props = {
  relPath: string;
  onOpenNote: (relPath: string) => void;
};

const EMPTY_DATA: CanvasData = { nodes: [], edges: [] };

export function CanvasEditor({ relPath, onOpenNote }: Props) {
  const { theme, preferences } = usePreferences();
  const vault = typeof window !== 'undefined' ? window.vault : undefined;
  const contextMenuBridge = typeof window !== 'undefined' ? window.contextMenu : undefined;
  const { activeVaultPath: vaultPath } = useVaults();

  const [data, setData] = useState<CanvasData>(EMPTY_DATA);
  const [tree, setTree] = useState<VaultTreeNode[]>([]);
  // Vue : écran = monde × scale + (x, y) — cadrée sur le contenu au
  // chargement (fitViewport), dès que la taille de la surface est connue.
  const [view, setView] = useState<CanvasViewport>({ x: 0, y: 0, scale: 1 });
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [loaded, setLoaded] = useState(false);
  const fittedRef = useRef<string | null>(null);
  const loadedForRef = useRef<string | null>(null);
  const sizeRef = useRef({ w: 0, h: 0 });
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [previewLine, setPreviewLine] = useState<PreviewLine | null>(null);

  const surfaceRef = useRef<View>(null);
  const dragRef = useRef<DragInfo | null>(null);
  const surfaceRectRef = useRef<{ left: number; top: number } | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Copies "vivantes" lues par les écouteurs délégués — évitent les
  // fermetures périmées (même raison que draggingRelPathRef dans
  // NotesScreen.tsx) sans devoir recréer les écouteurs à chaque frame. Mises
  // à jour dans un effet (pas au corps du render) : muter un ref pendant le
  // rendu est signalé par la même famille de règle que le setState direct
  // dans un effet.
  const dataRef = useRef(data);
  const viewRef = useRef(view);
  useEffect(() => {
    dataRef.current = data;
  }, [data]);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  // CADRAGE AUTOMATIQUE : une fois par fichier, dès que le contenu (fin de
  // lecture) ET la taille de la surface (onLayout) sont connus — appelé
  // par ces deux évènements, quel que soit celui qui arrive en dernier.
  const fitOnce = useCallback(() => {
    const { w, h } = sizeRef.current;
    if (w <= 0 || h <= 0 || loadedForRef.current !== relPath || fittedRef.current === relPath) return;
    fittedRef.current = relPath;
    setView(fitViewport(canvasBounds(dataRef.current.nodes), w, h));
  }, [relPath]);

  const refreshData = useCallback(async () => {
    if (!vault) return;
    try {
      const content = await vault.readNote(relPath);
      // Lecture TOLÉRANTE (BOM, champs manquants, types Obsidian) — un
      // .canvas illisible ne fait JAMAIS crasher l'éditeur.
      const parsed = parseCanvas(content);
      dataRef.current = parsed;
      setData(parsed);
    } catch (error) {
      console.error('[canvas] échec du chargement :', error);
      dataRef.current = EMPTY_DATA;
      setData(EMPTY_DATA);
    } finally {
      loadedForRef.current = relPath;
      setLoaded(true);
      fitOnce();
    }
  }, [vault, relPath, fitOnce]);

  const fitToContent = useCallback(() => {
    setView(fitViewport(canvasBounds(dataRef.current.nodes), size.w, size.h));
  }, [size]);
  const onSurfaceLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    sizeRef.current = { w: width, h: height };
    setSize((prev) => (prev.w === width && prev.h === height ? prev : { w: width, h: height }));
    fitOnce();
  };
  const zoomBy = (factor: number) => setView((v) => zoomAt(v, factor, size.w / 2, size.h / 2));

  useEffect(() => {
    void (async () => {
      await refreshData();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relPath]);

  useEffect(() => {
    if (!vault || !vaultPath) return;
    void vault
      .listTree()
      .then(setTree)
      .catch((error) => console.error('[canvas] échec du chargement de l’arborescence :', error));
  }, [vault, vaultPath]);

  const scheduleSave = useCallback(
    (next: CanvasData) => {
      if (!vault) return;
      setSaveStatus('saving');
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        void vault
          .writeNote(relPath, JSON.stringify(next, null, 2))
          .then(() => setSaveStatus('saved'))
          .catch((error) => console.error('[canvas] échec de la sauvegarde :', error));
      }, AUTOSAVE_DELAY_MS);
    },
    [vault, relPath],
  );

  const updateData = useCallback(
    (updater: (prev: CanvasData) => CanvasData, save = true) => {
      setData((prev) => {
        const next = updater(prev);
        if (save) scheduleSave(next);
        return next;
      });
    },
    [scheduleSave],
  );

//////// 2. Cartes et barre d'outils ///////////////////////////////////////

  // Nouvelle carte au CENTRE de la vue courante (le monde n'a plus de
  // centre fixe : un canvas Obsidian vit autour de (0, 0)).
  const viewCenter = () => {
    const c = screenToWorld(viewRef.current, size.w / 2, size.h / 2);
    const jitter = () => (Math.random() - 0.5) * 120;
    return { x: Math.round(c.x - 110 + jitter()), y: Math.round(c.y - 60 + jitter()) };
  };

  const addTextCard = () => {
    const at = viewCenter();
    updateData((prev) => ({
      ...prev,
      nodes: [...prev.nodes, createTextNode(makeId(), at.x, at.y)],
    }));
  };

  const addNoteCard = () => {
    if (!contextMenuBridge) return;
    const notes = flattenNotes(tree);
    if (notes.length === 0) return;
    void contextMenuBridge.show(notes.map((n) => ({ id: n.relPath, label: n.relPath }))).then((chosenRelPath) => {
      if (!chosenRelPath) return;
      const note = notes.find((n) => n.relPath === chosenRelPath);
      if (!note) return;
      const at = viewCenter();
      updateData((prev) => ({
        ...prev,
        nodes: [...prev.nodes, createFileNode(makeId(), at.x, at.y, note.relPath, note.name)],
      }));
    });
  };

  // Paramètres → Éditeur → "Barre d'outils Canvas" : mêmes ordre/visibilité
  // que Notes (voir NotesScreen.tsx) — filtre les ids masqués, résout
  // chaque id restant dans le registre de métadonnées, puis vers son
  // handler local (le registre ne connaît que id/label, pas l'exécution :
  // voir lib/canvasToolbarActions.ts).
  const canvasActionHandlers: Record<CanvasToolbarActionId, () => void> = {
    'add-text': addTextCard,
    'add-note': addNoteCard,
  };
  const toolbarActions = preferences.canvasToolbarOrder
    .filter((item) => item.visible)
    .map((item) => CANVAS_TOOLBAR_ACTIONS.find((action) => action.id === item.id))
    .filter((action): action is (typeof CANVAS_TOOLBAR_ACTIONS)[number] => Boolean(action));

  const removeNode = (nodeId: string) => updateData((prev) => removeNodeCascade(prev, nodeId));

  const setNodeText = (nodeId: string, text: string) => {
    updateData((prev) => ({
      ...prev,
      nodes: prev.nodes.map((n) => (n.id === nodeId ? { ...n, text } : n)),
    }));
  };

//////// 3. Glisser, panoramique et connexions (écouteurs délégués) ////////

  useEffect(() => {
    const surface = surfaceRef.current as unknown as HTMLElement | null;
    // Mobile : pas de DOM (glisser HTML5 indisponible) — voir panResponder.
    if (!surface || typeof surface.addEventListener !== 'function') return;

    // Zoom à la molette / au pavé tactile, autour du curseur.
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = surface.getBoundingClientRect();
      const factor = Math.exp(-event.deltaY * 0.0015);
      setView((v) => zoomAt(v, factor, event.clientX - rect.left, event.clientY - rect.top));
    };

    const handleDragStart = (event: DragEvent) => {
      const target = event.target as HTMLElement | null;
      surfaceRectRef.current = surface.getBoundingClientRect();
      const roleEl = target?.closest ? (target.closest('[data-canvas-role]') as HTMLElement | null) : null;
      const role = roleEl?.getAttribute('data-canvas-role');
      const nodeId = roleEl?.getAttribute('data-canvas-node-id');
      event.dataTransfer?.setData('text/plain', 'canvas');
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';

      if (role === 'connector' && nodeId) {
        dragRef.current = { kind: 'connector', fromNodeId: nodeId };
      } else if (role === 'card' && nodeId) {
        const node = dataRef.current.nodes.find((n) => n.id === nodeId);
        if (!node) return;
        dragRef.current = {
          kind: 'node',
          nodeId,
          startClientX: event.clientX,
          startClientY: event.clientY,
          startNodeX: node.x,
          startNodeY: node.y,
        };
      } else {
        dragRef.current = {
          kind: 'pan',
          startClientX: event.clientX,
          startClientY: event.clientY,
          startOffsetX: viewRef.current.x,
          startOffsetY: viewRef.current.y,
        };
      }
    };

    // `drag` se répète pendant tout le geste (contrairement à `dragover`,
    // déclenché seulement sur la cible survolée) — c'est ce qui donne le
    // suivi fluide de la carte/du panoramique sous le curseur. Quirk connu
    // de l'API HTML5 DnD : le tout dernier évènement avant `dragend` peut
    // arriver avec clientX/clientY à 0 — on l'ignore.
    const handleDrag = (event: DragEvent) => {
      const drag = dragRef.current;
      if (!drag || (event.clientX === 0 && event.clientY === 0)) return;

      if (drag.kind === 'pan') {
        setView((v) => ({
          ...v,
          x: drag.startOffsetX + (event.clientX - drag.startClientX),
          y: drag.startOffsetY + (event.clientY - drag.startClientY),
        }));
      } else if (drag.kind === 'node') {
        // Déplacement écran → monde (divisé par le zoom).
        const dx = (event.clientX - drag.startClientX) / viewRef.current.scale;
        const dy = (event.clientY - drag.startClientY) / viewRef.current.scale;
        updateData(
          (prev) => ({
            ...prev,
            nodes: prev.nodes.map((n) =>
              n.id === drag.nodeId ? { ...n, x: drag.startNodeX + dx, y: drag.startNodeY + dy } : n,
            ),
          }),
          false, // pas de sauvegarde à chaque frame, seulement au dragend
        );
      } else if (drag.kind === 'connector') {
        const fromNode = dataRef.current.nodes.find((n) => n.id === drag.fromNodeId);
        const rect = surfaceRectRef.current;
        if (!fromNode || !rect) return;
        const to = screenToWorld(viewRef.current, event.clientX - rect.left, event.clientY - rect.top);
        setPreviewLine({
          x1: fromNode.x + fromNode.width,
          y1: fromNode.y + fromNode.height / 2,
          x2: to.x,
          y2: to.y,
        });
      }
    };

    const handleDragOver = (event: DragEvent) => {
      if (dragRef.current) event.preventDefault(); // nécessaire pour autoriser le drop
    };

    const handleDrop = (event: DragEvent) => {
      event.preventDefault();
      const drag = dragRef.current;
      setPreviewLine(null);
      if (drag?.kind === 'connector') {
        const targetEl = document.elementFromPoint(event.clientX, event.clientY);
        const cardEl = targetEl?.closest ? (targetEl.closest('[data-canvas-node-id]') as HTMLElement | null) : null;
        const toNodeId = cardEl?.getAttribute('data-canvas-node-id');
        if (toNodeId) {
          updateData((prev) => addEdgeIfNew(prev, makeId(), drag.fromNodeId, toNodeId));
        }
      } else if (drag?.kind === 'node') {
        // Sauvegarde différée jusqu'ici plutôt qu'à chaque frame de `drag`.
        scheduleSave(dataRef.current);
      }
    };

    const handleDragEnd = () => {
      dragRef.current = null;
      setPreviewLine(null);
    };

    surface.addEventListener('wheel', handleWheel, { passive: false });
    surface.addEventListener('dragstart', handleDragStart);
    surface.addEventListener('drag', handleDrag);
    surface.addEventListener('dragover', handleDragOver);
    surface.addEventListener('drop', handleDrop);
    surface.addEventListener('dragend', handleDragEnd);
    return () => {
      surface.removeEventListener('wheel', handleWheel);
      surface.removeEventListener('dragstart', handleDragStart);
      surface.removeEventListener('drag', handleDrag);
      surface.removeEventListener('dragover', handleDragOver);
      surface.removeEventListener('drop', handleDrop);
      surface.removeEventListener('dragend', handleDragEnd);
    };
  }, [updateData, scheduleSave]);

  // Mobile : panoramique au doigt (le glisser HTML5 n'existe pas).
  const panStartRef = useRef({ x: 0, y: 0 });
  // Faux positif : les refs ne sont lues QUE dans les rappels du geste,
  // jamais pendant le rendu.
  // eslint-disable-next-line react-hooks/refs
  const [panResponder] = useState(() =>
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) + Math.abs(g.dy) > 6,
      onPanResponderGrant: () => {
        panStartRef.current = { x: viewRef.current.x, y: viewRef.current.y };
      },
      onPanResponderMove: (_e, g) => setView((v) => ({ ...v, x: panStartRef.current.x + g.dx, y: panStartRef.current.y + g.dy })),
    }),
  );

//////// 4. Rendu (surface, monde, cartes) et styles ///////////////////////

  if (!vault) {
    return (
      <View style={styles.centered}>
        <Text style={[styles.title, { color: theme.text }]}>🎨 Canvas</Text>
        <Text style={[styles.muted, { color: theme.textMuted }]}>
          Disponible sur la version desktop pour l’instant, avec un coffre choisi.
        </Text>
      </View>
    );
  }

  const byId = new Map(data.nodes.map((n) => [n.id, n]));
  const edges = data.edges.map((e) => edgeGeometry(e, byId)).filter((g): g is NonNullable<typeof g> => g !== null);
  const bounds = canvasBounds(data.nodes) ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  const svgBox = {
    x: Math.min(bounds.minX, previewLine?.x2 ?? bounds.minX) - EDGE_MARGIN,
    y: Math.min(bounds.minY, previewLine?.y2 ?? bounds.minY) - EDGE_MARGIN,
    w: Math.max(bounds.maxX, previewLine?.x2 ?? bounds.maxX) - Math.min(bounds.minX, previewLine?.x2 ?? bounds.minX) + 2 * EDGE_MARGIN,
    h: Math.max(bounds.maxY, previewLine?.y2 ?? bounds.maxY) - Math.min(bounds.minY, previewLine?.y2 ?? bounds.minY) + 2 * EDGE_MARGIN,
  };
  const ordered = paintOrder(data.nodes);
  const groups = ordered.filter((n) => n.type === 'group');
  const cards = ordered.filter((n) => n.type !== 'group');
  const edgeColor = theme.textMuted;

  const renderCardBody = (node: CanvasNode, accent: string | null) => {
    if (node.type === 'text') {
      return (
        <TextInput
          multiline
          value={node.text ?? ''}
          onChangeText={(text) => setNodeText(node.id, text)}
          placeholder="Écris ici…"
          placeholderTextColor={theme.textMuted}
          style={[styles.cardTextInput, { color: theme.text }]}
        />
      );
    }
    if (node.type === 'link') {
      return (
        <Pressable onPress={() => node.url && void Linking.openURL(node.url)} style={styles.cardNoteBody}>
          <Text style={[styles.cardNoteTitle, { color: accent ?? theme.accent }]} numberOfLines={3}>
            🔗 {node.url}
          </Text>
        </Pressable>
      );
    }
    const isNote = /\.(md|mdx)$/i.test(node.file ?? '');
    return (
      <Pressable onPress={() => node.file && isNote && onOpenNote(node.file)} style={styles.cardNoteBody}>
        <Text style={[styles.cardNoteTitle, { color: accent ?? theme.accent }]} numberOfLines={3}>
          {fileNodeLabel(node)}
        </Text>
        {!isNote && node.file ? (
          <Text style={{ color: theme.textMuted, fontSize: 11 }} numberOfLines={1}>
            📎 {node.file}
          </Text>
        ) : null}
      </Pressable>
    );
  };

  return (
    <View style={styles.container}>
      <EditorToolbar
        items={toolbarActions.map((action) => ({
          id: action.id,
          label: action.label,
          onPress: canvasActionHandlers[action.id],
        }))}
        theme={theme}
      />
      {saveStatus !== 'idle' && (
        <Text style={[styles.saveStatus, { color: theme.textMuted }]}>
          {saveStatus === 'saving' ? 'Enregistrement…' : 'Enregistré'}
        </Text>
      )}

      <View
        ref={surfaceRef}
        onLayout={onSurfaceLayout}
        {...(IS_WEB ? {} : panResponder.panHandlers)}
        // Le fond lui-même est glissable (panoramique) — les cartes et
        // poignées, elles-mêmes `draggable`, priment dessus.
        style={[styles.surface, { borderColor: theme.border, backgroundColor: theme.surface }]}
      >
        <DraggablePressable draggable={IS_WEB} dataSet={{ canvasRole: 'background' }} style={StyleSheet.absoluteFill}>
          {/* Monde = boîte englobante du contenu (+ marge), origine en haut à
              gauche : coordonnées négatives comprises, et tous les nœuds restent
              DANS leur parent (sur Android, un enfant hors du parent ne reçoit
              pas les touchers). Écran = (local + box) × scale + vue. */}
          <View
            style={[
              styles.world,
              {
                width: svgBox.w,
                height: svgBox.h,
                transformOrigin: '0 0',
                transform: [
                  { translateX: view.x + svgBox.x * view.scale },
                  { translateY: view.y + svgBox.y * view.scale },
                  { scale: view.scale },
                ],
              },
            ]}
          >
            {groups.map((node) => {
              const c = canvasColor(node.color);
              return (
                <View
                  key={node.id}
                  dataSet={{ canvasNodeId: node.id }}
                  style={[
                    styles.group,
                    {
                      left: node.x - svgBox.x,
                      top: node.y - svgBox.y,
                      width: node.width,
                      height: node.height,
                      borderColor: c ?? theme.border,
                      backgroundColor: `${c ?? theme.textMuted}14`,
                    },
                  ]}
                >
                  {node.label ? (
                    <Text style={[styles.groupLabel, { color: c ?? theme.textMuted }]} numberOfLines={1}>
                      {node.label}
                    </Text>
                  ) : null}
                </View>
              );
            })}

            <Svg
              width={svgBox.w}
              height={svgBox.h}
              viewBox={`${svgBox.x} ${svgBox.y} ${svgBox.w} ${svgBox.h}`}
              style={{ position: 'absolute', left: 0, top: 0 }}
              pointerEvents="box-none"
            >
              {edges.map((g) => {
                const c = g.color ?? edgeColor;
                return (
                  <G key={g.id}>
                    <Path
                      d={g.d}
                      stroke={c}
                      strokeWidth={2}
                      fill="none"
                      onPress={IS_WEB ? () => updateData((prev) => removeEdge(prev, g.id)) : undefined}
                    />
                    {g.arrows.map((points, i) => (
                      <Polygon key={i} points={points} fill={c} />
                    ))}
                    {g.label ? (
                      <SvgText x={g.mid.x} y={g.mid.y - 6} fill={c} fontSize={13} textAnchor="middle">
                        {g.label}
                      </SvgText>
                    ) : null}
                  </G>
                );
              })}
              {previewLine ? (
                <Path
                  d={`M ${previewLine.x1} ${previewLine.y1} L ${previewLine.x2} ${previewLine.y2}`}
                  stroke={theme.accent}
                  strokeWidth={2}
                  strokeDasharray="6 4"
                  fill="none"
                />
              ) : null}
            </Svg>

            {cards.map((node) => {
              const c = canvasColor(node.color);
              return (
                <View key={node.id} style={{ position: 'absolute', left: node.x - svgBox.x, top: node.y - svgBox.y }}>
                  <DraggablePressable
                    draggable={IS_WEB}
                    dataSet={{ canvasNodeId: node.id, canvasRole: 'card' }}
                    style={[
                      styles.card,
                      {
                        width: node.width,
                        height: node.height,
                        backgroundColor: c ? `${c}1f` : theme.background,
                        borderColor: c ?? theme.border,
                        borderWidth: c ? 2 : 1,
                      },
                    ]}
                  >
                    <View style={styles.cardHeader}>
                      <Text style={styles.cardTypeIcon}>{node.type === 'file' ? '📝' : node.type === 'link' ? '🔗' : '🗒️'}</Text>
                      <Pressable onPress={() => removeNode(node.id)} style={styles.cardDeleteButton}>
                        <Text style={{ color: theme.textMuted }}>✕</Text>
                      </Pressable>
                    </View>
                    {renderCardBody(node, c)}
                    {IS_WEB && (
                      <DraggablePressable
                        draggable
                        dataSet={{ canvasNodeId: node.id, canvasRole: 'connector' }}
                        style={[styles.connectorHandle, { backgroundColor: theme.accent }]}
                      >
                        <Text style={styles.connectorHandleText}>➜</Text>
                      </DraggablePressable>
                    )}
                  </DraggablePressable>
                </View>
              );
            })}
          </View>
        </DraggablePressable>

        {/* Zoom et recadrage — la vue se cadre seule à l'ouverture. */}
        <View style={[styles.viewControls, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Pressable onPress={() => zoomBy(1 / 1.25)} style={styles.viewButton} accessibilityLabel="Dézoomer">
            <Text style={{ color: theme.text }}>−</Text>
          </Pressable>
          <Text style={{ color: theme.textMuted, fontSize: 11, minWidth: 40, textAlign: 'center' }}>{Math.round(view.scale * 100)} %</Text>
          <Pressable onPress={() => zoomBy(1.25)} style={styles.viewButton} accessibilityLabel="Zoomer">
            <Text style={{ color: theme.text }}>+</Text>
          </Pressable>
          <Pressable onPress={fitToContent} style={styles.viewButton} accessibilityLabel="Recadrer sur le contenu">
            <Text style={{ color: theme.text }}>⤢</Text>
          </Pressable>
        </View>
        {loaded && data.nodes.length === 0 && (
          <View style={styles.emptyHint} pointerEvents="none">
            <Text style={{ color: theme.textMuted }}>Canvas vide — ajoute une carte avec « + Texte ».</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    gap: 12,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 8,
  },
  title: {
    fontSize: 22,
    fontWeight: '600',
  },
  muted: {
    fontSize: 14,
  },
  saveStatus: {
    fontSize: 11,
    paddingHorizontal: 12,
    paddingTop: 4,
  },
  surface: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    overflow: 'hidden',
  },
  world: {
    position: 'absolute',
    left: 0,
    top: 0,
    overflow: 'visible',
  },
  group: {
    position: 'absolute',
    borderWidth: 2,
    borderRadius: 12,
  },
  groupLabel: {
    position: 'absolute',
    top: -26,
    left: 4,
    fontSize: 16,
    fontWeight: '600',
  },
  viewControls: {
    position: 'absolute',
    right: 10,
    bottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 4,
  },
  viewButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  emptyHint: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 8,
    gap: 6,
    overflow: 'hidden',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardTypeIcon: {
    fontSize: 12,
  },
  cardDeleteButton: {
    paddingHorizontal: 4,
  },
  cardTextInput: {
    fontSize: 13,
    flex: 1,
  },
  cardNoteBody: {
    minHeight: 60,
    justifyContent: 'center',
  },
  cardNoteTitle: {
    fontSize: 13,
    fontWeight: '600',
  },
  // Dans la carte (qui coupe son débordement : texte long d'Obsidian).
  connectorHandle: {
    position: 'absolute',
    right: 4,
    bottom: 4,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  },
  connectorHandleText: {
    color: '#fff',
    fontSize: 10,
  },
});
