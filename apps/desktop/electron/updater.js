const { app, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');

// Phase 1 : traqueur de mise à jour piloté depuis l'UI (écran Paramètres),
// plutôt que la notification OS silencieuse utilisée jusqu'ici. Le
// téléchargement reste automatique dès qu'une mise à jour est détectée
// (autoDownload) ; seule l'installation (qui redémarre l'app) attend une
// action explicite de l'utilisateur·rice via le bouton "Redémarrer et
// installer" — voir apps/mobile/components/SettingsScreen.tsx.
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

function broadcastStatus(getWindow, status) {
  const win = getWindow();
  if (win && !win.isDestroyed()) {
    win.webContents.send('updater:status', status);
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

  ipcMain.handle('updater:check', async () => {
    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      // Pas de réseau, dépôt encore privé... jamais fatal, juste remonté à
      // l'UI via le statut 'error' (déjà géré par le listener 'error'
      // ci-dessus dans la plupart des cas, mais checkForUpdates peut aussi
      // rejeter directement selon la nature de l'échec).
      broadcastStatus(getWindow, { state: 'error', message: String(error) });
    }
  });

  ipcMain.handle('updater:quit-and-install', () => {
    autoUpdater.quitAndInstall();
  });
}

module.exports = { registerUpdaterHandlers };
