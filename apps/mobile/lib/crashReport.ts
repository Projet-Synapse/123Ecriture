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
  const bloc = '=== ERREUR ' + (isFatal ? 'FATALE' : 'non-fatale') + ' ' + new Date().toISOString() + ' ===' + String.fromCharCode(10) + stack.slice(0, 2000) + String.fromCharCode(10, 10);
  try {
    const FileSystem = require('expo-file-system');
    void FileSystem.writeAsStringAsync(
      FileSystem.documentDirectory + 'crash-js.txt',
      bloc,
      { encoding: FileSystem.EncodingType.UTF8 },
    ).catch(() => undefined);
  } catch {
    // canal fichier indisponible
  }
  try {
    Alert.alert(isFatal ? 'Erreur fatale (JS)' : 'Erreur (JS)', stack.slice(0, 1200));
  } catch {
    // Alert indisponible — logcat garde le stack.
  }
  // v0.4.40-diag4 : TOUJOURS logger en logcat (lisible par `adb logcat`
  // avec le débogage USB, même en release) — le fichier seul ne suffit pas
  // si l'app crash avant que le fichier soit lu.
  console.error('[crash-diag]', stack);
});

// Export vide : ce module n'existe que pour son effet d'installation.
// Erreur rapportée par un appelant (ponts, initialisation) — même canal
// fichier + Alert que le gestionnaire global.
export function reportError(source: string, error: unknown): void {
  const err = error as { stack?: string; message?: string } | undefined;
  const stack = err?.stack || err?.message || String(error);
  const bloc = '=== ERREUR ' + source + ' ' + new Date().toISOString() + ' ===' + String.fromCharCode(10) + stack.slice(0, 2000) + String.fromCharCode(10, 10);
  try {
    const FileSystem = require('expo-file-system');
    void FileSystem.writeAsStringAsync(
      FileSystem.documentDirectory + 'crash-js.txt',
      bloc,
      { encoding: FileSystem.EncodingType.UTF8 },
    ).catch(() => undefined);
  } catch {
    // canal fichier indisponible
  }
  try {
    Alert.alert('Erreur (JS) — ' + source, stack.slice(0, 1200));
  } catch {
    // pas d'Alert
  }
}
