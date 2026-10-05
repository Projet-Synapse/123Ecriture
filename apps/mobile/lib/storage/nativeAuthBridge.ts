import { Linking, Platform } from 'react-native';

// Pont auth natif (Android) — l'équivalent React Native de
// apps/desktop/electron/auth.js : l'INTERFACE attendue par AuthContext.tsx
// (window.auth, voir types/global.d.ts) est exactement ce que `Linking`
// sait faire :
// - openExternal  → Linking.openURL (le navigateur système ouvre Google) ;
// - onCallback    → Linking.addEventListener('url') : le retour OAuth
//   arrive par le deep link app123ecriture://auth-callback (intent-filter
//   dans AndroidManifest.xml) ;
// - takePendingUrl → Linking.getInitialURL : l'app lancée À FROID par le
//   callback (elle était fermée au retour Google) reçoit l'URL de
//   lancement — même contrat que l'argv Electron (voir AuthContext).
// Les URLs hors schéma app123ecriture:// (lancement ordinaire) sont
// ignorées : seul le callback OAuth intéresse exchangeCallbackUrl, qui
// ignore de toute façon les URLs sans code (voir authCallback.ts).
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
