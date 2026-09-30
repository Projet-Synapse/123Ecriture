import { Alert } from 'react-native';

import { registerRootComponent } from 'expo';

import App from './App';
import { installNativeBridges } from './lib/storage/installNativeBridges';
import { installWebBridges } from './lib/storage/installWebBridges';

// v0.4.40-diag : en build RELEASE, une erreur JS non capturée terminait
// l'app sans AUCUN message (pas de red box en production) — l'utilisatrice
// ne voyait qu'un crash mystère. Ce gestionnaire GLOBAL l'intercepte et
// AFFICHE le stack à l'écran (Alert natif, disponible en release) pour
// diagnostic. À retirer une fois la cause corrigée.
ErrorUtils.setGlobalHandler((error, isFatal) => {
  const stack = error && (error as { stack?: string }).stack ? String((error as { stack?: string }).stack) : String(error);
  try {
    Alert.alert(isFatal ? 'Erreur fatale' : 'Erreur', stack.slice(0, 1500));
  } catch {
    // Alert indisponible — rien de plus à faire, le log système garde le stack.
  }
});
installNativeBridges();

// Pose les ponts web (File System Access API) avant le premier rendu en
// navigateur pur (voir lib/storage/installWebBridges.ts) — no-op sur
// mobile natif et dans le renderer Electron (le preload a déjà tout câblé).
installWebBridges();

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
