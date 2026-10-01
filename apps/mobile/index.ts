import './lib/crashReport';

import { registerRootComponent } from 'expo';

import App from './App';
import { installNativeBridges } from './lib/storage/installNativeBridges';
import { installWebBridges } from './lib/storage/installWebBridges';

// v0.4.40-diag3 : chaque pont est isolé — un échec n'interrompt PAS le
// bundle (l'hypothèse du crash : une exception ici stoppait l'évaluation
// avant registerRootComponent, d'où « main has not been registered ») et
// l'erreur réelle est écrite dans crash-js.txt par le gestionnaire global.
try {
  installNativeBridges();
} catch (error) {
  void import('./lib/crashReport').then(({ reportError }) => reportError('installNativeBridges', error));
}
try {
  installWebBridges();
} catch (error) {
  void import('./lib/crashReport').then(({ reportError }) => reportError('installWebBridges', error));
}

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
