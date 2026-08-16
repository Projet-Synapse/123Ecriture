const { app, ipcMain, shell } = require('electron');
const path = require('path');

// Connexion Google via Supabase Auth (OAuth système, PKCE) — voir
// docs/ARCHITECTURE.md §6 et apps/mobile/lib/sync/AuthContext.tsx. Le client
// Supabase (session, échange PKCE) vit entièrement dans le renderer ; ce
// fichier ne fait que le pont "navigateur système + protocole personnalisé"
// propre à Electron :
// 1. Le renderer demande d'ouvrir une URL dans le navigateur PAR DÉFAUT
//    (auth:open-external) plutôt que dans la fenêtre de l'app — un
//    formulaire de connexion Google dans une fenêtre Electron est bloqué
//    par Google (politique anti-automatisation "disallowed_useragent").
// 2. Une fois la connexion terminée, Google → Supabase redirigent le
//    navigateur vers `123ecriture://auth-callback?code=...` ; l'OS relance/
//    relaie cette URL à notre app via le protocole personnalisé enregistré
//    ci-dessous (nécessite le verrou mono-instance, voir main.js).
// 3. On renvoie cette URL au renderer (`auth:callback`), qui termine
//    l'échange PKCE (`exchangeCodeForSession`) avec le client Supabase.
const PROTOCOL = '123ecriture';

// Enregistre l'app comme gestionnaire du protocole `123ecriture://`. En dev
// (non empaqueté), Electron a besoin du chemin de l'exécutable + du script
// pour relancer correctement l'app depuis le protocole (sinon Windows en
// particulier relance juste `electron.exe` sans argument) ; en build
// empaqueté, l'appel simple suffit (voir aussi `build.protocols` dans
// apps/desktop/package.json pour l'enregistrement au niveau OS/installeur).
function registerAuthProtocol() {
  if (process.defaultApp && process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
  } else {
    app.setAsDefaultProtocolClient(PROTOCOL);
  }
}

// Windows/Linux : le protocole personnalisé relance l'app (captée par le
// verrou mono-instance dans main.js) avec l'URL quelque part dans argv.
function findProtocolUrlInArgv(argv) {
  return argv.find((arg) => arg.startsWith(`${PROTOCOL}://`)) ?? null;
}

function registerAuthHandlers(getWindow) {
  ipcMain.handle('auth:open-external', async (_event, url) => {
    if (typeof url !== 'string' || !url.startsWith('https://')) {
      throw new Error('URL de connexion invalide.');
    }
    await shell.openExternal(url);
  });

  const deliverCallback = (url) => {
    const win = getWindow?.();
    if (!win) return;
    // Le navigateur système a pris le focus pendant la connexion — le
    // rendre explicitement à l'app une fois le callback reçu, sinon
    // l'utilisatrice se retrouve "connectée" sans même voir la fenêtre
    // changer d'état.
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    win.webContents.send('auth:callback', url);
  };

  // macOS : callback livré via cet évènement (peut arriver avant
  // `app.whenReady()`, voir main.js pour l'enregistrement précoce du
  // listener correspondant).
  app.on('open-url', (event, url) => {
    if (!url.startsWith(`${PROTOCOL}://`)) return;
    event.preventDefault();
    deliverCallback(url);
  });

  // Windows/Linux : callback livré via les argv de la "deuxième instance"
  // qu'Electron intercepte grâce à `app.requestSingleInstanceLock()`
  // (voir main.js) — sans ce verrou, ouvrir le lien relancerait une
  // deuxième fenêtre de l'app au lieu de relayer l'URL à celle déjà
  // ouverte.
  app.on('second-instance', (_event, argv) => {
    const url = findProtocolUrlInArgv(argv);
    if (url) deliverCallback(url);
  });
}

module.exports = { PROTOCOL, registerAuthProtocol, registerAuthHandlers, findProtocolUrlInArgv };
