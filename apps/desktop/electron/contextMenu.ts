import { BrowserWindow, ipcMain, Menu } from 'electron';

import type { ContextMenuItem } from './types';

// Menu contextuel générique (clic droit) : le renderer fournit la liste des
// actions ({ id, label }) pertinentes pour l'endroit où il a cliqué (ex.
// "Nouvelle note"/"Nouveau dossier" dans la liste des notes), le process
// principal affiche un vrai menu natif au point de clic et renvoie l'id
// choisi (ou null si fermé sans choix). Volontairement générique — chaque
// écran décide de son propre contenu, ce fichier ne connaît aucune logique
// métier.
export function registerContextMenuHandlers(): void {
  ipcMain.handle('context-menu:show', (event, items: ContextMenuItem[]) => {
    return new Promise<string | null>((resolve) => {
      let resolved = false;
      // Le clic sur un item ET la fermeture du menu (callback de popup())
      // peuvent chacun tenter de résoudre — un seul doit compter.
      const resolveOnce = (value: string | null) => {
        if (resolved) return;
        resolved = true;
        resolve(value);
      };

      const template = items.map((item) => ({
        label: item.label,
        click: () => resolveOnce(item.id),
      }));
      const menu = Menu.buildFromTemplate(template);
      const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
      menu.popup({ window: win, callback: () => resolveOnce(null) });
    });
  });
}
