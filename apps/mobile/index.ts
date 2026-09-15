import { registerRootComponent } from 'expo';

import App from './App';
import { installNativeBridges } from './lib/storage/installNativeBridges';
import { installWebBridges } from './lib/storage/installWebBridges';

// Pose window.vault/window.vaults sur Android natif avant le premier rendu
// (voir lib/storage/installNativeBridges.ts) — no-op sur web/Electron.
installNativeBridges();

// Pose les ponts web (File System Access API) avant le premier rendu en
// navigateur pur (voir lib/storage/installWebBridges.ts) — no-op sur
// mobile natif et dans le renderer Electron (le preload a déjà tout câblé).
installWebBridges();

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
