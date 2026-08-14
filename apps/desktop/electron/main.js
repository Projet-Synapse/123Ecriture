const { app, BrowserWindow } = require('electron');
const path = require('path');

// Phase 0 : fenêtre minimale qui charge le renderer web d'Expo (partagé
// avec apps/mobile). Aucun accès au système de fichiers ici — le
// VaultAdapter Electron (accès fs natif, voir docs/ARCHITECTURE.md §5)
// arrive en Phase 1.

const isDev = !app.isPackaged;
const DEV_URL = process.env.EXPO_WEB_URL || 'http://localhost:8081';
// En paquet (electron-builder), le build web est copié dans les resources
// de l'app via `extraResources` (voir apps/desktop/package.json → build).
// Hors paquet (ex. `electron .` avec isDev forcé à false pour tester le
// build sans tout packager), on retombe sur le dist/ voisin d'apps/mobile.
const PROD_BUILD_INDEX = app.isPackaged
  ? path.join(process.resourcesPath, 'web-build', 'index.html')
  : path.join(__dirname, '../../mobile/dist/index.html');

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    title: '123Ecriture',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    win.loadURL(DEV_URL);
  } else {
    // Nécessite d'avoir exporté le build web au préalable :
    // pnpm --filter @123ecriture/mobile build:web
    win.loadFile(PROD_BUILD_INDEX);
  }
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
