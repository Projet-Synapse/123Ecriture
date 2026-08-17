import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  addEdgeIfNew,
  createFileNode,
  createTextNode,
  removeEdge,
  removeNodeCascade,
  WORLD_CENTER,
  WORLD_SIZE,
} from '../lib/canvas';
import { CANVAS_TOOLBAR_ACTIONS, type CanvasToolbarActionId } from '../lib/canvasToolbarActions';
import { flattenNotes } from '../lib/vaultTree';
import { useVaults } from '../lib/sync/VaultsContext';
import { usePreferences } from '../preferences/PreferencesContext';
import { DraggablePressable } from './VaultTreeView';
import { SvgOverlay, type OverlayLine } from './SvgOverlay';

// Éditeur Canvas — cartes (texte ou référence à une note) reliées par des
// flèches sur un plan pannable. Scopé à UN fichier `.canvas` du vault
// (`relPath`), ouvert/fermé/renommé/déplacé comme n'importe quel fichier de
// l'arborescence (voir NotesScreen.tsx) — plus de registre multi-canvas
// séparé (voir la révision documentée dans le plan/la mémoire du projet;
// anciennement CanvasScreen.tsx). Dégraissé pour un v0 (voir le plan) — pas
// de redimensionnement de carte, pas de zoom (panoramique seul), flèches en
// ligne droite. Le "monde" est grand mais BORNÉ (WORLD_SIZE), pas
// littéralement infini.
//
// Toutes les interactions (glisser une carte, tirer une connexion,
// panoramiquer le fond) réutilisent le MÊME mécanisme HTML5
// draggable + évènements délégués sur le conteneur que le reste de l'app
// (voir VaultTreeView.tsx/NotesScreen.tsx) — la différence ici est qu'on
// suit la position en continu via l'évènement `drag` (qui se répète
// pendant tout le geste), pas seulement au `drop`, pour un retour visuel
// fluide pendant qu'on glisse/panoramique.
const AUTOSAVE_DELAY_MS = 600;
const VIEWPORT_WIDTH = 800;
const VIEWPORT_HEIGHT = 520;

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
  const [worldOffset, setWorldOffset] = useState({
    x: -(WORLD_CENTER - VIEWPORT_WIDTH / 2),
    y: -(WORLD_CENTER - VIEWPORT_HEIGHT / 2),
  });
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [previewLine, setPreviewLine] = useState<OverlayLine | null>(null);

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
  const worldOffsetRef = useRef(worldOffset);
  useEffect(() => {
    dataRef.current = data;
  }, [data]);
  useEffect(() => {
    worldOffsetRef.current = worldOffset;
  }, [worldOffset]);

  const refreshData = useCallback(async () => {
    if (!vault) return;
    try {
      const content = await vault.readNote(relPath);
      setData(content.trim() ? JSON.parse(content) : EMPTY_DATA);
    } catch (error) {
      console.error('[canvas] échec du chargement :', error);
      setData(EMPTY_DATA);
    }
  }, [vault, relPath]);

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

  // --- Cartes ---

  const addTextCard = () => {
    const jitter = () => (Math.random() - 0.5) * 120;
    updateData((prev) => ({
      ...prev,
      nodes: [...prev.nodes, createTextNode(makeId(), WORLD_CENTER + jitter(), WORLD_CENTER + jitter())],
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
      const jitter = () => (Math.random() - 0.5) * 120;
      updateData((prev) => ({
        ...prev,
        nodes: [
          ...prev.nodes,
          createFileNode(makeId(), WORLD_CENTER + jitter(), WORLD_CENTER + jitter(), note.relPath, note.name),
        ],
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

  // --- Glisser/panoramiquer/connecter — écouteurs délégués sur la surface ---

  useEffect(() => {
    const surface = surfaceRef.current as unknown as HTMLElement | null;
    if (!surface) return;

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
          startOffsetX: worldOffsetRef.current.x,
          startOffsetY: worldOffsetRef.current.y,
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
        setWorldOffset({
          x: drag.startOffsetX + (event.clientX - drag.startClientX),
          y: drag.startOffsetY + (event.clientY - drag.startClientY),
        });
      } else if (drag.kind === 'node') {
        const dx = event.clientX - drag.startClientX;
        const dy = event.clientY - drag.startClientY;
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
        setPreviewLine({
          id: 'preview',
          x1: fromNode.x + fromNode.width / 2,
          y1: fromNode.y + fromNode.height / 2,
          x2: event.clientX - rect.left - worldOffsetRef.current.x,
          y2: event.clientY - rect.top - worldOffsetRef.current.y,
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

    surface.addEventListener('dragstart', handleDragStart);
    surface.addEventListener('drag', handleDrag);
    surface.addEventListener('dragover', handleDragOver);
    surface.addEventListener('drop', handleDrop);
    surface.addEventListener('dragend', handleDragEnd);
    return () => {
      surface.removeEventListener('dragstart', handleDragStart);
      surface.removeEventListener('drag', handleDrag);
      surface.removeEventListener('dragover', handleDragOver);
      surface.removeEventListener('drop', handleDrop);
      surface.removeEventListener('dragend', handleDragEnd);
    };
  }, [updateData, scheduleSave]);

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

  const overlayLines: OverlayLine[] = data.edges
    .map((edge) => {
      const from = data.nodes.find((n) => n.id === edge.fromNode);
      const to = data.nodes.find((n) => n.id === edge.toNode);
      if (!from || !to) return null;
      return {
        id: edge.id,
        x1: from.x + from.width / 2,
        y1: from.y + from.height / 2,
        x2: to.x + to.width / 2,
        y2: to.y + to.height / 2,
      };
    })
    .filter((line): line is OverlayLine => line !== null);
  if (previewLine) overlayLines.push(previewLine);

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        {toolbarActions.map((action) => (
          <Pressable
            key={action.id}
            onPress={canvasActionHandlers[action.id]}
            style={[styles.button, { backgroundColor: theme.accent }]}
          >
            <Text style={styles.buttonText}>{action.label}</Text>
          </Pressable>
        ))}
        <Text style={[styles.saveStatus, { color: theme.textMuted }]}>
          {saveStatus === 'saving' ? 'Enregistrement…' : saveStatus === 'saved' ? 'Enregistré' : ''}
        </Text>
      </View>

      <View
        ref={surfaceRef}
        // Le fond lui-même est glissable (panoramique) — voir le
        // commentaire en tête de fichier : les cartes/poignées de
        // connexion, elles-mêmes `draggable`, priment naturellement
        // dessus puisqu'elles sont l'ancêtre glissable le plus proche du
        // point de clic.
        style={[styles.surface, { borderColor: theme.border, backgroundColor: theme.surface }]}
      >
        <DraggablePressable draggable dataSet={{ canvasRole: 'background' }} style={StyleSheet.absoluteFill}>
          <View
            style={[
              styles.world,
              { transform: [{ translateX: worldOffset.x }, { translateY: worldOffset.y }] },
            ]}
          >
            <SvgOverlay
              width={WORLD_SIZE}
              height={WORLD_SIZE}
              lines={overlayLines}
              color={theme.textMuted}
              onLineClick={(edgeId) => updateData((prev) => removeEdge(prev, edgeId))}
            />
            {data.nodes.map((node) => (
              <View key={node.id} style={{ position: 'absolute', left: node.x, top: node.y }}>
                <DraggablePressable
                  draggable
                  dataSet={{ canvasNodeId: node.id, canvasRole: 'card' }}
                  style={[
                    styles.card,
                    { width: node.width, minHeight: node.height, backgroundColor: theme.background, borderColor: theme.border },
                  ]}
                >
                  <View style={styles.cardHeader}>
                    <Text style={styles.cardTypeIcon}>{node.type === 'file' ? '📝' : '🗒️'}</Text>
                    <Pressable onPress={() => removeNode(node.id)} style={styles.cardDeleteButton}>
                      <Text style={{ color: theme.textMuted }}>✕</Text>
                    </Pressable>
                  </View>
                  {node.type === 'text' ? (
                    <TextInput
                      multiline
                      value={node.text}
                      onChangeText={(text) => setNodeText(node.id, text)}
                      placeholder="Écris ici…"
                      placeholderTextColor={theme.textMuted}
                      style={[styles.cardTextInput, { color: theme.text }]}
                    />
                  ) : (
                    <Pressable onPress={() => node.file && onOpenNote(node.file)} style={styles.cardNoteBody}>
                      <Text style={[styles.cardNoteTitle, { color: theme.accent }]} numberOfLines={3}>
                        {node.title}
                      </Text>
                    </Pressable>
                  )}
                  <DraggablePressable
                    draggable
                    dataSet={{ canvasNodeId: node.id, canvasRole: 'connector' }}
                    style={[styles.connectorHandle, { backgroundColor: theme.accent }]}
                  >
                    <Text style={styles.connectorHandleText}>➜</Text>
                  </DraggablePressable>
                </DraggablePressable>
              </View>
            ))}
          </View>
        </DraggablePressable>
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
  button: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  saveStatus: {
    fontSize: 11,
  },
  surface: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    overflow: 'hidden',
  },
  world: {
    width: WORLD_SIZE,
    height: WORLD_SIZE,
  },
  card: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 8,
    gap: 6,
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
    minHeight: 60,
  },
  cardNoteBody: {
    minHeight: 60,
    justifyContent: 'center',
  },
  cardNoteTitle: {
    fontSize: 13,
    fontWeight: '600',
  },
  connectorHandle: {
    position: 'absolute',
    right: -10,
    bottom: -10,
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
