import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import Svg, { Circle, Line, Text as SvgText } from 'react-native-svg';

import type { Theme } from '../theme';

// VUE GRAPHIQUE (v0.4.37 — « page qui lie entre eux les fichiers à l'aide
// des [[liens internes]] », comme la vue Graph d'Obsidian). Chaque note du
// coffre est un NŒUD (cercle coloré par dossier parent, taille par nombre
// de liens), chaque [[lien]] une ARÊTE (ligne). Clic sur un nœud = ouvrir
// la note. Recherche pour filtrer/mettre en évidence.
//
// Layout : force-dirigé simplifié (répulsion + attraction des arêtes,
// quelques centaines d'itérations au chargement). Pas de dépendance externe
// (d3-force serait overkill ici) — physique maison pure et testée.

export type GraphNode = {
  id: string; // relPath
  name: string; // nom sans extension
  folder: string; // dossier parent (couleur)
  kind: VaultEntryKind;
  links: number; // degré (entrants + sortants)
  x: number;
  y: number;
  vx: number;
  vy: number;
};

export type GraphEdge = { source: string; target: string };

// Extrait les cibles [[...]] d'un contenu markdown.
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

// Construit les nœuds et arêtes du graphe depuis l'arbre + les contenus.
// Les liens sont résolus par NOM de fichier (sans extension), comme
// handleOpenWikilink dans NotesScreen.
export function buildGraph(
  tree: VaultTreeNode[],
  contents: Record<string, string>,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = [];
  const byName = new Map<string, string>(); // nom -> relPath

  const walk = (items: VaultTreeNode[], folder: string) => {
    for (const item of items) {
      if (item.type === 'folder') {
        walk(item.children ?? [], item.relPath);
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
  walk(tree, '');

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

// Simulation de forces : répulsion entre nœuds, ressort sur les arêtes,
// attraction vers le centre. Exécutée au chargement (pas en continu —
// assez pour un layout lisible, pas de boucle de rendu coûteuse).
export function runForceLayout(nodes: GraphNode[], edges: GraphEdge[], iterations = 200): void {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const W = 800;
  const H = 600;
  for (let iter = 0; iter < iterations; iter++) {
    const cooling = 1 - iter / iterations;
    // Répulsion (paires)
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.max(1, Math.hypot(dx, dy));
        const force = (1200 * cooling) / (dist * dist);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        a.vx -= fx;
        a.vy -= fy;
        b.vx += fx;
        b.vy += fy;
      }
    }
    // Ressorts (arêtes)
    for (const e of edges) {
      const a = byId.get(e.source);
      const b = byId.get(e.target);
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.max(1, Math.hypot(dx, dy));
      const force = (dist - 80) * 0.05 * cooling;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    }
    // Centre + intégration
    for (const n of nodes) {
      n.vx += -n.x * 0.002;
      n.vy += -n.y * 0.002;
      n.x += Math.max(-8, Math.min(8, n.vx * 0.6));
      n.y += Math.max(-8, Math.min(8, n.vy * 0.6));
      n.vx *= 0.85;
      n.vy *= 0.85;
    }
  }
  void W;
  void H;
}

// Couleur d'un nœud selon son dossier (hash simple → palette).
const FOLDER_PALETTE = ['#7aa2f7', '#bb9af7', '#9ece6a', '#e0af68', '#f7768e', '#7dcfff', '#ff9e64', '#73daca'];
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
  const [recherche, setRecherche] = useState('');
  const [hovered, setHovered] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const { width, height } = useWindowDimensions();
  const loadedRef = useRef(false);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
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
        runForceLayout(graph.nodes, graph.edges);
        setNodes(graph.nodes);
        setEdges(graph.edges);
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const q = recherche.trim().toLowerCase();
  const matchedNodes = q
    ? nodes.filter((n) => n.name.toLowerCase().includes(q) || n.folder.toLowerCase().includes(q))
    : null;
  const matchedSet = new Set(matchedNodes?.map((n) => n.id) ?? []);

  // Scale to fit
  const minX = Math.min(...nodes.map((n) => n.x), 0);
  const maxX = Math.max(...nodes.map((n) => n.x), 1);
  const minY = Math.min(...nodes.map((n) => n.y), 0);
  const maxY = Math.max(...nodes.map((n) => n.y), 1);
  const scale = Math.min((width - 80) / Math.max(1, maxX - minX), (height - 160) / Math.max(1, maxY - minY), 1.5);

  return (
    <View style={{ flex: 1 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12 }}>
        <Text style={{ color: theme.text, fontWeight: '700', fontSize: 16, flex: 1 }}>🔗 Vue graphique</Text>
        <TextInput
          value={recherche}
          onChangeText={setRecherche}
          placeholder="Filtrer…"
          placeholderTextColor={theme.textMuted}
          style={[styles.search, { color: theme.text, borderColor: theme.border }]}
        />
      </View>
      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: theme.textMuted }}>Construction du graphe…</Text>
        </View>
      ) : (
        <ScrollView style={{ flex: 1 }} horizontal>
          <Svg width={Math.max(width, (maxX - minX) * scale + 100)} height={Math.max(height - 100, (maxY - minY) * scale + 100)}>
            {edges.map((e, i) => {
              const a = byId.get(e.source);
              const b = byId.get(e.target);
              if (!a || !b) return null;
              const x1 = (a.x - minX) * scale + 50;
              const y1 = (a.y - minY) * scale + 50;
              const x2 = (b.x - minX) * scale + 50;
              const y2 = (b.y - minY) * scale + 50;
              const isHighlighted =
                !q ||
                matchedSet.has(e.source) ||
                matchedSet.has(e.target);
              return (
                <Line
                  key={i}
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke={isHighlighted ? `${theme.textMuted}55` : `${theme.border}22`}
                  strokeWidth={isHighlighted ? 1.2 : 0.5}
                />
              );
            })}
            {nodes.map((n) => {
              const r = 4 + Math.min(8, n.links * 0.8);
              const cx = (n.x - minX) * scale + 50;
              const cy = (n.y - minY) * scale + 50;
              const isMatched = !q || matchedSet.has(n.id);
              const isHovered = hovered === n.id;
              const color = folderColor(n.folder);
              return (
                <Pressable key={n.id} onPress={() => onOpenNote(n.id)} onHoverIn={() => setHovered(n.id)} onHoverOut={() => setHovered(null)}>
                  <Circle
                    cx={cx}
                    cy={cy}
                    r={isHovered || isMatched ? r + 2 : r}
                    fill={color}
                    opacity={isMatched ? 1 : 0.15}
                  />
                  {(isHovered || (q && isMatched)) && (
                    <SvgText x={cx + r + 4} y={cy + 4} fill={theme.text} fontSize={11}>
                      {n.name}
                    </SvgText>
                  )}
                </Pressable>
              );
            })}
          </Svg>
        </ScrollView>
      )}
      {!loading && (
        <View style={{ flexDirection: 'row', gap: 12, paddingHorizontal: 12, paddingBottom: 8 }}>
          <Text style={{ color: theme.textMuted, fontSize: 11 }}>
            {nodes.length} fichiers · {edges.length} liens
          </Text>
          {q && <Text style={{ color: theme.accent, fontSize: 11 }}>{matchedNodes?.length ?? 0} résultat(s)</Text>}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  search: {
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    fontSize: 13,
    width: 180,
  },
});
