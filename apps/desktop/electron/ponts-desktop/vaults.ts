//////////////////////////////////////////////////////////////////////////////
//                                 vaults.ts                                //  
//////////////////////////////////////////////////////////////////////////////
// Registre PROCESS MAIN des coffres (vaults) locaux : liste persistée dans
// config.json sous la forme `{ vaults: [...], activeVaultId }`, coffre
// actif, identité par coffre, bascule, renommage, liaison cloud, santé des
// emplacements. Les autres modules du process main (vault.ts, sync.ts) ne
// connaissent qu'un seul point d'entrée : getActiveVaultPath(). Voir
// docs/ARCHITECTURE.md §5/§6.
//
// Invariants du fichier :
//   • L'identité d'un coffre (id stable + nom) vit DANS son dossier
//     (.123ecriture/vault.json), pas seulement dans config.json : c'est ce
//     qui permet de reconnaître un coffre déjà connu (retiré de la liste
//     puis re-sélectionné, déplacé, resynchronisé depuis une autre machine)
//     et de le faire correspondre à sa ligne cloud sans dupliquer le
//     coffre.
//   • La migration de l'ancien format (`vaultPath` seul) est paresseuse et
//     idempotente, appelée au début de chaque accesseur — jamais séquencée
//     au démarrage, donc aucun ordre à respecter.
//   • Retirer un coffre de la liste ne supprime jamais ses fichiers —
//     jamais de perte de données déclenchée par l'app ; clearVaultContent
//     n'efface que le contenu visible (les entrées cachées survivent) et
//     n'efface RIEN côté cloud.
//   • Pendant un cycle de synchro, la bascule est refusée (verrou
//     anti-bascule) : le bucket distant est figé au démarrage du cycle
//     alors que chaque opération locale relit le coffre ACTIF — une
//     bascule en cours de cycle empaire les fichiers locaux du nouveau
//     coffre avec le bucket de l'ancien.
//   • relocateVault valide l'identité : le dossier choisi doit être vide
//     d'identité ou porter CELLE du coffre — jamais celle d'un autre.
//
// SOMMAIRE :
//   1. Identité des coffres (.123ecriture/vault.json)
//   2. Registre : migration, lecture, coffre actif
//   3. Ajout et création de coffres
//   4. Verrou de synchro et bascule
//   5. Renommer, retirer, liaison cloud
//   6. Appareil et sélecteurs natifs
//   7. Maintenance des emplacements (déconnexion, santé, relocation)
//   8. Handlers IPC
//
//////////////////////////////////////////////////////////////////////////////

import {
  addExistingVault,
  createVault,
  migrateLegacyConfig,
  findVaultOrThrow,
  saveVaults,
  getVaults,
  getActiveVaultId,
  readVaultIdentity,
  writeVaultIdentity,
} from './coffre-registre';
export { getActiveVaultPath } from './coffre-registre';
import { dialog, ipcMain, type BrowserWindow } from 'electron';
import crypto from 'crypto';
import fs from 'fs/promises';
import fsSync from 'fs';
import os from 'os';
import path from 'path';

import { readConfig, writeConfig } from '../config';
import type { DeviceInfo, VaultRegistryEntry } from '../types';

type GetWindow = () => BrowserWindow | null;
//////// 4. Verrou de synchro et bascule ///////////////////////////////////

// Verrou ANTI-BASCULE : pendant un cycle de synchro, le bucket distant est
// figé au démarrage mais chaque opération locale relit le coffre ACTIF —
// une bascule en cours de cycle empairerait donc les fichiers locaux du
// nouveau coffre avec le bucket de l'ancien, c'est pourquoi switchVault la
// refuse. TTL 10 min : un renderer qui planterait en plein cycle (verrou
// jamais relâché) ne bloque pas l'app pour toujours.
let syncLockUntil = 0;
const SYNC_LOCK_TTL_MS = 10 * 60 * 1000;

export function setSyncLock(active: boolean): void {
  syncLockUntil = active ? Date.now() + SYNC_LOCK_TTL_MS : 0;
}

export function isSyncLocked(): boolean {
  return Date.now() < syncLockUntil;
}

export function switchVault(id: string): VaultRegistryEntry[] {
  if (isSyncLocked()) {
    throw new Error(
      'Impossible de changer de coffre pendant une synchronisation — réessaie dans un instant (quelques secondes).',
    );
  }
  const config = migrateLegacyConfig();
  const vaultList = config.vaults ?? [];
  findVaultOrThrow(vaultList, id);
  saveVaults(vaultList, id);
  return getVaults();
}

//////// 5. Renommer, retirer, liaison cloud ///////////////////////////////

export function renameVault(id: string, name: string): VaultRegistryEntry {
  const config = migrateLegacyConfig();
  const vaultList = config.vaults ?? [];
  const vault = findVaultOrThrow(vaultList, id);
  const trimmed = (name ?? '').trim();
  if (!trimmed) throw new Error('Le nom ne peut pas être vide.');
  vault.name = trimmed;
  try {
    const identity = readVaultIdentity(vault.path) ?? { id: vault.id, name: trimmed, createdAt: new Date().toISOString() };
    writeVaultIdentity(vault.path, { ...identity, name: trimmed });
  } catch {
    // Dossier temporairement inaccessible : le nom reste correct côté
    // registre, juste pas répercuté sur disque pour l'instant.
  }
  saveVaults(vaultList, config.activeVaultId ?? null);
  return vault;
}

// Retire un vault DE LA LISTE uniquement — ne supprime jamais ses fichiers
// (jamais de perte de données déclenchée par l'app).
export function removeVault(id: string): VaultRegistryEntry[] {
  const config = migrateLegacyConfig();
  const vaultList = (config.vaults ?? []).filter((v) => v.id !== id);
  const activeVaultId = config.activeVaultId === id ? (vaultList[0]?.id ?? null) : (config.activeVaultId ?? null);
  saveVaults(vaultList, activeVaultId);
  return getVaults();
}

export interface CloudLinkPatch {
  linked: boolean;
  remoteVaultId?: string | null;
}

export function setCloudLink(id: string, { linked, remoteVaultId }: CloudLinkPatch): VaultRegistryEntry {
  const config = migrateLegacyConfig();
  const vaultList = config.vaults ?? [];
  const vault = findVaultOrThrow(vaultList, id);
  vault.cloudLinked = Boolean(linked);
  if (remoteVaultId !== undefined) vault.remoteVaultId = remoteVaultId;
  saveVaults(vaultList, config.activeVaultId ?? null);
  return vault;
}

//////// 6. Appareil et sélecteurs natifs //////////////////////////////////

// Identité de CET appareil pour le suivi « appareils connectés » d'un coffre
// distant : id générée une seule fois puis persistée dans config.json (elle
// survit aux redémarrages et aux mises à jour de l'app), nom = nom de la
// machine tel que rapporté par Windows. Chaque synchro « heartbeat » une
// ligne vault_devices côté Supabase avec cette identité (syncEngine.ts).
export function getOrCreateDeviceInfo(): DeviceInfo {
  const config = readConfig();
  if (config.deviceId) return { id: config.deviceId, name: os.hostname() };
  const id = crypto.randomUUID();
  writeConfig({ ...config, deviceId: id });
  return { id, name: os.hostname() };
}

// Ouvre le sélecteur de dossier natif puis ajoute+active le dossier choisi.
// Retourne null si l'utilisateur annule — partagé par `vaults:add-existing`
// et par `vault:choose-folder` (voir vault.ts) pour ne pas dupliquer
// la logique de dialog. `title` optionnel : contexte de l'appel (ex. « Où
// placer les fichiers de « X » ? » lors de la connexion d'un coffre distant)
// — affiché par le sélecteur là où l'OS le permet.
export async function pickAndAddExistingVault(title?: string): Promise<VaultRegistryEntry | null> {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory', 'createDirectory'],
    ...(title ? { title, message: title } : {}),
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const vault = addExistingVault(result.filePaths[0]);
  switchVault(vault.id);
  return vault;
}

// Ouvre le sélecteur natif pour choisir OÙ créer le nouveau coffre, puis
// crée+active un sous-dossier `name` à cet endroit. `title` optionnel :
// contexte de l'appel (ex. « Où placer les fichiers de « X » ? » lors de la
// connexion d'un coffre distant). `vaultName` : nom affiché ≠ dossier (voir
// createVault).
export async function pickAndCreateVault(
  name: string,
  title?: string,
  vaultName?: string,
): Promise<VaultRegistryEntry | null> {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory', 'createDirectory'],
    ...(title ? { title, message: title } : {}),
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const vault = createVault(result.filePaths[0], name, vaultName);
  switchVault(vault.id);
  return vault;
}

//////// 7. Maintenance des emplacements (déconnexion, santé, relocation) //

// Vide le CONTENU visible d'un coffre (déconnexion d'un coffre distant :
// son contenu disparaît du dossier où on l'avait placé — action
// destructive, toujours précédée d'une confirmation côté UI). Ne touche PAS
// aux entrées commençant par un point : .123ecriture (identité du coffre +
// ordre/état) et .obsidian (réglages Obsidian du dossier) survivent — le
// dossier redevient un conteneur vide propre, réutilisable tel quel.
// N'efface RIEN côté cloud : le coffre distant et ses fichiers restent
// intacts (c'est le sens d'une « déconnexion »).
export async function clearVaultContent(id: string): Promise<void> {
  const config = migrateLegacyConfig();
  const vault = findVaultOrThrow(config.vaults ?? [], id);
  const entries = await fs.readdir(vault.path, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    await fs.rm(path.join(vault.path, entry.name), { recursive: true, force: true });
  }
}

// Santé de l'emplacement de chaque coffre : « missing » = le dossier
// enregistré n'existe plus (déplacé, renommé, lecteur débranché) ;
// « no-identity » = le dossier existe mais ne contient plus
// .123ecriture/vault.json — signature d'un coffre DÉPLACÉ en laissant un
// dossier derrière lui. Sans ce contrôle, la synchro verserait tout le
// coffre distant dans ce dossier témoin (résurrection de l'ancien
// emplacement).
export function checkVaultFolders(): Record<string, 'ok' | 'missing' | 'no-identity'> {
  const result: Record<string, 'ok' | 'missing' | 'no-identity'> = {};
  for (const vault of getVaults()) {
    if (!fsSync.existsSync(vault.path)) {
      result[vault.id] = 'missing';
      continue;
    }
    result[vault.id] = readVaultIdentity(vault.path) ? 'ok' : 'no-identity';
  }
  return result;
}

// Retrouve un coffre déplacé : sélecteur natif, VALIDATION d'identité (le
// dossier choisi doit être vide d'identité ou porter CELLE du coffre —
// jamais celle d'un autre), écrit l'identité si absente (l'utilisatrice
// vient de désigner ce dossier comme étant le coffre), met à jour le chemin
// du registre. Retourne null si le sélecteur est annulé.
export async function relocateVault(id: string): Promise<VaultRegistryEntry[] | null> {
  const config = migrateLegacyConfig();
  const vaultList = config.vaults ?? [];
  const vault = findVaultOrThrow(vaultList, id);
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory', 'createDirectory'],
    title: `Où se trouve désormais le coffre « ${vault.name} » ?`,
    message: `Où se trouve désormais le coffre « ${vault.name} » ?`,
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const chosen = result.filePaths[0];

  const existingIdentity = readVaultIdentity(chosen);
  if (existingIdentity && existingIdentity.id !== vault.id) {
    throw new Error('Ce dossier appartient déjà à un autre coffre — choisissez le dossier déplacé de « ' + vault.name + ' ».');
  }
  if (!existingIdentity) {
    const identity = readVaultIdentity(vault.path) ?? {
      id: vault.id,
      name: vault.name,
      createdAt: new Date().toISOString(),
    };
    writeVaultIdentity(chosen, identity);
  }
  vault.path = chosen;
  saveVaults(vaultList, config.activeVaultId ?? null);
  return getVaults();
}

//////// 8. Handlers IPC ///////////////////////////////////////////////////

// Les opérations qui modifient la liste diffusent `vaults:changed` au
// renderer pour que tous les écrans se ressynchronisent.
export function broadcastVaultsChanged(getWindow: GetWindow): void {
  const win = getWindow?.();
  if (win) win.webContents.send('vaults:changed', getVaults());
}

export function registerVaultsHandlers(getWindow: GetWindow): void {
  ipcMain.handle('vaults:list', () => getVaults());
  ipcMain.handle('vaults:get-active', () => getActiveVaultId());
  ipcMain.handle('vaults:device-info', () => getOrCreateDeviceInfo());

  ipcMain.handle('vaults:add-existing', async (_event, title?: string) => {
    const vault = await pickAndAddExistingVault(title);
    if (vault) broadcastVaultsChanged(getWindow);
    return getVaults();
  });

  ipcMain.handle('vaults:create-new', async (_event, name: string, title?: string, vaultName?: string) => {
    const vault = await pickAndCreateVault(name, title, vaultName);
    if (vault) broadcastVaultsChanged(getWindow);
    return getVaults();
  });

  ipcMain.handle('vaults:switch', (_event, id: string) => {
    const vaultList = switchVault(id);
    broadcastVaultsChanged(getWindow);
    return vaultList;
  });

  ipcMain.handle('vaults:rename', (_event, id: string, name: string) => {
    renameVault(id, name);
    const vaultList = getVaults();
    broadcastVaultsChanged(getWindow);
    return vaultList;
  });

  ipcMain.handle('vaults:remove', (_event, id: string) => {
    const vaultList = removeVault(id);
    broadcastVaultsChanged(getWindow);
    return vaultList;
  });

  ipcMain.handle('vaults:set-cloud-link', (_event, id: string, payload: CloudLinkPatch) => {
    setCloudLink(id, payload ?? { linked: false });
    const vaultList = getVaults();
    broadcastVaultsChanged(getWindow);
    return vaultList;
  });

  ipcMain.handle('vaults:clear-content', (_event, id: string) => clearVaultContent(id));

  ipcMain.handle('vaults:check-folders', () => checkVaultFolders());

  ipcMain.handle('vaults:relocate', async (_event, id: string) => {
    const vaultList = await relocateVault(id);
    if (vaultList) broadcastVaultsChanged(getWindow);
    return vaultList;
  });
}
