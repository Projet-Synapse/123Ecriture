// Design tokens minimaux — première brique du moteur de thèmes décrit dans
// docs/ARCHITECTURE.md §7. Pour l'instant : juste clair/sombre selon les
// préférences système (via useColorScheme). La personnalisation poussée
// (couleurs choisies par l'utilisateur·rice, stockées dans le vault) arrive
// en Phase 4.

import type { ExplorerColors } from './lib/theme/explorerColors';

export type Theme = {
  background: string;
  surface: string;
  // Fond de l'éditeur de notes réglable (v0.4.34) — absent = background.
  // Porté par buildTheme (lib/appearance.ts), pas par les palettes de base.
  editorBackground?: string;
  // Couleurs de l'EXPLORATEUR de fichiers (fond réglable, lignes de
  // guidage, texte et sélection lisibles) — portées par buildTheme
  // (lib/theme/explorerColors.ts) ; absent = dérivées des panneaux.
  explorer?: ExplorerColors;
  text: string;
  textMuted: string;
  accent: string;
  border: string;
  // Rouge "danger" partagé — suppressions, messages d'erreur, échéances en
  // retard. Même valeur dans les deux thèmes (lisible sur fond clair comme
  // sombre) : avant ce token, #dc2626 était dupliqué en dur dans une
  // quinzaine de composants, chacun pouvant dériver de l'autre au fil des
  // retouches.
  danger: string;
};

export const lightTheme: Theme = {
  background: '#ffffff',
  surface: '#f5f5f7',
  // Fond de la note (titre, propriétés, corps, marges) : blanc en clair,
  // indépendant du fond de l'app (explorateur, barres).
  editorBackground: '#ffffff',
  text: '#111114',
  textMuted: '#6b7280',
  accent: '#4f46e5',
  border: '#e5e7eb',
  danger: '#dc2626',
};

export const darkTheme: Theme = {
  background: '#111114',
  surface: '#1c1c22',
  editorBackground: '#111114',
  text: '#f5f5f7',
  textMuted: '#9ca3af',
  accent: '#818cf8',
  border: '#2a2a33',
  danger: '#dc2626',
};

// Fond de la zone de note (titre, propriétés, corps, marges) — blanc en
// thème clair, sombre en thème sombre, ou la couleur choisie dans
// Paramètres → Personnalisation. Ne pas utiliser `background` : c'est le
// fond de l'APP, souvent différent (papier vs chrome).
export function editorCanvasColor(theme: Theme): string {
  return theme.editorBackground ?? theme.background;
}
