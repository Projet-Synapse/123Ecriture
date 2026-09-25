// Design tokens minimaux — première brique du moteur de thèmes décrit dans
// docs/ARCHITECTURE.md §7. Pour l'instant : juste clair/sombre selon les
// préférences système (via useColorScheme). La personnalisation poussée
// (couleurs choisies par l'utilisateur·rice, stockées dans le vault) arrive
// en Phase 4.

export type Theme = {
  background: string;
  surface: string;
  // Fond de l'éditeur de notes réglable (v0.4.34) — absent = background.
  // Porté par buildTheme (lib/appearance.ts), pas par les palettes de base.
  editorBackground?: string;
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
  text: '#111114',
  textMuted: '#6b7280',
  accent: '#4f46e5',
  border: '#e5e7eb',
  danger: '#dc2626',
};

export const darkTheme: Theme = {
  background: '#111114',
  surface: '#1c1c22',
  text: '#f5f5f7',
  textMuted: '#9ca3af',
  accent: '#818cf8',
  border: '#2a2a33',
  danger: '#dc2626',
};
