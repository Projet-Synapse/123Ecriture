import { Platform } from 'react-native';

import { nativeVaultAdapter } from './nativeVaultAdapter';
import { nativeVaultsAdapter } from './nativeVaultsAdapter';
import { nativeSyncAdapter } from './nativeSyncAdapter';
import { nativePreferencesAdapter } from './nativePreferencesAdapter';
import { nativeTaskListsBridge, nativeTasksBridge } from './nativeTasksAdapter';
import { installNativeAuthBridge } from './nativeAuthBridge';

// ✒️ 123ECRITURE — lib/storage/installNativeBridges.ts — installation des ponts natifs (Android)
//////////////////////////////////////////////////////////////////////////////
//
// Point d'entrée unique qui pose `window.vault`/`window.vaults`/`window.sync`
// et le pont auth (`window.auth`, voir nativeAuthBridge.ts) sur mobile
// natif (Android pour l'instant), AVANT que le premier composant ne se
// monte (appelé depuis index.ts, pas App.tsx) — l'équivalent de
// apps/desktop/electron/preload.ts côté Electron. Les écrans testent
// `typeof window !== 'undefined' ? window.vault : undefined` sans savoir
// QUI a posé ce pont ; cette fonction leur donne une vraie implémentation
// à trouver là, aucun consommateur n'a besoin de modification.
//
// Invariants du fichier :
//   • Installation AVANT le premier montage : les contextes lisent
//     `window.<domain>` de façon synchrone.
//   • `window.sync` (hachage du coffre pour la synchro cloud) et
//     `window.auth` (connexion Google navigateur-système + deep link
//     app123ecriture://) sont les deux pièces qui rendent Compte + Coffres
//     distants fonctionnels sur Android.
//   • `Platform.OS === 'web'` reste exclu : le web n'a ni pont Electron ni
//     SAF Android — il garde ses messages « disponible sur desktop » (le
//     pont web FSA est un chantier séparé, installWebBridges.ts).
//   • Jamais un pont existant écrasé — garde-fou explicite plutôt qu'une
//     supposition silencieuse.
//
// SOMMAIRE :
//   1. Garde d'installation
//   2. Le câblage des ponts window.*
//
//////////////////////////////////////////////////////////////////////////////

//////// 1. Garde d'installation ////////////////////////////////////////////////////////

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

  //////// 2. Le câblage des ponts window.* ///////////////////////////////////////////////

  // Personnalisation persistée (thème, accent, polices, largeurs de
  // panneaux…) — voir nativePreferencesAdapter.ts.
  window.preferences = nativePreferencesAdapter;
  // Tâches PAR COFFRE — voir nativeTasksAdapter.ts.
  window.tasks = nativeTasksBridge;
  window.taskLists = nativeTaskListsBridge;
  installNativeAuthBridge();
}
