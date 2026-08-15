const { app, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');

// Traqueur de mise à jour piloté depuis l'UI (écran Paramètres), plutôt que
// la notification OS silencieuse utilisée jusque-là. Le téléchargement
// reste automatique dès qu'une mise à jour est détectée (autoDownload) ;
// seule l'installation (qui redémarre l'app) attend une action explicite
// via "Redémarrer et installer" — voir SettingsScreen.tsx.
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;
// Diagnostic : sans logger, electron-updater ne journalise quasiment rien.
// console suffit comme logger (il expose bien info/warn/error/debug) —
// visible dans la console de l'app en dev, et dans les logs du processus en
// prod. Pas de nouvelle dépendance (electron-log) pour ça.
autoUpdater.logger = console;

// Source de vérité de l'état courant, en plus de la diffusion événementielle
// (broadcastStatus). Corrige une vraie source d'instabilité perçue : la
// vérification de mise à jour démarre au lancement de l'app, potentiellement
// AVANT que l'écran Paramètres ne soit monté et abonné aux événements — ces
// tout premiers événements (checking/downloading...) partaient alors dans le
// vide, et l'UI affichait un état par défaut périmé tant qu'aucun nouvel
// événement n'arrivait. `updater:get-status` permet à l'UI de récupérer
// l'état réel dès son montage, sans dépendre d'avoir "entendu" l'événement
// au bon moment.
let currentStatus = { state: 'idle' };

// Empêche deux vérifications de se chevaucher (ex. clic sur "Vérifier" alors
// que la vérification au démarrage tourne encore) — les appels concurrents à
// checkForUpdates() peuvent produire des séquences d'événements qui se
// marchent dessus.
let checkInProgress = false;

function broadcastStatus(getWindow, status) {
  currentStatus = status;
  const win = getWindow();
  if (win && !win.isDestroyed()) {
    win.webContents.send('updater:status', status);
  }
}

async function performCheck(getWindow) {
  if (checkInProgress) return;
  checkInProgress = true;
  try {
    await autoUpdater.checkForUpdates();
  } catch (error) {
    // Pas de réseau, dépôt encore privé... jamais fatal : juste remonté à
    // l'UI. (Le listener 'error' ci-dessous couvre déjà la plupart des
    // échecs, mais checkForUpdates() peut aussi rejeter directement selon
    // la nature de l'erreur.)
    broadcastStatus(getWindow, { state: 'error', message: String(error) });
  } finally {
    checkInProgress = false;
  }
}

function registerUpdaterHandlers(getWindow) {
  autoUpdater.on('checking-for-update', () => {
    broadcastStatus(getWindow, { state: 'checking' });
  });
  autoUpdater.on('update-available', (info) => {
    broadcastStatus(getWindow, { state: 'downloading', version: info.version, percent: 0 });
  });
  autoUpdater.on('update-not-available', () => {
    broadcastStatus(getWindow, { state: 'up-to-date' });
  });
  autoUpdater.on('download-progress', (progress) => {
    broadcastStatus(getWindow, { state: 'downloading', percent: Math.round(progress.percent) });
  });
  autoUpdater.on('update-downloaded', (info) => {
    broadcastStatus(getWindow, { state: 'ready', version: info.version });
  });
  autoUpdater.on('error', (error) => {
    broadcastStatus(getWindow, { state: 'error', message: String(error) });
  });

  ipcMain.handle('updater:get-version', () => app.getVersion());
  ipcMain.handle('updater:get-status', () => currentStatus);
  ipcMain.handle('updater:check', () => performCheck(getWindow));

  ipcMain.handle('updater:quit-and-install', () => {
    try {
      // isSilent=false (Windows : montre la progression de l'installateur),
      // isForceRunAfter=true (relance l'app après installation sur les 3
      // plateformes — sans ça, seul Windows la relance par défaut selon la
      // config NSIS, pas Linux/macOS de façon fiable). C'est la confirmation
      // visible que la mise à jour a réussi.
      autoUpdater.quitAndInstall(false, true);
    } catch (error) {
      broadcastStatus(getWindow, { state: 'error', message: String(error) });
    }
  });
}

function checkOnStartup(getWindow) {
  void performCheck(getWindow);
}

module.exports = { registerUpdaterHandlers, checkOnStartup };
