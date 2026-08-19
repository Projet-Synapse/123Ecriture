import { registerRootComponent } from 'expo';

import App from './App';
import { installNativeBridges } from './lib/storage/installNativeBridges';

// Pose window.vault/window.vaults sur Android natif avant le premier rendu
// (voir lib/storage/installNativeBridges.ts) — no-op sur web/Electron.
installNativeBridges();

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
