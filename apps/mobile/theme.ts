// Design tokens minimaux — première brique du moteur de thèmes décrit dans
// docs/ARCHITECTURE.md §7. Pour l'instant : juste clair/sombre selon les
// préférences système (via useColorScheme). La personnalisation poussée
// (couleurs choisies par l'utilisateur·rice, stockées dans le vault) arrive
// en Phase 4.

export type Theme = {
  background: string;
  surface: string;
  text: string;
  textMuted: string;
  accent: string;
  border: string;
};

export const lightTheme: Theme = {
  background: '#ffffff',
  surface: '#f5f5f7',
  text: '#111114',
  textMuted: '#6b7280',
  accent: '#4f46e5',
  border: '#e5e7eb',
};

export const darkTheme: Theme = {
  background: '#111114',
  surface: '#1c1c22',
  text: '#f5f5f7',
  textMuted: '#9ca3af',
  accent: '#818cf8',
  border: '#2a2a33',
};
