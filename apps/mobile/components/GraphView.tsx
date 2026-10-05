import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View, useWindowDimensions } from 'react-native';
import Svg, { Circle, Line, Text as SvgText } from 'react-native-svg';

import { SliderField } from './SliderField';
import type { Theme } from '../theme';

// VUE GRAPHIQUE v2 (v0.4.38) — d'après les captures d'Obsidian fournies :
// - graphe DANS la page (plus de scroll horizontal) : nœuds colorés +
//   NOMS affichés, ZOOM boutons, arêtes épaisses rosées comme la capture ;
// - PANNEAU DE RÉGLAGES à droite (comme Obsidian) : recherche, filtre
//   orphelins, taille des nœuds, épaisseur des liens, seuil du texte, et
//   les 4 FORCES (centrale, répulsion, liaison, distance) qui relancent le
//   layout en direct ;
// - clic sur le NOM d'un nœud = ouvrir la note.
//
// Layout : simulation de forces MAISON (répulsion + ressorts + centre),
// relancée quand les curseurs de forces changent. Pure et testée.

export type GraphNode = {
  id: string;
  name: string;
  folder: string;
  kind: VaultEntryKind;
  links: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
};

export type GraphEdge = { source: string; target: string };

export function extractWikiLinks(content: string): string[] {
  const out: string[] = [];
  const regex = /\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    const target = match[1].trim();
    if (target) out.push(target);
  }
  return out;
}

export function buildGraph(
  tree: VaultTreeNode[],
  contents: Record<string, string>,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = [];
  const byName = new Map<string, string>();

  // Affichage et liens s'appuient sur le nom SANS extension (« Note » et
  // non « Note.md ») — mais l'arbre natif Android a longtemps livré le nom
  // AVEC extension (divergence avec le desktop corrigée dans
  // nativeVaultAdapter), et certains liens l'écrivent explicitement
  // (« [[Note.md]] ») : les DEUX formes sont indexées pour que les
  // `[[liens internes]]` soient retrouvés dans tous les cas. Avant ce
  // double index, les cibles sans extension ne matchaient jamais le nom
  // indexé avec « .md » sur le téléphone : graphe chargé avec 0 liens
  // (vécu A13, 2026-10-03).
  const baseNameOf = (name: string): string => {
    const dot = name.lastIndexOf('.');
    return dot > 0 ? name.slice(0, dot) : name;
  };

  const walk = (items: VaultTreeNode[]) => {
    for (const item of items) {
      if (item.type === 'folder') {
        walk(item.children ?? []);
      } else {
        const parentFolder = item.relPath.includes('/') ? item.relPath.slice(0, item.relPath.lastIndexOf('/')) : '';
        const baseName = baseNameOf(item.name);
        nodes.push({
          id: item.relPath,
          name: baseName,
          folder: parentFolder,
          kind: item.kind,
          links: 0,
          x: Math.random() * 600 - 300,
          y: Math.random() * 400 - 200,
          vx: 0,
          vy: 0,
        });
        byName.set(baseName.toLowerCase(), item.relPath);
        byName.set(item.name.toLowerCase(), item.relPath);
      }
    }
  };
  walk(tree);

  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  for (const node of nodes) {
    const content = contents[node.id];
    if (!content) continue;
    for (const link of extractWikiLinks(content)) {
      const target = byName.get(link.toLowerCase());
      if (!target || target === node.id) continue;
      const key = [node.id, target].sort().join('→');
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ source: node.id, target });
    }
  }
  for (const e of edges) {
    const s = nodes.find((n) => n.id === e.source);
    const t = nodes.find((n) => n.id === e.target);
    if (s) s.links++;
    if (t) t.links++;
  }
  return { nodes, edges };
}

export type ForceOptions = { centrale: number; repulsion: number; liaison: number; distance: number };

export function runForceLayout(
  nodes: GraphNode[],
  edges: GraphEdge[],
  options: ForceOptions,
  iterations = 250,
): void {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (let iter = 0; iter < iterations; iter++) {
    const cooling = 1 - iter / iterations;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.max(1, Math.hypot(dx, dy));
        const force = (options.repulsion * 60 * cooling) / (dist * dist);
        a.vx -= (dx / dist) * force;
        a.vy -= (dy / dist) * force;
        b.vx += (dx / dist) * force;
        b.vy += (dy / dist) * force;
      }
    }
    for (const e of edges) {
      const a = byId.get(e.source);
      const b = byId.get(e.target);
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.max(1, Math.hypot(dx, dy));
      const force = (dist - options.distance) * options.liaison * 0.1 * cooling;
      a.vx += (dx / dist) * force;
      a.vy += (dy / dist) * force;
      b.vx -= (dx / dist) * force;
      b.vy -= (dy / dist) * force;
    }
    for (const n of nodes) {
      n.vx += -n.x * 0.003 * options.centrale;
      n.vy += -n.y * 0.003 * options.centrale;
      n.x += Math.max(-10, Math.min(10, n.vx * 0.6));
      n.y += Math.max(-10, Math.min(10, n.vy * 0.6));
      n.vx *= 0.85;
      n.vy *= 0.85;
    }
  }
}

const FOLDER_PALETTE = ['#b3306d', '#c9437f', '#d95f8c', '#a52a5f', '#8f2350', '#e0709b'];
export function folderColor(folder: string): string {
  let hash = 0;
  for (let i = 0; i < folder.length; i++) hash = ((hash << 5) - hash + folder.charCodeAt(i)) | 0;
  return FOLDER_PALETTE[Math.abs(hash) % FOLDER_PALETTE.length];
}

type Props = {
  theme: Theme;
  onOpenNote: (relPath: string) => void;
};

export function GraphView({ theme, onOpenNote }: Props) {
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [loading, setLoading] = useState(true);
  const [recherche, setRecherche] = useState('');
  const { width, height } = useWindowDimensions();
  // Sur téléphone, le panneau de réglages démarre REPLIÉ : à 300 px de
  // large il masquait la moitié du graphe (constat 2026-10-03) — le bouton
  // ⚙ permet de l'ouvrir. Sur grand écran : ouvert comme avant.
  const [panneau, setPanneau] = useState(width >= 720);
  // Sur un écran étroit (mobile), la largeur persistée du panneau (pensée
  // desktop, jusqu'à 520) masquait tout le graphe — plafond : la moitié de
  // l'écran. Le plafond se calcule sur la largeur MESURÉE du conteneur
  // (onLayout) et non sur useWindowDimensions : sur certains téléphones
  // (zoom d'affichage Samsung, vécu A13 2026-10-04) les deux échelles
  // DIFFÈRENT — le mélange rendait le panneau figé au plafond, insensible
  // à la poignée dans les deux sens. `panneauWidth === null` = pas encore
  // déplié/redimensionné : la valeur par défaut (300, pensée desktop)
  // s'applique, plafonnée.
  const [rowWidth, setRowWidth] = useState(0);
  const panneauCap = rowWidth > 0 ? Math.round(rowWidth * 0.5) : Math.round(width * 0.5);
  const [panneauWidth, setPanneauWidth] = useState<number | null>(null);
  const panneauEffectif = Math.min(panneauWidth ?? Math.min(300, panneauCap), panneauCap);
  // [diag-poignee-graphe] TEMPORAIRE
  useEffect(() => {
    console.error('[diag-graphe] état', JSON.stringify({ panneauWidth, panneauEffectif, panneauCap, rowWidth, windowWidth: width }));
  }, [panneauWidth, panneauEffectif, panneauCap, rowWidth, width]);

  const [nodeScale, setNodeScale] = useState(0.63);
  const [linkWidth, setLinkWidth] = useState(2.5);
  const [textThreshold, setTextThreshold] = useState(0.2);
  const [showOrphans, setShowOrphans] = useState(true);
  const [forcesOpen, setForcesOpen] = useState(true);
  const [forces, setForces] = useState<ForceOptions>({ centrale: 1, repulsion: 16, liaison: 0.43, distance: 80 });

  const recomputeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Glisser en cours (pan du graphe) — espace enfoncé ou bouton milieu ;
  // simplifié : le glisser direct déplace toujours (le clic sur un NOM
  // de nœud reste prioritaire car porté par le SvgText, pas par la boîte).
  const panDragRef = useRef({ active: false, lastX: 0, lastY: 0 });
  const baseNodesRef = useRef<GraphNode[] | null>(null);
  // Glisser de la poignée du panneau de réglages — x de prise + largeur de
  // départ (voir onResponderGrant plus bas).
  const resizeDrag = useRef<{ startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    const load = async () => {
      // Le garde est DANS le try : avant, un retour anticipé (pas de pont
      // vault au montage) court-circuitait le finally et laissait
      // « Construction du graphe… » à l'écran pour toujours.
      try {
        const vault = typeof window === 'undefined' ? undefined : window.vault;
        if (!vault) return;
        const tree = await vault.listTree();
        const notes: { relPath: string }[] = [];
        const walk = (items: VaultTreeNode[]) => {
          for (const n of items) {
            if (n.type === 'note') notes.push({ relPath: n.relPath });
            if (n.type === 'folder' && n.children) walk(n.children);
          }
        };
        walk(tree);
        const contents: Record<string, string> = {};
        // Lectures en parallèle à concurrence fixe : sur le coffre natif
        // Android (SAF), une lecture = une ouverture de document, ~0,4 s
        // chacune — en séquentiel, 200+ notes tenaient l'écran sur
        // « Construction du graphe… » pendant 1 à 2 minutes (vécu A13,
        // 2026-10-03, lecture suivie comme un chargement infini). Un pool
        // de 12 divise le temps par ~10 sans saturer le pont SAF.
        const queue = notes.slice(0, 500);
        await Promise.all(
          Array.from({ length: Math.min(12, queue.length) }, async () => {
            for (let next = queue.shift(); next; next = queue.shift()) {
              try {
                contents[next.relPath] = await vault.readNote(next.relPath);
              } catch {
                contents[next.relPath] = '';
              }
            }
          }),
        );
        const graph = buildGraph(tree, contents);
        baseNodesRef.current = graph.nodes;
        runForceLayout(graph.nodes, graph.edges, { centrale: 1, repulsion: 16, liaison: 0.43, distance: 80 });
        setNodes(graph.nodes);
        setEdges(graph.edges);
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  const recompute = (next: ForceOptions) => {
    setForces(next);
    if (recomputeTimer.current) clearTimeout(recomputeTimer.current);
    recomputeTimer.current = setTimeout(() => {
      if (!baseNodesRef.current) return;
      const fresh = baseNodesRef.current.map((n) => ({ ...n }));
      runForceLayout(fresh, edges, next);
      setNodes(fresh);
    }, 300);
  };

  const q = recherche.trim().toLowerCase();
  const orphelinIds = new Set(nodes.filter((n) => n.links === 0).map((n) => n.id));
  const visibles = nodes.filter((n) => (showOrphans || !orphelinIds.has(n.id)) && (!q || n.name.toLowerCase().includes(q) || n.folder.toLowerCase().includes(q)));
  const visiblesIds = new Set(visibles.map((n) => n.id));
  const edgesVisibles = edges.filter((e) => visiblesIds.has(e.source) && visiblesIds.has(e.target));

  const bounds = (() => {
    if (visibles.length === 0) return { minX: -100, minY: -100, maxX: 100, maxY: 100 };
    const xs = visibles.map((n) => n.x);
    const ys = visibles.map((n) => n.y);
    return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
  })();
  const spanX = Math.max(1, bounds.maxX - bounds.minX);
  const spanY = Math.max(1, bounds.maxY - bounds.minY);
  const fitScale = Math.min((width - (panneau ? panneauEffectif + 40 : 80)) / spanX, (height - 150) / spanY, 3);
  const [zoom, setZoom] = useState(1);
  // PAN (v0.4.39) : décalage du graphe dans son cadre — molette = zoom vers
  // le curseur, glisser = déplacer, boutons +/- conservés.
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const scale = fitScale * zoom;
  const toScreenX = (x: number) => (x - bounds.minX) * scale + 30 + pan.x;
  const toScreenY = (y: number) => (y - bounds.minY) * scale + 40 + pan.y;

  return (
    // onLayout : largeur RÉELLE du conteneur, dans le MÊME espace de
    // coordonnées que les pageX des responders (voir panneauCap ci-dessus).
    <View
      style={{ flex: 1, flexDirection: 'row' }}
      onLayout={(e) => setRowWidth(e.nativeEvent.layout.width)}
    >
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12 }}>
          <Text style={{ color: theme.text, fontWeight: '700', fontSize: 16, flex: 1 }}>🔗 Vue graphique</Text>
          <Pressable onPress={() => setZoom((z) => Math.max(0.2, z - 0.2))} accessibilityRole="button" style={[styles.zoomButton, { borderColor: theme.border }]}>
            <Text style={{ color: theme.text }}>−</Text>
          </Pressable>
          <Text style={{ color: theme.textMuted, fontSize: 12, minWidth: 40, textAlign: 'center' }}>{Math.round(zoom * 100)}%</Text>
          <Pressable onPress={() => setZoom((z) => Math.min(5, z + 0.2))} accessibilityRole="button" style={[styles.zoomButton, { borderColor: theme.border }]}>
            <Text style={{ color: theme.text }}>+</Text>
          </Pressable>
          <Pressable onPress={() => setPanneau((v) => !v)} accessibilityRole="button" style={[styles.zoomButton, { borderColor: theme.border }]}>
            <Text style={{ color: theme.text }}>⚙</Text>
          </Pressable>
        </View>

        {loading ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: theme.textMuted }}>Construction du graphe…</Text>
          </View>
        ) : (
          <View
            style={[styles.graphBox, { backgroundColor: `${theme.border}33`, marginHorizontal: 12 }]}
            // MOLETTE = zoom (v0.4.39 — demande explicite), GLISSER = pan.
            // wheel n'est pas une prop RN : transmis tel quel par
            // react-native-web jusqu'au div (même échappatoire que
            // draggable dans VaultTreeView).
            // @ts-expect-error prop web-only (voir commentaire)
            onWheel={(e: WheelEvent) => {
              e.preventDefault();
              setZoom((z) => Math.min(8, Math.max(0.1, z * (e.deltaY < 0 ? 1.12 : 0.89))));
            }}
            onStartShouldSetResponder={() => panDragRef.current.active}
            onMoveShouldSetResponder={() => panDragRef.current.active}
            onResponderGrant={(e) => {
              panDragRef.current.lastX = e.nativeEvent.pageX;
              panDragRef.current.lastY = e.nativeEvent.pageY;
            }}
            onResponderMove={(e) => {
              if (!panDragRef.current.active) return;
              const dx = e.nativeEvent.pageX - panDragRef.current.lastX;
              const dy = e.nativeEvent.pageY - panDragRef.current.lastY;
              panDragRef.current.lastX = e.nativeEvent.pageX;
              panDragRef.current.lastY = e.nativeEvent.pageY;
              setPan((p) => ({ x: p.x + dx, y: p.y + dy }));
            }}
          >
            <Svg width="100%" height="100%">
              {edgesVisibles.map((e, i) => {
                const a = visibles.find((n) => n.id === e.source);
                const b = visibles.find((n) => n.id === e.target);
                if (!a || !b) return null;
                return (
                  <Line
                    key={i}
                    x1={toScreenX(a.x)}
                    y1={toScreenY(a.y)}
                    x2={toScreenX(b.x)}
                    y2={toScreenY(b.y)}
                    stroke="#c98a9a"
                    strokeWidth={linkWidth}
                    opacity={0.55}
                  />
                );
              })}
              {visibles.map((n) => {
                const r = (3 + Math.min(9, n.links * 0.9)) * (0.5 + nodeScale);
                const isMatch = q && (n.name.toLowerCase().includes(q) || n.folder.toLowerCase().includes(q));
                const showLabel = zoom >= textThreshold || Boolean(isMatch) || n.links >= 5;
                return (
                  <>
                    <Circle
                      key={n.id}
                      cx={toScreenX(n.x)}
                      cy={toScreenY(n.y)}
                      r={r}
                      fill={folderColor(n.folder)}
                    />
                    {showLabel && (
                      <SvgText
                        key={n.id + '-l'}
                        x={toScreenX(n.x) + r + 4}
                        y={toScreenY(n.y) + 4}
                        fill={theme.text}
                        fontSize={11}
                        onPress={() => onOpenNote(n.id)}
                      >
                        {n.name}
                      </SvgText>
                    )}
                  </>
                );
              })}
            </Svg>
          </View>
        )}
        <Text style={{ color: theme.textMuted, fontSize: 11, paddingHorizontal: 14, paddingVertical: 6 }}>
          {visibles.length} fichiers · {edgesVisibles.length} liens{q ? ` · filtré « ${recherche} »` : ''}
        </Text>
      </View>

      {panneau && (
        // View (PAS Pressable) : Pressable gère SES propres responders et
        // n'expose pas proprement onStartShouldSetResponder personnalisé —
        // la poignée ne capte alors jamais le geste (vécu : « la poignée de
        // la vue graphique ne fonctionne pas », 2026-10-04). Le pattern
        // View+responders est celui de ResizeHandle.tsx, qui fonctionne.
        <View
          style={[
            styles.resizeHandle,
            // Barre visible fine côté graphe, fond transparent : la zone
            // de 24 dp doit se fondre dans l'interface (voir ci-dessus).
            { backgroundColor: 'transparent', borderRightWidth: 2, borderRightColor: theme.border },
          ]}
          // @ts-expect-error cursor web-only (RN n'admet que auto/pointer)
          cursor="ew-resize"
          onStartShouldSetResponder={() => true}
          onMoveShouldSetResponder={() => true}
          onResponderGrant={(e) => {
            // [diag-poignee-graphe] TEMPORAIRE
            console.error('[diag-graphe] grant', JSON.stringify({ pageX: e.nativeEvent.pageX, startWidth: panneauEffectif, cap: panneauCap, rowWidth }));
            resizeDrag.current = { startX: e.nativeEvent.pageX, startWidth: panneauEffectif };
          }}
          onResponderMove={(e) => {
            const drag = resizeDrag.current;
            if (!drag) return;
            // Panneau à DROITE : tirer vers la gauche (pageX décroissant)
            // l'élargit. Glissement ABSOLU (delta depuis la prise).
            // Bornes : [min(200, cap), cap] — la borne haute est le plafond
            // d'écran, la basse ne doit JAMAIS dépasser la haute.
            const next = drag.startWidth + (drag.startX - e.nativeEvent.pageX);
            console.error('[diag-graphe] move', JSON.stringify({ pageX: e.nativeEvent.pageX, next }));
            setPanneauWidth(Math.max(Math.min(200, panneauCap), Math.min(next, panneauCap)));
          }}
          onResponderRelease={() => {
            resizeDrag.current = null;
          }}
          onResponderTerminate={() => {
            resizeDrag.current = null;
          }}
        />
      )}
      {panneau && (
        <ScrollView
          style={[
            styles.panneau,
            {
              borderLeftColor: theme.border,
              width: panneauEffectif,
              // Sur certains réglages d'affichage (zoom Samsung), la largeur
              // fixe était ignorée au profit de la largeur du CONTENU
              // (panneau figé à ~276 dp, insensible à la poignée — vécu
              // A13, 2026-10-04) : flexGrow/Shrink à 0 force la largeur.
              flexGrow: 0,
              flexShrink: 0,
            },
          ]}
          contentContainerStyle={{ padding: 12, gap: 12 }}
        >
          <View style={{ gap: 4 }}>
            <Text style={{ color: theme.textMuted, fontSize: 12 }}>Rechercher des fichiers…</Text>
            <TextInput
              value={recherche}
              onChangeText={setRecherche}
              placeholder="Rechercher…"
              placeholderTextColor={theme.textMuted}
              style={[styles.input, { color: theme.text, borderColor: theme.border }]}
            />
          </View>

          <Text style={{ color: theme.text, fontSize: 13, fontWeight: '600' }}>Filtres</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={{ color: theme.text, fontSize: 13 }}>Orphelins (sans lien)</Text>
            <Switch value={showOrphans} onValueChange={setShowOrphans} trackColor={{ false: theme.border, true: theme.accent }} />
          </View>

          <Text style={{ color: theme.text, fontSize: 13, fontWeight: '600' }}>Réglages</Text>
          <SliderField
            label="Taille des nœuds"
            value={nodeScale}
            minimumValue={0.2}
            maximumValue={1.5}
            step={0.01}
            format={(v) => v.toFixed(2)}
            onValueChange={setNodeScale}
            theme={theme}
          />
          <SliderField
            label="Épaisseur des liens"
            value={linkWidth}
            minimumValue={0.3}
            maximumValue={5}
            step={0.1}
            format={(v) => v.toFixed(2)}
            onValueChange={setLinkWidth}
            theme={theme}
          />
          <SliderField
            label="Seuil d'affichage du texte"
            value={textThreshold}
            minimumValue={0}
            maximumValue={1}
            step={0.05}
            format={(v) => v.toFixed(2)}
            onValueChange={setTextThreshold}
            theme={theme}
          />

          <Pressable onPress={() => setForcesOpen((v) => !v)} accessibilityRole="button" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={{ color: theme.textMuted, fontSize: 12 }}>{forcesOpen ? '▾' : '▸'}</Text>
            <Text style={{ color: theme.text, fontSize: 13, fontWeight: '600' }}>Forces</Text>
          </Pressable>
          {forcesOpen && (
            <View style={{ gap: 12 }}>
              <SliderField
                label="Force centrale"
                value={forces.centrale}
                minimumValue={0}
                maximumValue={3}
                step={0.05}
                format={(v) => v.toFixed(2)}
                onValueChange={(v) => recompute({ ...forces, centrale: v })}
                theme={theme}
              />
              <SliderField
                label="Force de répulsion"
                value={forces.repulsion}
                minimumValue={2}
                maximumValue={60}
                step={1}
                format={(v) => v.toFixed(0)}
                onValueChange={(v) => recompute({ ...forces, repulsion: v })}
                theme={theme}
              />
              <SliderField
                label="Force de liaison"
                value={forces.liaison}
                minimumValue={0.05}
                maximumValue={1.5}
                step={0.01}
                format={(v) => v.toFixed(2)}
                onValueChange={(v) => recompute({ ...forces, liaison: v })}
                theme={theme}
              />
              <SliderField
                label="Distance des liens"
                value={forces.distance}
                minimumValue={30}
                maximumValue={200}
                step={5}
                format={(v) => v.toFixed(0)}
                onValueChange={(v) => recompute({ ...forces, distance: v })}
                theme={theme}
              />
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  zoomButton: {
    width: 30,
    height: 30,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  graphBox: {
    flex: 1,
    borderRadius: 10,
    overflow: 'hidden',
  },
  panneau: {
    borderLeftWidth: 1,
  },
  resizeHandle: {
    // Largeur TACTILE (24 dp) — la barre visible est la bordure elle-même ;
    // sur desktop le curseur 'ew-resize' rend les 24 dp aussi confortables.
    width: 24,
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    fontSize: 13,
  },
});
