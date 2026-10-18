import { useEffect, useRef } from 'react';
import { View } from 'react-native';

// Superposition SVG générique pour dessiner des flèches entre deux points —
// utilisée par CanvasEditor.tsx pour les connexions entre cartes. Même
// échappatoire que `draggable` (voir VaultTreeView.tsx) : RN n'a pas de
// primitive de dessin vectoriel, on injecte un <svg> réel dans le DOM via
// une ref plutôt que d'ajouter une dépendance (react-native-svg) pour un
// seul besoin ponctuel.
const SVG_NS = 'http://www.w3.org/2000/svg';
const MARKER_ID = 'canvas-overlay-arrowhead';

export type OverlayLine = {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

type Props = {
  width: number;
  height: number;
  lines: OverlayLine[];
  color: string;
  onLineClick?: (id: string) => void;
};

export function SvgOverlay({ width, height, lines, color, onLineClick }: Props) {
  const containerRef = useRef<View>(null);

  useEffect(() => {
    const container = containerRef.current as unknown as HTMLElement | null;
    if (!container) return;
    container.innerHTML = '';

    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    // Le fond du SVG ne doit pas intercepter le glisser des cartes situées
    // en dessous ; chaque ligne réactive elle-même les évènements pointeur
    // pour rester cliquable (le CSS SVG autorise cette exception par
    // enfant, contrairement à `pointerEvents: 'none'` en React Native pur).
    svg.style.position = 'absolute';
    svg.style.top = '0';
    svg.style.left = '0';
    svg.style.pointerEvents = 'none';

    const defs = document.createElementNS(SVG_NS, 'defs');
    const marker = document.createElementNS(SVG_NS, 'marker');
    marker.setAttribute('id', MARKER_ID);
    marker.setAttribute('viewBox', '0 0 10 10');
    marker.setAttribute('refX', '8');
    marker.setAttribute('refY', '5');
    marker.setAttribute('markerWidth', '7');
    marker.setAttribute('markerHeight', '7');
    marker.setAttribute('orient', 'auto-start-reverse');
    const arrowPath = document.createElementNS(SVG_NS, 'path');
    arrowPath.setAttribute('d', 'M 0 0 L 10 5 L 0 10 z');
    arrowPath.setAttribute('fill', color);
    marker.appendChild(arrowPath);
    defs.appendChild(marker);
    svg.appendChild(defs);

    for (const line of lines) {
      const el = document.createElementNS(SVG_NS, 'line');
      el.setAttribute('x1', String(line.x1));
      el.setAttribute('y1', String(line.y1));
      el.setAttribute('x2', String(line.x2));
      el.setAttribute('y2', String(line.y2));
      el.setAttribute('stroke', color);
      el.setAttribute('stroke-width', '2');
      el.setAttribute('marker-end', `url(#${MARKER_ID})`);
      el.style.pointerEvents = 'stroke';
      if (onLineClick) {
        el.style.cursor = 'pointer';
        el.addEventListener('click', (event) => {
          event.stopPropagation();
          onLineClick(line.id);
        });
      }
      svg.appendChild(el);
    }

    container.appendChild(svg);
    return () => {
      container.innerHTML = '';
    };
  }, [width, height, lines, color, onLineClick]);

  return <View ref={containerRef} style={{ position: 'absolute', top: 0, left: 0, width, height }} pointerEvents="box-none" />;
}
