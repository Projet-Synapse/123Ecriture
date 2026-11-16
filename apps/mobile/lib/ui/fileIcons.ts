// ✒️ 123ECRITURE — lib/ui/fileIcons.ts — quelle icône pour quel fichier (forme, couleur, insigne)
//////////////////////////////////////////////////////////////////////////////
//
// Correspondance PURE (testée) fichier → icône, partagée par tout ce qui
// affiche un fichier (arbre, onglets, favoris, aperçu de dossier,
// recherche) sur desktop/web ET mobile — le rendu SVG vit dans
// components/vault/FileIcons.tsx.
//
// Demande 2026-11-16 :
//   • canvas : une FORME distincte (tableau de cartes), violet conservé ;
//   • .md : document plus CLAIR (bleu clair) avec insigne « md » ;
//   • .mdx : document bleu actuel avec insigne « mdx » ;
//   • code : une couleur PAR LANGAGE + insigne de ses initiales ;
//   • reste : document générique gris, insigne = extension (≤ 4 lettres).
//
//////////////////////////////////////////////////////////////////////////////

export type FileIconShape = 'document' | 'canvas' | 'chart' | 'drawing';

export type FileIconSpec = {
  shape: FileIconShape;
  // Trait / teinte de l'icône.
  color: string;
  // Insigne (≤ 4 caractères) — absent = pas d'insigne.
  badge?: string;
  // Couleur du TEXTE de l'insigne, lisible sur `color` (noir ou blanc).
  badgeText?: string;
};

export const MD_COLOR = '#9cc4ff';
export const MDX_COLOR = '#7aa2f7';
export const CANVAS_COLOR = '#bb9af7';
export const CHART_COLOR = '#9ece6a';
export const DRAWING_COLOR = '#e0af68';
export const GENERIC_COLOR = '#8a8f98';

// Langages : couleur (proche des couleurs usuelles de chaque langage) et
// insigne. Les variantes d'extension partagent la même entrée.
const CODE: Record<string, { color: string; badge: string }> = {
  py: { color: '#3572a5', badge: 'py' },
  js: { color: '#e8c400', badge: 'js' },
  mjs: { color: '#e8c400', badge: 'js' },
  cjs: { color: '#e8c400', badge: 'js' },
  jsx: { color: '#22b8d8', badge: 'jsx' },
  ts: { color: '#3178c6', badge: 'ts' },
  tsx: { color: '#0b8bb5', badge: 'tsx' },
  html: { color: '#e34c26', badge: 'html' },
  htm: { color: '#e34c26', badge: 'html' },
  css: { color: '#663399', badge: 'css' },
  scss: { color: '#c6538c', badge: 'scss' },
  json: { color: '#c48a00', badge: 'json' },
  yaml: { color: '#cb171e', badge: 'yml' },
  yml: { color: '#cb171e', badge: 'yml' },
  sh: { color: '#4eaa25', badge: 'sh' },
  bash: { color: '#4eaa25', badge: 'sh' },
  zsh: { color: '#4eaa25', badge: 'sh' },
  ps1: { color: '#2b5797', badge: 'ps1' },
  bat: { color: '#5a6b2f', badge: 'bat' },
  java: { color: '#b07219', badge: 'java' },
  c: { color: '#5c6bc0', badge: 'c' },
  h: { color: '#5c6bc0', badge: 'h' },
  cpp: { color: '#f34b7d', badge: 'cpp' },
  cc: { color: '#f34b7d', badge: 'cpp' },
  hpp: { color: '#f34b7d', badge: 'hpp' },
  cs: { color: '#178600', badge: 'cs' },
  go: { color: '#00add8', badge: 'go' },
  rs: { color: '#c96f30', badge: 'rs' },
  php: { color: '#4f5d95', badge: 'php' },
  rb: { color: '#cc342d', badge: 'rb' },
  kt: { color: '#a97bff', badge: 'kt' },
  kts: { color: '#a97bff', badge: 'kt' },
  swift: { color: '#f05138', badge: 'swft' },
  sql: { color: '#e38c00', badge: 'sql' },
  xml: { color: '#0060ac', badge: 'xml' },
  toml: { color: '#9c4221', badge: 'toml' },
  lua: { color: '#2c2d72', badge: 'lua' },
  r: { color: '#198ce7', badge: 'r' },
  dart: { color: '#00b4ab', badge: 'dart' },
  vue: { color: '#41b883', badge: 'vue' },
  svelte: { color: '#ff3e00', badge: 'svl' },
  scala: { color: '#c22d40', badge: 'sc' },
  pl: { color: '#0298c3', badge: 'pl' },
  ini: { color: '#6d8086', badge: 'ini' },
  txt: { color: GENERIC_COLOR, badge: 'txt' },
};

export function extensionOf(relPath: string | undefined | null): string {
  const name = (relPath ?? '').split('/').pop() ?? '';
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

// Texte noir ou blanc selon la luminance du fond (insigne lisible).
export function badgeTextColor(hex: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return '#ffffff';
  const n = parseInt(m[1], 16);
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const l = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  // Blanc tant qu'il garde un contraste ≥ 3:1 (texte gras de l'insigne),
  // sinon quasi-noir (fonds clairs : jaune JS, bleu clair MD…).
  return 1.05 / (l + 0.05) >= 3 ? '#ffffff' : '#111114';
}

function withBadge(shape: FileIconShape, color: string, badge?: string): FileIconSpec {
  return badge ? { shape, color, badge, badgeText: badgeTextColor(color) } : { shape, color };
}

export function fileIconFor(relPath: string | undefined | null, kind?: VaultEntryKind | string): FileIconSpec {
  const ext = extensionOf(relPath);
  if (kind === 'canvas' || ext === 'canvas') return withBadge('canvas', CANVAS_COLOR);
  if (kind === 'chart' || ext === 'chart') return withBadge('chart', CHART_COLOR);
  if (kind === 'excalidraw' || ext === 'excalidraw' || /\.excalidraw\.md$/i.test(relPath ?? '')) return withBadge('drawing', DRAWING_COLOR);
  if (ext === 'mdx') return withBadge('document', MDX_COLOR, 'mdx');
  if (ext === 'md' || ext === 'markdown' || (kind === 'markdown' && !ext)) return withBadge('document', MD_COLOR, 'md');
  const code = CODE[ext];
  if (code) return withBadge('document', code.color, code.badge);
  if (kind === 'markdown') return withBadge('document', MD_COLOR, 'md');
  return withBadge('document', GENERIC_COLOR, ext ? ext.slice(0, 4) : undefined);
}

// Taille de police de l'insigne (unités du viewBox 16×16) : plus le texte
// est long, plus il est petit — toujours dans la largeur du document.
export function badgeFontSize(badge: string): number {
  if (badge.length <= 2) return 6.5;
  if (badge.length === 3) return 5.6;
  return 4.6;
}

// Résultat de recherche qui EST un fichier du coffre (icône de fichier) —
// dossiers, pièces jointes, tâches et évènements gardent leur pictogramme.
export function isFileResultKind(kind: string): kind is VaultEntryKind {
  return kind === 'markdown' || kind === 'canvas' || kind === 'chart' || kind === 'excalidraw' || kind === 'code';
}
