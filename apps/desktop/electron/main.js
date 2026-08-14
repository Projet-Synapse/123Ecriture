const { app, BrowserWindow, protocol, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { URL, pathToFileURL } = require('url');

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
// Nécessite d'avoir exporté le build web au préalable :
// pnpm --filter @123ecriture/mobile build:web
const WEB_BUILD_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'web-build')
  : path.join(__dirname, '../../mobile/dist');

// L'export web d'Expo génère des chemins d'assets absolus (ex.
// "/_expo/static/js/web/index-xxx.js"). Chargés via win.loadFile (donc
// file://), ces chemins absolus se résolvent depuis la racine du système de
// fichiers au lieu du dossier du build → page blanche, le script principal
// ne se charge jamais. On sert donc le build via un protocole personnalisé
// (qui se comporte comme un vrai serveur, origine incluse), l'approche
// documentée par Electron pour ce cas précis :
// https://www.electronjs.org/docs/latest/api/protocol
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

function registerAppProtocol() {
  protocol.handle('app', (request) => {
    const { pathname } = new URL(request.url);
    let filePath = path.join(WEB_BUILD_DIR, decodeURIComponent(pathname));
    // Repli sur index.html pour la racine ou une route inconnue (contenu
    // local et confiance dans le build, pas d'entrée utilisateur ici).
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(WEB_BUILD_DIR, 'index.html');
    }
    return net.fetch(pathToFileURL(filePath).toString());
  });
}

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
    win.loadURL('app://-/');
  }
}

app.whenReady().then(() => {
  if (!isDev) {
    registerAppProtocol();
  }

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
