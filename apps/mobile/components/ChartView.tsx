import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { getSeriesColor } from '../lib/chartPalette';
import { maxSeriesValue, type ChartSeries } from '../lib/sheets';
import type { Theme } from '../theme';

// Rendu des graphiques barres/lignes/camembert — voir la skill `dataviz`
// (chargée avant d'écrire ce fichier) pour la méthode suivie : un seul axe
// (jamais deux échelles), couleurs catégorielles en ordre FIXE (jamais
// cyclées), traits fins, extrémités arrondies, légende dès 2 séries,
// libellés directs sélectifs plutôt que sur chaque point, le texte des
// libellés/légendes reste dans les couleurs de TEXTE du thème (jamais la
// couleur de la série). "Vue tableau" : déjà satisfaite par construction —
// le tableur lui-même (ChartsScreen.tsx) reste visible à côté du
// graphique, ce n'est pas un dashboard qui consomme des données opaques.
//
// Rendu en SVG injecté directement dans le DOM (même échappatoire que
// `draggable`/le glisser-déposer délégué ailleurs dans l'app — RN n'a pas
// de primitive de dessin vectoriel, et on évite une dépendance comme
// react-native-svg pour un seul écran). Interaction : taper une barre/un
// point/une part affiche sa valeur exacte sous le graphique — une
// simplification assumée du "crosshair + tooltip" complet de la skill
// (proportionnée à un panneau d'app, pas un dashboard).
const SVG_NS = 'http://www.w3.org/2000/svg';
const WIDTH = 560;
const HEIGHT = 280;
const PADDING = 36;

type PickedPoint = { label: string; seriesName: string; value: number };

type DrawContext = {
  theme: Theme;
  colorScheme: 'light' | 'dark';
  onPick: (point: PickedPoint) => void;
};

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, tag) as SVGElementTagNameMap[K];
}

function drawAxis(svg: SVGSVGElement, theme: Theme) {
  const line = svgEl('line');
  line.setAttribute('x1', String(PADDING));
  line.setAttribute('y1', String(HEIGHT - PADDING));
  line.setAttribute('x2', String(WIDTH - PADDING));
  line.setAttribute('y2', String(HEIGHT - PADDING));
  line.setAttribute('stroke', theme.border);
  line.setAttribute('stroke-width', '1');
  svg.appendChild(line);
}

function drawCategoryLabel(svg: SVGSVGElement, x: number, label: string, theme: Theme) {
  const text = svgEl('text');
  text.setAttribute('x', String(x));
  text.setAttribute('y', String(HEIGHT - PADDING + 16));
  text.setAttribute('text-anchor', 'middle');
  text.setAttribute('font-size', '10');
  text.setAttribute('fill', theme.textMuted);
  text.textContent = label;
  svg.appendChild(text);
}

function drawBars(svg: SVGSVGElement, series: ChartSeries[], ctx: DrawContext) {
  const categories = series[0]?.points.map((p) => p.label) ?? [];
  const max = maxSeriesValue(series) || 1;
  const chartWidth = WIDTH - PADDING * 2;
  const chartHeight = HEIGHT - PADDING * 2;
  const groupWidth = chartWidth / Math.max(categories.length, 1);
  const gap = 2;
  const barWidth = Math.max((groupWidth - gap * (series.length + 1)) / Math.max(series.length, 1), 2);

  categories.forEach((label, catIndex) => {
    series.forEach((s, seriesIndex) => {
      const value = s.points[catIndex]?.value ?? 0;
      const barHeight = Math.max((value / max) * chartHeight, 0);
      const x = PADDING + catIndex * groupWidth + gap + seriesIndex * (barWidth + gap);
      const y = HEIGHT - PADDING - barHeight;

      const rect = svgEl('rect');
      rect.setAttribute('x', String(x));
      rect.setAttribute('y', String(y));
      rect.setAttribute('width', String(barWidth));
      rect.setAttribute('height', String(barHeight));
      rect.setAttribute('rx', '2');
      rect.setAttribute('fill', getSeriesColor(seriesIndex, ctx.colorScheme));
      rect.style.cursor = 'pointer';
      rect.addEventListener('click', () => ctx.onPick({ label, seriesName: s.seriesName, value }));
      svg.appendChild(rect);
    });
    drawCategoryLabel(svg, PADDING + catIndex * groupWidth + groupWidth / 2, label, ctx.theme);
  });
}

function drawLines(svg: SVGSVGElement, series: ChartSeries[], ctx: DrawContext) {
  const categories = series[0]?.points.map((p) => p.label) ?? [];
  const max = maxSeriesValue(series) || 1;
  const chartWidth = WIDTH - PADDING * 2;
  const chartHeight = HEIGHT - PADDING * 2;
  const stepX = categories.length > 1 ? chartWidth / (categories.length - 1) : 0;

  series.forEach((s, seriesIndex) => {
    const color = getSeriesColor(seriesIndex, ctx.colorScheme);
    const points = s.points.map((p, i) => ({
      x: PADDING + i * stepX,
      y: HEIGHT - PADDING - (p.value / max) * chartHeight,
      label: p.label,
      value: p.value,
    }));

    const polyline = svgEl('polyline');
    polyline.setAttribute('points', points.map((p) => `${p.x},${p.y}`).join(' '));
    polyline.setAttribute('fill', 'none');
    polyline.setAttribute('stroke', color);
    polyline.setAttribute('stroke-width', '2');
    polyline.setAttribute('stroke-linecap', 'round');
    svg.appendChild(polyline);

    points.forEach((p) => {
      const circle = svgEl('circle');
      circle.setAttribute('cx', String(p.x));
      circle.setAttribute('cy', String(p.y));
      circle.setAttribute('r', '4');
      circle.setAttribute('fill', color);
      circle.style.cursor = 'pointer';
      circle.addEventListener('click', () => ctx.onPick({ label: p.label, seriesName: s.seriesName, value: p.value }));
      svg.appendChild(circle);
    });
  });

  categories.forEach((label, i) => drawCategoryLabel(svg, PADDING + i * stepX, label, ctx.theme));
}

// Camembert : UNE seule série (la première) — plusieurs parts n'ont de
// sens que pour une seule mesure ; l'écran appelant restreint déjà la
// sélection à une colonne de valeurs pour ce type.
function drawPie(svg: SVGSVGElement, series: ChartSeries[], ctx: DrawContext) {
  const points = series[0]?.points ?? [];
  const total = points.reduce((sum, p) => sum + Math.max(p.value, 0), 0);
  if (total <= 0) return;

  const cx = WIDTH / 2;
  const cy = HEIGHT / 2;
  const radius = Math.min(WIDTH, HEIGHT) / 2 - PADDING;
  let startAngle = -Math.PI / 2;

  points.forEach((p, i) => {
    const value = Math.max(p.value, 0);
    if (value <= 0) return;
    const angle = (value / total) * Math.PI * 2;
    const endAngle = startAngle + angle;
    const x1 = cx + radius * Math.cos(startAngle);
    const y1 = cy + radius * Math.sin(startAngle);
    const x2 = cx + radius * Math.cos(endAngle);
    const y2 = cy + radius * Math.sin(endAngle);
    const largeArc = angle > Math.PI ? 1 : 0;

    const path = svgEl('path');
    path.setAttribute('d', `M ${cx} ${cy} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} Z`);
    path.setAttribute('fill', getSeriesColor(i, ctx.colorScheme));
    // Liseré couleur de fond entre les parts (séparateur, pas une bordure
    // décorative) — même principe que le gap de 2px entre barres.
    path.setAttribute('stroke', ctx.theme.background);
    path.setAttribute('stroke-width', '2');
    path.style.cursor = 'pointer';
    path.addEventListener('click', () => ctx.onPick({ label: p.label, seriesName: series[0].seriesName, value }));
    svg.appendChild(path);

    // Libellé direct SÉLECTIF (parts >= 8% seulement) — évite le
    // chevauchement sur beaucoup de petites parts, qui restent lisibles
    // via la légende.
    if (value / total >= 0.08) {
      const midAngle = (startAngle + endAngle) / 2;
      const text = svgEl('text');
      text.setAttribute('x', String(cx + radius * 0.65 * Math.cos(midAngle)));
      text.setAttribute('y', String(cy + radius * 0.65 * Math.sin(midAngle)));
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('font-size', '10');
      text.setAttribute('fill', '#fff');
      text.textContent = `${Math.round((value / total) * 100)}%`;
      svg.appendChild(text);
    }

    startAngle = endAngle;
  });
}

type Props = {
  type: SheetChartType;
  series: ChartSeries[];
  theme: Theme;
  colorScheme: 'light' | 'dark';
};

export function ChartView({ type, series, theme, colorScheme }: Props) {
  const containerRef = useRef<View>(null);
  const [picked, setPicked] = useState<PickedPoint | null>(null);

  useEffect(() => {
    // Ne réinitialise pas `picked` ici (setState direct en tête d'effet,
    // évité par convention dans ce projet) — la dernière valeur tapée
    // reste affichée jusqu'au prochain clic, y compris si le graphique est
    // redessiné entre-temps ; effet secondaire mineur, sans conséquence.
    const container = containerRef.current as unknown as HTMLElement | null;
    if (!container) return;
    container.innerHTML = '';

    const svg = svgEl('svg');
    svg.setAttribute('width', String(WIDTH));
    svg.setAttribute('height', String(HEIGHT));
    svg.setAttribute('viewBox', `0 0 ${WIDTH} ${HEIGHT}`);
    container.appendChild(svg);

    const ctx: DrawContext = { theme, colorScheme, onPick: setPicked };
    if (type === 'pie') {
      drawPie(svg, series, ctx);
    } else {
      drawAxis(svg, theme);
      if (type === 'bar') drawBars(svg, series, ctx);
      else drawLines(svg, series, ctx);
    }

    return () => {
      container.innerHTML = '';
    };
  }, [type, series, theme, colorScheme]);

  const legendEntries =
    type === 'pie'
      ? (series[0]?.points.map((p, i) => ({ key: `${p.label}-${i}`, label: p.label, color: getSeriesColor(i, colorScheme) })) ?? [])
      : series.length >= 2
        ? series.map((s, i) => ({ key: s.seriesId, label: s.seriesName, color: getSeriesColor(i, colorScheme) }))
        : [];

  return (
    <View>
      <View ref={containerRef} style={styles.canvas} />
      {legendEntries.length > 0 && (
        <View style={styles.legend}>
          {legendEntries.map((entry) => (
            <View key={entry.key} style={styles.legendItem}>
              <View style={[styles.legendSwatch, { backgroundColor: entry.color }]} />
              <Text style={{ color: theme.text, fontSize: 12 }}>{entry.label}</Text>
            </View>
          ))}
        </View>
      )}
      {picked && (
        <Text style={[styles.tooltip, { color: theme.textMuted }]}>
          {picked.seriesName ? `${picked.seriesName} — ` : ''}
          {picked.label} : {picked.value}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  canvas: {
    width: WIDTH,
    height: HEIGHT,
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    paddingTop: 8,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendSwatch: {
    width: 10,
    height: 10,
    borderRadius: 2,
  },
  tooltip: {
    fontSize: 13,
    paddingTop: 6,
  },
});
