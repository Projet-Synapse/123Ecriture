import { useEffect, useRef, useState, type ComponentProps, type ComponentType, type ReactNode } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';

import { findNodeByPath } from '../../lib/notes/vaultTree';
import {
  EXPLORER_HOVER_DELAY_MS,
  buildExplorerTooltipLines,
  countFolderContents,
  explorerHoverRowColor,
} from '../../lib/notes/explorerHover';
import { buildExplorerColors, isDarkColor } from '../../lib/theme/explorerColors';
import type { Theme } from '../../theme';

// ✒️ 123ECRITURE — components/vault/ExplorerHoverHost.tsx — survol desktop de l'arbre
//////////////////////////////////////////////////////////////////////////////
//
// Autour de la racine de VaultTreeView, sur ordinateur uniquement :
//   • un fond de ligne au survol (CSS :hover, aucun re-rendu de l'arbre) ;
//   • après 500 ms, une bulle sombre à côté de la ligne, avec le nom
//     complet et les dates chargées à la demande (getTimestamps).
// Sur mobile, le composant se contente de rendre ses enfants (pas de
// survol, l'appui long n'est pas détourné).
//
//////////////////////////////////////////////////////////////////////////////

const STYLE_ID = '123ecriture-explorer-hover-row';

type HoverMouseEvent = { currentTarget: unknown; nativeEvent: unknown };
type HoverRootProps = ComponentProps<typeof View> & {
  dataSet?: { explorerTree?: string };
  onMouseOver?: (event: HoverMouseEvent) => void;
  onMouseOut?: (event: HoverMouseEvent) => void;
};
const HoverRoot = View as unknown as ComponentType<HoverRootProps>;

type Tip = {
  relPath: string;
  lines: string[];
  left: number;
  top: number;
};

type Props = {
  nodes: VaultTreeNode[];
  theme: Theme;
  children: ReactNode;
};

function rowFromEvent(event: { target?: unknown }, root: HTMLElement | null): HTMLElement | null {
  if (!root || !(event.target instanceof HTMLElement)) return null;
  const row = event.target.closest('[data-relpath]');
  if (!(row instanceof HTMLElement) || !root.contains(row)) return null;
  if (row.querySelector('input')) return null;
  return row;
}

function relPathOf(row: HTMLElement): string | null {
  return row.getAttribute('data-relpath') || row.dataset.relpath || null;
}

function ensureHoverCss(color: string) {
  if (typeof document === 'undefined') return;
  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = STYLE_ID;
    document.head.appendChild(style);
  }
  style.textContent = `[data-explorer-tree] [data-relpath]:hover { background-color: ${color}; }`;
}

function placeTooltip(row: HTMLElement, lineCount: number): { left: number; top: number } {
  const rect = row.getBoundingClientRect();
  const width = 260;
  const height = 12 + lineCount * 18 + 8;
  let left = rect.right + 8;
  if (left + width > window.innerWidth - 8) left = Math.max(8, rect.left - width - 8);
  let top = rect.top;
  if (top + height > window.innerHeight - 8) top = Math.max(8, window.innerHeight - height - 8);
  return { left, top };
}

export function ExplorerHoverHost({ nodes, theme, children }: Props) {
  const [tip, setTip] = useState<Tip | null>(null);
  const hoverRelPath = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seqRef = useRef(0);
  const cacheRef = useRef<Map<string, { createdAt: number; modifiedAt: number }>>(new Map());
  const nodesRef = useRef(nodes);
  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  const ex = theme.explorer ?? buildExplorerColors(theme);
  const hoverColor = explorerHoverRowColor(isDarkColor(ex.background));

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    ensureHoverCss(hoverColor);
  }, [hoverColor]);

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const hide = () => {
    clearTimer();
    hoverRelPath.current = null;
    seqRef.current += 1;
    setTip(null);
  };

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const onScroll = () => hide();
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      clearTimer();
    };
    // hide/clearTimer are stables enough for mount/unmount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (Platform.OS !== 'web') return <>{children}</>;

  const asDom = (value: unknown): HTMLElement | null => {
    if (!value) return null;
    if (value instanceof HTMLElement) return value;
    const node = value as { _nativeNode?: HTMLElement; current?: unknown };
    if (node._nativeNode instanceof HTMLElement) return node._nativeNode;
    return asDom(node.current);
  };

  const startHover = (row: HTMLElement, relPath: string) => {
    if (hoverRelPath.current === relPath) return;
    clearTimer();
    hoverRelPath.current = relPath;
    seqRef.current += 1;
    const seq = seqRef.current;
    setTip(null);
    timerRef.current = setTimeout(() => {
      void (async () => {
        const node = findNodeByPath(nodesRef.current, relPath);
        if (!node || seq !== seqRef.current) return;
        let createdAt: number | null = null;
        let modifiedAt: number | null = node.type === 'note' ? node.modifiedAt : null;
        const cached = cacheRef.current.get(relPath);
        if (cached) {
          createdAt = cached.createdAt;
          modifiedAt = cached.modifiedAt;
        } else {
          const getter = typeof window !== 'undefined' ? window.vault?.getTimestamps : undefined;
          if (getter) {
            const ts = await getter(relPath).catch(() => null);
            if (seq !== seqRef.current) return;
            if (ts) {
              createdAt = ts.createdAt;
              modifiedAt = ts.modifiedAt;
              cacheRef.current.set(relPath, { createdAt: ts.createdAt, modifiedAt: ts.modifiedAt });
            }
          }
        }
        if (seq !== seqRef.current) return;
        const lines = buildExplorerTooltipLines({
          name: node.name,
          type: node.type,
          relPath: node.relPath,
          createdAt,
          modifiedAt,
          folderCounts: node.type === 'folder' ? countFolderContents(node.children) : undefined,
        });
        if (lines.length === 0) return;
        const pos = placeTooltip(row, lines.length);
        setTip({ relPath, lines, ...pos });
      })();
    }, EXPLORER_HOVER_DELAY_MS);
  };

  return (
    <HoverRoot
      // data-explorer-tree : portée du CSS :hover (pas de re-rendu à chaque
      // ligne survolée, important sur un gros coffre).
      dataSet={{ explorerTree: '1' }}
      onMouseOver={(event) => {
        const root = asDom(event.currentTarget);
        const row = rowFromEvent(event.nativeEvent ?? event, root);
        if (!row) return;
        const relPath = relPathOf(row);
        if (relPath) startHover(row, relPath);
      }}
      onMouseOut={(event) => {
        const root = asDom(event.currentTarget);
        const related = (event.nativeEvent as unknown as MouseEvent).relatedTarget;
        if (root && related instanceof Node && root.contains(related)) {
          const next = rowFromEvent({ target: related }, root);
          const current = hoverRelPath.current;
          if (next && relPathOf(next) === current) return;
        }
        hide();
      }}
    >
      {children}
      {tip && (
        <View
          pointerEvents="none"
          style={[
            styles.tip,
            {
              position: 'fixed' as unknown as 'absolute',
              left: tip.left,
              top: tip.top,
              ...(Platform.OS === 'web' ? { boxShadow: '0 8px 20px rgba(0, 0, 0, 0.35)' } : {}),
            },
          ]}
        >
          {tip.lines.map((line, index) => (
            <Text key={index} style={index === 0 ? styles.tipTitle : styles.tipLine}>
              {line}
            </Text>
          ))}
        </View>
      )}
    </HoverRoot>
  );
}

const styles = StyleSheet.create({
  tip: {
    zIndex: 50,
    maxWidth: 260,
    backgroundColor: '#1c1c22',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 2,
  },
  tipTitle: {
    color: '#f5f5f7',
    fontSize: 12,
    fontWeight: '700',
  },
  tipLine: {
    color: '#c4c4cc',
    fontSize: 11,
    lineHeight: 16,
  },
});
