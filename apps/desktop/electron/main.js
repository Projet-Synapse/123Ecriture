const { app, BrowserWindow, protocol, net, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { URL, pathToFileURL } = require('url');
const { registerVaultHandlers } = require('./vault');
const { registerUpdaterHandlers, checkOnStartup } = require('./updater');
const { registerPreferencesHandlers } = require('./preferences');
const { registerContextMenuHandlers } = require('./contextMenu');

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

// Référence à la fenêtre principale, pour que updater.js puisse lui
// pousser les événements de mise à jour (checking/downloading/ready...).
let mainWindow = null;

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

  mainWindow = win;
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });

  if (isDev) {
    win.loadURL(DEV_URL);
  } else {
    win.loadURL('app://-/');
  }
}

app.whenReady().then(() => {
  // Retire la barre de menu par défaut (File/Edit/View/Window) qu'Electron
  // ajoute automatiquement — l'app n'en a pas l'usage. Sur macOS, ça retire
  // aussi les raccourcis clavier standards habituellement câblés via les
  // rôles du menu Edit (Cmd+C/V/X, Cmd+Q...) : à surveiller, un menu minimal
  // mac-only (juste ces rôles, sans les items visibles) pourra être ajouté
  // si ça pose problème à l'usage.
  Menu.setApplicationMenu(null);

  registerVaultHandlers();
  registerUpdaterHandlers(() => mainWindow);
  registerPreferencesHandlers();
  registerContextMenuHandlers();

  if (!isDev) {
    registerAppProtocol();
    // Vérification silencieuse au démarrage — l'état (dispo/téléchargement/
    // prêt) est ensuite affiché et piloté depuis l'écran Paramètres, pas
    // via une notification OS. Voir docs/ARCHITECTURE.md : nécessite le
    // dépôt public. Jamais fatale au démarrage de l'app (erreurs gérées
    // dans updater.js, qui garde aussi l'état pour l'UI même si elle se
    // monte après que les premiers événements soient passés).
    checkOnStartup(() => mainWindow);
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
