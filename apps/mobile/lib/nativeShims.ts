import { Platform } from 'react-native';

// Filet de sécurité natif : sur Hermes, `window` EXISTE (alias de globalThis)
// mais les API d'évènements du DOM n'y sont pas — tout
// `window.addEventListener('keydown', …)` levait
// « TypeError: undefined is not a function » au montage des effets React
// (commitHookEffectListMount), crash au démarrage vu sur Android v0.4.41
// (offset 1:1820273 = AppShell.tsx, effet de raccourcis clavier).
//
// Les raccourcis clavier n'ont pas de sens sur écran tactile : un no-op
// suffit, et couvre AUSSI les oublis futurs (code applicatif ou dépendance)
// pour toute cette classe d'erreur. Les gardes explicites
// `Platform.OS !== 'web'` restent en place dans les écrans (effets clavier
// inutiles non même montés) — ce shim n'est que le dernier filet.
//
// Installé depuis index.ts AVANT le premier rendu, comme les ponts.
if (Platform.OS !== 'web') {
  const registre = globalThis as Record<string, unknown>;
  const noOp = () => undefined;
  if (typeof registre.addEventListener !== 'function') {
    registre.addEventListener = noOp;
  }
  if (typeof registre.removeEventListener !== 'function') {
    registre.removeEventListener = noOp;
  }
  // `window` est normalement === globalThis en RN ; par prudence, si un
  // objet window distinct existe, on le couvre aussi.
  const win = registre.window as Record<string, unknown> | undefined;
  if (win && win !== registre) {
    if (typeof win.addEventListener !== 'function') win.addEventListener = noOp;
    if (typeof win.removeEventListener !== 'function') win.removeEventListener = noOp;
  }
}

// Export vide : ce module n'existe que pour son effet d'installation.
export {};
