//////////////////////////////////////////////////////////////////////////////
//                                 main.ts                                  //  
//////////////////////////////////////////////////////////////////////////////

import { app, BrowserWindow, Menu, net, protocol } from 'electron';
import fs from 'fs';
import path from 'path';
import { pathToFileURL, URL } from 'url';

import { registerAuthHandlers, registerAuthProtocol } from './ponts-desktop/auth';
import { registerCalendarHandlers } from './calendar';
import { registerContextMenuHandlers } from './contextMenu';
import { registerOccurrencesHandlers } from './occurrences';
import { registerPreferencesHandlers } from './preferences';
import { registerPropertiesHandlers } from './properties';
import { registerSearchHandlers } from './search';
import { registerSyncHandlers } from './ponts-desktop/sync';
import { registerTasksHandlers } from './tasks';
import { checkOnStartup, registerUpdaterHandlers } from './updater';
import { registerVaultHandlers } from './ponts-desktop/vault';
import { getActiveVaultPath, registerVaultsHandlers } from './ponts-desktop/vaults';

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

function registerAppProtocol(): void {
  protocol.handle('app', (request) => {
    const { pathname } = new URL(request.url);
    let filePath = path.join(WEB_BUILD_DIR, decodeURIComponent(pathname));
    // Repli sur index.html pour la racine ou une route inconnue (contenu
    // local et confiance dans le build, pas d'entrée utilisateur ici).
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(WEB_BUILD_DIR, 'index.html');
    }
    // v0.4.76 — ANTI-CACHE (patron 123Creez desktop/main.js) : sans cet
    // en-tête, Chromium pouvait resservir du VIEUX JS depuis son cache après
    // une mise à jour — l'app tournait avec l'ancien code malgré la version
    // nouvellement installée.
    return net
      .fetch(pathToFileURL(filePath).toString())
      .then((response) => {
        response.headers.set('Cache-Control', 'no-cache');
        return response;
      });
  });
}

// Référence à la fenêtre principale, pour qu'updater.js/auth.js puissent lui
// pousser des évènements (mise à jour dispo, callback OAuth reçu...).
let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
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
    void win.loadURL(DEV_URL);
  } else {
    void win.loadURL('app://-/');
  }
}

// Connexion Google (voir auth.js) : le callback OAuth arrive via un
// protocole d'URL personnalisé (app123ecriture://auth-callback), que l'OS
// relaie en relançant l'app — sans verrou mono-instance, ça ouvrirait une
// DEUXIÈME fenêtre au lieu de relayer l'URL à celle déjà ouverte. Demandé
// tout de suite, avant toute autre init : si on ne l'obtient pas, une
// instance tourne déjà ailleurs et doit recevoir le relais à notre place —
// cette instance-ci n'a plus rien à faire.
const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  // macOS peut émettre 'open-url' avant même 'ready' si l'app est lancée
  // directement via le lien — le listener (posé dans registerAuthHandlers)
  // doit donc exister le plus tôt possible, pas seulement dans
  // whenReady().then(...).
  registerAuthHandlers(() => mainWindow);

  void app.whenReady().then(() => {
    // Retire la barre de menu par défaut (File/Edit/View/Window) qu'Electron
    // ajoute automatiquement — l'app n'en a pas l'usage. Sur macOS, ça retire
    // aussi les raccourcis clavier standards habituellement câblés via les
    // rôles du menu Edit (Cmd+C/V/X, Cmd+Q...) : à surveiller, un menu minimal
    // mac-only (juste ces rôles, sans les items visibles) pourra être ajouté
    // si ça pose problème à l'usage.
    Menu.setApplicationMenu(null);

    registerVaultHandlers(() => mainWindow);
    registerVaultsHandlers(() => mainWindow);
    registerUpdaterHandlers(() => mainWindow);
    registerPreferencesHandlers();
    registerContextMenuHandlers();
    registerTasksHandlers(() => mainWindow);
    registerSyncHandlers(() => mainWindow);
    registerCalendarHandlers();
    registerPropertiesHandlers();
    registerOccurrencesHandlers();
    registerSearchHandlers();
    registerAuthProtocol();

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

  app.on('second-instance', () => {
    // Le relais de l'URL de callback OAuth (voir auth.js, écouteur posé plus
    // haut) se fait via ce même évènement ; ici on s'assure juste que la
    // fenêtre existante reprend le focus si une deuxième instance a été
    // lancée pour une autre raison qu'un lien app123ecriture://.
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  // v0.4.81 — E1 de la spec (demande de l'utilisatrice) : « A chaque fois
  // qu'on éteint 123Ecriture, le journal annonce "Déconnecté au serveur".
  // Dans ce cas, nos données sont sauvegardées (même en cas de crash,
  // cela est fait). » L'entrée est écrite PAR LE MAIN PROCESS au moment du
  // quit : le renderer peut déjà être déchargé. Les données, elles, sont
  // déjà sur disque (sync-state/journal/revue écrits à chaque cycle).
  app.on('before-quit', () => {
    try {
      const vaultPath = getActiveVaultPath();
      if (!vaultPath) return;
      const journalPath = path.join(vaultPath, '.123ecriture', 'sync-journal.json');
      // Le journal est un OBJET { entries: [...] } (jamais une liste brute) —
      // une écriture en liste écrase le format que l'app lit au cycle suivant.
      let journal: { entries: unknown[] };
      try {
        const parsed = JSON.parse(fs.readFileSync(journalPath, 'utf-8'));
        journal = parsed && Array.isArray(parsed.entries) ? parsed : { entries: [] };
      } catch {
        journal = { entries: [] };
      }
      journal.entries.push({
        t: new Date().toISOString(),
        type: 'deconnexion',
        detail: 'Déconnecté du serveur — données sauvegardées',
      });
      fs.writeFileSync(journalPath, JSON.stringify(journal, null, 2), 'utf-8');
    } catch {
      // La fermeture ne doit JAMAIS échouer à cause du journal.
    }
  });
}
