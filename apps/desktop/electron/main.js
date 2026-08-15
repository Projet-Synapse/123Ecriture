const { app, BrowserWindow, protocol, net, Menu } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const { URL, pathToFileURL } = require('url');
const { registerVaultHandlers } = require('./vault');

// Phase 1 : fenêtre qui charge le renderer web d'Expo (partagé avec
// apps/mobile) + le vault local (accès fs natif, voir vault.js et
// docs/ARCHITECTURE.md §5).

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

// Auto-update : source = les Releases GitHub du dépôt (déjà configuré dans
// apps/desktop/package.json → build.publish, réutilisé ici tel quel). Le
// dépôt doit être public pour qu'electron-updater puisse y accéder sans
// authentification — voir docs/ARCHITECTURE.md. Ne s'exécute qu'en version
// packagée : en dev il n'y a pas de version installée à mettre à jour, et
// electron-updater exige un app.getVersion() issu d'un vrai package.json
// buildé, pas du process de dev.
function checkForUpdates() {
  autoUpdater.checkForUpdatesAndNotify().catch((error) => {
    // Une vérification de mise à jour qui échoue (pas de réseau, dépôt
    // encore privé...) ne doit jamais empêcher l'app de démarrer.
    console.error('[auto-update] échec de la vérification :', error);
  });
}

app.whenReady().then(() => {
  // Retire la barre de menu par défaut (File/Edit/View/Window) qu'Electron
  // ajoute automatiquement — l'app n'en a pas l'usage. Sur macOS, ça retire
  // aussi les raccourcis clavier standards habituellement câblés via les
  // rôles du menu Edit (Cmd+C/V/X, Cmd+Q...) : à surveiller, un menu minimal
  // mac-only (juste ces rôles, sans les items visibles) pourra être ajouté
  // si ça pose problème à l'usage.
  Menu.setApplicationMenu(null);

  if (!isDev) {
    registerAppProtocol();
    checkForUpdates();
  }

  registerVaultHandlers();
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
