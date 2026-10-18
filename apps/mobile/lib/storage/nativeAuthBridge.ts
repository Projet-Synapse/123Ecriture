// ✒️ 123ECRITURE — lib/storage/nativeAuthBridge.ts — pont auth natif (deep link Android)
//////////////////////////////////////////////////////////////////////////////
//
// Équivalent React Native de apps/desktop/electron/auth.js : l'INTERFACE
// attendue par AuthContext.tsx (window.auth, voir types/global.d.ts) est
// exactement ce que `Linking` sait faire.
//
// Invariants du fichier :
//   • openExternal → Linking.openURL (navigateur système) ; onCallback →
//     Linking.addEventListener('url') : le retour OAuth arrive par le deep
//     link app123ecriture://auth-callback (intent-filter du manifest) ;
//     takePendingUrl → Linking.getInitialURL pour l'app lancée À FROID par
//     le callback — même contrat que l'argv Electron.
//   • Seules les URLs du schéma app123ecriture:// sont considérées
//     pending : un lancement ordinaire n'est jamais un callback OAuth
//     (exchangeCallbackUrl ignore de toute façon les URLs sans code).
//   • Jamais posé sur web, jamais un pont existant écrasé (même garde
//     que installNativeBridges).
//
// SOMMAIRE :
//   1. Garde d'installation
//   2. Le pont Linking (openExternal / onCallback / takePendingUrl)
//
//////////////////////////////////////////////////////////////////////////////

//////// 1. Garde d'installation ////////////////////////////////////////////////////////

import { Linking, Platform } from 'react-native';

// Pont auth natif (Android) — la table de correspondance interface ↔ Linking
// est décrite dans l'en-tête du fichier.

//////// 2. Le pont Linking (openExternal / onCallback / takePendingUrl) ////////////////

export function installNativeAuthBridge(): void {
  if (Platform.OS === 'web') return;
  if (typeof window === 'undefined') return;
  // Ne jamais écraser un pont Electron déjà présent (même garde-fou que
  // installNativeBridges pour window.vault).
  if (window.auth) return;

  window.auth = {
    openExternal: (url: string) => Linking.openURL(url),
    onCallback: (callback: (url: string) => void) => {
      const subscription = Linking.addEventListener('url', (event) => callback(event.url));
      return () => subscription.remove();
    },
    takePendingUrl: async () => {
      try {
        const url = await Linking.getInitialURL();
        return url && url.startsWith('app123ecriture://') ? url : null;
      } catch {
        return null;
      }
    },
  };
}
