import { Platform } from 'react-native';

import { nativeVaultAdapter } from './nativeVaultAdapter';
import { nativeVaultsAdapter } from './nativeVaultsAdapter';
import { nativeSyncAdapter } from './nativeSyncAdapter';
import { nativePreferencesAdapter } from './nativePreferencesAdapter';
import { installNativeAuthBridge } from './nativeAuthBridge';

// Point d'entrée unique qui pose `window.vault`/`window.vaults`/`window.sync`
// et le pont auth (`window.auth`, voir nativeAuthBridge.ts) sur mobile natif
// (Android pour l'instant — voir nativeVaultAdapter.ts pour les limites
// connues) AVANT que le premier composant ne se monte (appelé depuis
// index.ts, pas App.tsx). Tous les écrans (NotesScreen.tsx, TasksScreen.tsx,
// CalendarScreen.tsx...) testent déjà
// `typeof window !== 'undefined' ? window.vault : undefined` sans savoir
// QUI a posé ce pont — cette fonction leur donne juste une vraie
// implémentation à trouver là, exactement comme le fait
// apps/desktop/electron/preload.ts côté Electron. Aucun fichier consommateur
// n'a besoin d'être modifié.
//
// `window.sync` (hachage du coffre pour la synchro cloud) et `window.auth`
// (connexion Google navigateur-système + deep link app123ecriture://) sont
// les deux pièces qui rendent Compte + Coffres distants fonctionnels sur
// Android — voir nativeSyncAdapter.ts / nativeAuthBridge.ts.
//
// `Platform.OS === 'web'` reste volontairement exclu : le web (hors coquille
// Electron) n'a ni pont Electron ni SAF Android — il continue d'afficher les
// messages "disponible sur desktop pour l'instant" déjà en place, Phase 2
// web restant un chantier séparé (File System Access API, voir
// docs/ARCHITECTURE.md §5).
export function installNativeBridges(): void {
  if (Platform.OS === 'web') return;
  if (typeof window === 'undefined') return;
  // Ne jamais écraser un pont Electron déjà présent (ne devrait jamais se
  // produire — Electron ne tourne pas sous Platform.OS==='android'/'ios' —
  // mais mieux vaut un garde-fou explicite qu'une supposition silencieuse.
  if (window.vault) return;

  window.vault = nativeVaultAdapter;
  window.vaults = nativeVaultsAdapter;
  window.sync = nativeSyncAdapter;
  // Personnalisation persistée (thème, accent, polices, largeurs de
  // panneaux…) — avant ce pont, tout se réinitialisait à chaque relance
  // (voir nativePreferencesAdapter.ts).
  window.preferences = nativePreferencesAdapter;
  installNativeAuthBridge();
}
