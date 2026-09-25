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

  const walk = (items: VaultTreeNode[]) => {
    for (const item of items) {
      if (item.type === 'folder') {
        walk(item.children ?? []);
      } else {
        const parentFolder = item.relPath.includes('/') ? item.relPath.slice(0, item.relPath.lastIndexOf('/')) : '';
        nodes.push({
          id: item.relPath,
          name: item.name,
          folder: parentFolder,
          kind: item.kind,
          links: 0,
          x: Math.random() * 600 - 300,
          y: Math.random() * 400 - 200,
          vx: 0,
          vy: 0,
        });
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
  const [panneau, setPanneau] = useState(true);
  const { width, height } = useWindowDimensions();

  const [nodeScale, setNodeScale] = useState(0.63);
  const [linkWidth, setLinkWidth] = useState(2.5);
  const [textThreshold, setTextThreshold] = useState(0.2);
  const [showOrphans, setShowOrphans] = useState(true);
  const [forcesOpen, setForcesOpen] = useState(true);
  const [forces, setForces] = useState<ForceOptions>({ centrale: 1, repulsion: 16, liaison: 0.43, distance: 80 });

  const recomputeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const baseNodesRef = useRef<GraphNode[] | null>(null);

  useEffect(() => {
    const load = async () => {
      if (typeof window === 'undefined' || !window.vault) return;
      try {
        const tree = await window.vault.listTree();
        const notes: { relPath: string }[] = [];
        const walk = (items: VaultTreeNode[]) => {
          for (const n of items) {
            if (n.type === 'note') notes.push({ relPath: n.relPath });
            if (n.type === 'folder' && n.children) walk(n.children);
          }
        };
        walk(tree);
        const contents: Record<string, string> = {};
        for (const note of notes.slice(0, 500)) {
          try {
            contents[note.relPath] = await window.vault.readNote(note.relPath);
          } catch {
            contents[note.relPath] = '';
          }
        }
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
  const fitScale = Math.min((width - (panneau ? 360 : 80)) / spanX, (height - 150) / spanY, 3);
  const [zoom, setZoom] = useState(1);
  const scale = fitScale * zoom;
  const toScreenX = (x: number) => (x - bounds.minX) * scale + 30;
  const toScreenY = (y: number) => (y - bounds.minY) * scale + 40;

  return (
    <View style={{ flex: 1, flexDirection: 'row' }}>
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
          <View style={[styles.graphBox, { backgroundColor: `${theme.border}33`, marginHorizontal: 12 }]}>
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
        <ScrollView style={[styles.panneau, { borderLeftColor: theme.border }]} contentContainerStyle={{ padding: 12, gap: 12 }}>
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
    width: 300,
    borderLeftWidth: 1,
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    fontSize: 13,
  },
});
