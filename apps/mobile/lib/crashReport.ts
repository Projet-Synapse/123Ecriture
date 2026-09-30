import { Alert } from 'react-native';

// v0.4.40-diag2 : gestionnaire d'erreurs JS installé EN PREMIER (importé
// avant tout autre module de index.ts — Metro exécute les require dans
// l'ordre, donc ce fichier court avant tout le reste). En build release,
// une erreur de chargement de module terminait l'app sans message.
// Affiche le stack dans une Alert native (disponible en release) pour
// diagnostic par capture d'écran. À retirer une fois la cause corrigée.
ErrorUtils.setGlobalHandler((error, isFatal) => {
  const err = error as { stack?: string; message?: string } | undefined;
  const stack = err?.stack || err?.message || String(error);
  try {
    Alert.alert(isFatal ? 'Erreur fatale (JS)' : 'Erreur (JS)', stack.slice(0, 1500));
  } catch {
    // Alert indisponible — logcat garde le stack.
  }
  if (__DEV__) {
    console.error('[crash]', stack);
  }
});

// Export vide : ce module n'existe que pour son effet d'installation.
export {};
