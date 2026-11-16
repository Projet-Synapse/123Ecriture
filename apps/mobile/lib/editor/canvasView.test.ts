import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  canvasBounds,
  canvasColor,
  edgeGeometry,
  fileNodeLabel,
  fitViewport,
  inferSides,
  paintOrder,
  parseCanvas,
  screenToWorld,
  zoomAt,
} from './canvasView';

const fixture = readFileSync(join(__dirname, '__fixtures__/obsidian-hierarchie.canvas'), 'utf8');

describe('parseCanvas — vrai fichier Obsidian', () => {
  const data = parseCanvas(fixture);
  it('lit tous les nœuds (text, file, link, group) et toutes les arêtes', () => {
    expect(data.nodes.map((n) => n.type)).toEqual(['group', 'text', 'file', 'file', 'link', 'text']);
    expect(data.edges).toHaveLength(4);
    expect(data.nodes[0]).toMatchObject({ label: 'Les Eleven', color: '6', x: -720, y: -460 });
  });
  it('BOM UTF-8, JSON invalide, champs manquants : jamais d’exception', () => {
    expect(parseCanvas('\uFEFF' + fixture).nodes).toHaveLength(6);
    expect(parseCanvas('{pas du json')).toEqual({ nodes: [], edges: [] });
    expect(parseCanvas('')).toEqual({ nodes: [], edges: [] });
    const d = parseCanvas('{"nodes":[{"id":"a","type":"bizarre","x":"10"}],"edges":[{"fromNode":"a"}]}');
    expect(d.nodes[0]).toMatchObject({ id: 'a', type: 'text', x: 10, y: 0, width: 250, height: 60 });
    expect(d.edges).toEqual([]);
  });
  it('conserve les champs inconnus (réécrits tels quels)', () => {
    const d = parseCanvas(
      '{"nodes":[{"id":"a","type":"text","x":0,"y":0,"width":10,"height":10,"styleAttributes":{"shape":"pill"}}],"edges":[]}',
    );
    expect((d.nodes[0] as unknown as { styleAttributes: unknown }).styleAttributes).toEqual({ shape: 'pill' });
  });
});

describe('cadrage — la cause de la zone vide', () => {
  const data = parseCanvas(fixture);
  const bounds = canvasBounds(data.nodes)!;
  it('boîte englobante en coordonnées négatives', () => {
    expect(bounds).toEqual({ minX: -720, minY: -460, maxX: 880, maxY: 180 });
  });
  it('tous les nœuds tombent DANS la vue après cadrage (800×520)', () => {
    const v = fitViewport(bounds, 800, 520);
    for (const n of data.nodes) {
      const left = n.x * v.scale + v.x;
      const top = n.y * v.scale + v.y;
      expect(left).toBeGreaterThanOrEqual(0);
      expect(top).toBeGreaterThanOrEqual(0);
      expect(left + n.width * v.scale).toBeLessThanOrEqual(800);
      expect(top + n.height * v.scale).toBeLessThanOrEqual(520);
    }
    expect(v.scale).toBeLessThan(1);
  });
  it('petit canvas : pas d’agrandissement, centré', () => {
    const v = fitViewport({ minX: 0, minY: 0, maxX: 100, maxY: 50 }, 800, 600);
    expect(v.scale).toBe(1);
    expect(v.x).toBe(350);
    expect(v.y).toBe(275);
  });
  it('vue de taille nulle ou canvas vide : vue par défaut sans NaN', () => {
    expect(fitViewport(null, 800, 600)).toEqual({ x: 400, y: 300, scale: 1 });
    expect(fitViewport(bounds, 0, 0)).toEqual({ x: 0, y: 0, scale: 1 });
  });
  it('zoom autour du curseur', () => {
    const v = { x: 100, y: 50, scale: 1 };
    const z = zoomAt(v, 2, 300, 200);
    expect(screenToWorld(z, 300, 200)).toEqual(screenToWorld(v, 300, 200));
    expect(zoomAt(v, 1000, 0, 0).scale).toBe(2);
  });
});

describe('liens et couleurs', () => {
  const data = parseCanvas(fixture);
  const byId = new Map(data.nodes.map((n) => [n.id, n]));
  it('couleurs préréglées 1-6 et hex', () => {
    expect(canvasColor('1')).toBe('#fb464c');
    expect(canvasColor('6')).toBe('#a882ff');
    expect(canvasColor('#2f80ed')).toBe('#2f80ed');
    expect(canvasColor('rouge')).toBeNull();
    expect(canvasColor(undefined)).toBeNull();
  });
  it('ancrage sur fromSide/toSide, flèches, couleur, étiquette ; arête pendante ignorée', () => {
    const [e1, e2, e3, e4] = data.edges.map((e) => edgeGeometry(e, byId));
    expect(e1?.start).toEqual({ x: -340, y: -320 });
    expect(e1?.end).toEqual({ x: -240, y: -280 });
    expect(e1?.arrows).toHaveLength(1);
    expect(e2).toMatchObject({ start: { x: -40, y: -180 }, end: { x: -40, y: -120 }, color: '#44cf6e', label: 'supérieur de' });
    expect(e3?.arrows).toHaveLength(1); // fromEnd arrow, toEnd none
    expect(e4).toBeNull();
  });
  it('côtés déduits quand absents', () => {
    const a = { id: 'a', type: 'text', x: 0, y: 0, width: 10, height: 10 } as CanvasNode;
    const b = { ...a, id: 'b', y: 200 };
    expect(inferSides(a, b)).toEqual({ fromSide: 'bottom', toSide: 'top' });
    expect(inferSides(b, a)).toEqual({ fromSide: 'top', toSide: 'bottom' });
  });
  it('groupes dessinés derrière ; titre des nœuds fichier', () => {
    expect(paintOrder(data.nodes)[0].type).toBe('group');
    expect(fileNodeLabel(data.nodes[2])).toBe('Nora');
    expect(fileNodeLabel(data.nodes[3])).toBe('Ilyan › Rôle');
    expect(fileNodeLabel({ file: 'a.md', title: 'Titre' })).toBe('Titre');
  });
});
