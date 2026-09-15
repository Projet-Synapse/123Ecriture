// //1. 🌉 INSTALLATION DES PONTS WEB — l'équivalent navigateur du preload
// ////////////////////////////////////////////////////////////////////////
//
// Pose window.vault/vaults/preferences/tasks/taskLists/calendar/properties/
// occurrences/search/sync/auth sur des implémentations File System Access
// API (voir webVaultAdapter/webModulesAdapter/webSearchAdapter/webAppAdapter)
// AVANT le premier rendu React — même contrat de timing que
// installNativeBridges (appelée depuis index.ts) : les contextes lisent
// `window.<domain>` de façon synchrone au montage, l'objet doit exister
// tout de suite (l'état IndexedDB se charge ensuite de façon asynchrone,
// chaque méthode du registre attendant whenReady()).
//
// Ne pose RIEN si :
// - un pont Electron existe déjà (le renderer d'apps/desktop exécute ce
//   même bundle web — le preload a déjà tout câblé via IPC) ;
// - le navigateur ne supporte pas la File System Access API (Firefox,
//   Safari) : les écrans gardent alors leur message « disponible sur
//   desktop pour l'instant » existant, comme aujourd'hui.
//
// updater/contextMenu restent volontairement sans équivalent web (mise à
// jour auto et menu natif n'ont pas de sens en navigateur) — les
// consommateurs dégradent déjà proprement en leur absence.

import { Platform } from 'react-native';

import { webOccurrencesAdapter, webPropertiesAdapter, webTasksAdapter, webTaskListsAdapter, webCalendarAdapter } from './webModulesAdapter';
import { webSearchAdapter, webSyncAdapter } from './webSearchAdapter';
import { webAuthAdapter, webPreferencesAdapter } from './webAppAdapter';
import { webVaultAdapter } from './webVaultAdapter';
import { webVaultRegistry } from './webVaultRegistry';

export function installWebBridges(): void {
  if (Platform.OS !== 'web') return;
  if (typeof window === 'undefined') return;
  // Renderer Electron : le preload expose déjà tout le câblage IPC.
  if (window.vault || window.vaults) return;
  // File System Access API requise (Chrome/Edge/Chromium récents) — une
  // constante locale pour que le narrowing survive aux fermetures ci-dessous.
  const showDirectoryPicker = window.showDirectoryPicker;
  if (typeof showDirectoryPicker !== 'function') return;

  window.vault = webVaultAdapter;

  // Le registre web + les deux points d'entrée à sélecteur natif du
  // navigateur (équivalents des dialogs Electron vaults:add-existing et
  // vaults:create-new) — retour null si l'utilisatrice annule, jamais de
  // coffre fantôme.
  window.vaults = {
    list: () => webVaultRegistry.whenReady().then(() => webVaultRegistry.toEntries()),
    getActive: () => webVaultRegistry.getActiveId(),
    addExisting: async () => {
      const handle = await showDirectoryPicker({ mode: 'readwrite' });
      await webVaultRegistry.addExisting(handle);
      return webVaultRegistry.toEntries();
    },
    createNew: async (name: string) => {
      const parent = await showDirectoryPicker({ mode: 'readwrite' });
      await webVaultRegistry.createNew(parent, name);
      return webVaultRegistry.toEntries();
    },
    switch: (id: string) =>
      webVaultRegistry
        .activate(id)
        .then(() => webVaultRegistry.toEntries()),
    rename: (id: string, name: string) => webVaultRegistry.rename(id, name),
    remove: (id: string) => webVaultRegistry.remove(id),
    setCloudLink: (id: string, payload) => webVaultRegistry.setCloudLink(id, payload),
    onChanged: (callback) => webVaultRegistry.onChanged(callback),
  } satisfies VaultsBridge;

  window.preferences = webPreferencesAdapter;
  window.tasks = webTasksAdapter;
  window.taskLists = webTaskListsAdapter;
  window.calendar = webCalendarAdapter;
  window.properties = webPropertiesAdapter;
  window.occurrences = webOccurrencesAdapter;
  window.search = webSearchAdapter;
  window.sync = webSyncAdapter;
  window.auth = webAuthAdapter;

  // Lance le chargement IndexedDB maintenant (chaque méthode y attend de
  // toute façon whenReady(), le lancer tôt épargne un aller-retour au
  // premier appel).
  void webVaultRegistry.whenReady();
}
