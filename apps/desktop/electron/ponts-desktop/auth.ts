//////////////////////////////////////////////////////////////////////////////
//                                 auth.ts                                  //  
//////////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////////
//
// Connexion Google via Supabase Auth, côté process main. Le client Supabase
// (session, échange PKCE) vit entièrement dans le renderer (voir
// apps/mobile/lib/sync/AuthContext.tsx) ; ce fichier ne fait que le pont
// « navigateur système + protocole personnalisé » propre à Electron :
// 1. le renderer demande d'ouvrir l'URL de connexion dans le navigateur PAR
//    DÉFAUT (auth:open-external) — un formulaire Google dans une fenêtre
//    Electron est bloqué par Google (politique anti-automatisation
//    "disallowed_useragent") ;
// 2. la connexion terminée, Google → Supabase redirigent le navigateur vers
//    `app123ecriture://auth-callback?code=...` et l'OS relaie cette URL à
//    l'app via le protocole personnalisé enregistré ci-dessous (nécessite
//    le verrou mono-instance, voir main.js) ;
// 3. le main renvoie cette URL au renderer (auth:callback), qui termine
//    l'échange PKCE (exchangeCodeForSession) avec le client Supabase.
//
// Invariants du fichier :
//   • La connexion passe TOUJOURS par le navigateur par défaut, jamais
//     dans une fenêtre Electron (sinon Google bloque).
//   • Un schéma d'URI ne peut PAS commencer par un chiffre (RFC 3986) —
//     `123ecriture` seul est invalide ("Protocol scheme must start with an
//     ASCII letter") : le préfixe `app` est obligatoire.
//   • Le callback est capté dans les DEUX états de l'app : déjà ouverte
//     (open-url sur macOS, second-instance sur Windows/Linux) ou fermée
//     (URL en argv de la première instance, récupérée par le renderer via
//     auth:take-pending-url) — sinon la connexion est impossible dans
//     l'un des deux cas.
//   • Le verrou mono-instance de main.js est requis : sans lui, ouvrir le
//     lien relancerait une deuxième fenêtre au lieu de relayer l'URL à
//     celle déjà ouverte.
//
// SOMMAIRE :
//   1. Le protocole personnalisé et son enregistrement
//   2. La livraison du callback OAuth au renderer
//
//////////////////////////////////////////////////////////////////////////////

import { app, ipcMain, shell, type BrowserWindow } from 'electron';
import { spawnSync } from 'child_process';
import path from 'path';

type GetWindow = () => BrowserWindow | null;

//////// 1. Le protocole personnalisé et son enregistrement ////////////////

// Un schéma d'URI ne peut PAS commencer par un chiffre (RFC 3986) —
// `123ecriture` seul est donc invalide ("Protocol scheme must start with an
// ASCII letter"). D'où le préfixe `app`.
export const PROTOCOL = 'app123ecriture';

// Enregistre l'app comme gestionnaire du protocole `app123ecriture://`. En dev
// (non empaqueté), Electron a besoin du chemin de l'exécutable + du script
// pour relancer correctement l'app depuis le protocole (sinon Windows en
// particulier relance juste `electron.exe` sans argument) ; en build
// empaqueté, l'appel simple suffit (voir aussi `build.protocols` dans
// apps/desktop/package.json pour l'enregistrement au niveau OS/installeur).
export function registerAuthProtocol(): void {
  if (process.defaultApp && process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
  } else {
    app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, []);
  }
  // Repli Windows : la forme sans argument de setAsDefaultProtocolClient
  // peut se révéler silencieusement inefficace en build empaqueté (aucune
  // classe HKCU écrite — le callback OAuth part alors vers n'importe quel
  // gestionnaire obsolète restant, fenêtre blanche). On vérifie et, si
  // besoin, on écrit la classe exactement comme l'installeur NSIS l'aurait
  // fait.
  if (process.platform === 'win32' && !app.isDefaultProtocolClient(PROTOCOL, process.execPath, [])) {
    try {
      const root = `HKCU\\Software\\Classes\\${PROTOCOL}`;
      const regAdd = (value: string, args: string[]) =>
        spawnSync('reg', ['add', value, ...args, '/f'], {
          shell: false,
          stdio: 'ignore',
          windowsHide: true,
        });
      regAdd(root, ['/ve', '/t', 'REG_SZ', '/d', 'URL:123Ecriture Auth Callback']);
      regAdd(root, ['/v', 'URL Protocol', '/t', 'REG_SZ', '/d', '']);
      regAdd(`${root}\\shell\\open\\command`, ['/ve', '/t', 'REG_SZ', '/d', `"${process.execPath}" "%1"`]);
      app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, []);
      if (!app.isDefaultProtocolClient(PROTOCOL, process.execPath, [])) {
        console.error('[auth] enregistrement du protocole app123ecriture:// toujours absent après repli reg.');
      }
    } catch (error) {
      console.error('[auth] échec du repli d’enregistrement du protocole :', error);
    }
  }
}

//////// 2. La livraison du callback OAuth au renderer /////////////////////

// Windows/Linux : le protocole personnalisé relance l'app (captée par le
// verrou mono-instance dans main.js) avec l'URL quelque part dans argv.
export function findProtocolUrlInArgv(argv: string[]): string | null {
  return argv.find((arg) => arg.startsWith(`${PROTOCOL}://`)) ?? null;
}

export function registerAuthHandlers(getWindow: GetWindow): void {
  ipcMain.handle('auth:open-external', async (_event, url: unknown) => {
    if (typeof url !== 'string' || !url.startsWith('https://')) {
      throw new Error('URL de connexion invalide.');
    }
    await shell.openExternal(url);
  });

  // Démarrage À FROID par le lien : si l'app est fermée au moment où le
  // navigateur revient vers app123ecriture://auth-callback?code=...,
  // Windows lance CETTE instance avec l'URL dans argv — les événements
  // 'second-instance'/'open-url' ne couvrent que l'app DÉJÀ ouverte. Sans
  // cette capture, le callback est perdu silencieusement (connexion
  // impossible tant que l'app n'est pas déjà ouverte avant le clic). Le
  // renderer la récupère au montage via 'auth:take-pending-url' (une seule
  // fois — le pull évite la course d'un push envoyé avant que l'écouteur
  // React ne soit posé).
  let pendingStartupUrl: string | null = findProtocolUrlInArgv(process.argv);
  ipcMain.handle('auth:take-pending-url', () => {
    const url = pendingStartupUrl;
    pendingStartupUrl = null;
    return url;
  });

  const deliverCallback = (url: string) => {
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
