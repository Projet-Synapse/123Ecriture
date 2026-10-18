import { dialog, ipcMain, type BrowserWindow } from 'electron';
import crypto from 'crypto';
import fs from 'fs/promises';
import fsSync from 'fs';
import os from 'os';
import path from 'path';

import { readConfig, writeConfig } from '../config';
import type { AppConfig, DeviceInfo, VaultIdentity, VaultRegistryEntry } from '../types';

type GetWindow = () => BrowserWindow | null;

// ✒️ 123ECRITURE — synchronisation vault/vaults.ts — registre des coffres locaux (multi-coffres)
//////////////////////////////////////////////////////////////////////////////
//
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

//////// 1. Identité des coffres (.123ecriture/vault.json) /////////////////

const IDENTITY_RELATIVE_PATH = path.join('.123ecriture', 'vault.json');

function getIdentityFilePath(vaultPath: string): string {
  return path.join(vaultPath, IDENTITY_RELATIVE_PATH);
}

// L'identité (id stable + nom) vit DANS le dossier du vault, pas seulement
// dans config.json : ça permet de reconnaître un vault déjà connu si on le
// re-sélectionne après l'avoir retiré de la liste, ou s'il a été déplacé/
// resynchronisé depuis une autre machine — indispensable pour, plus tard, le
// faire correspondre à sa ligne Supabase sans dupliquer le coffre côté cloud.
function readVaultIdentity(vaultPath: string): VaultIdentity | null {
  try {
    return JSON.parse(fsSync.readFileSync(getIdentityFilePath(vaultPath), 'utf8')) as VaultIdentity;
  } catch {
    return null;
  }
}

function writeVaultIdentity(vaultPath: string, identity: VaultIdentity): void {
  const filePath = getIdentityFilePath(vaultPath);
  fsSync.mkdirSync(path.dirname(filePath), { recursive: true });
  fsSync.writeFileSync(filePath, JSON.stringify(identity, null, 2), 'utf8');
}

//////// 2. Registre : migration, lecture, coffre actif ////////////////////

// Migration paresseuse et idempotente de l'ancien format (`vaultPath` seul)
// vers le nouveau (`vaults[]` + `activeVaultId`). Appelée au début de chaque
// accesseur plutôt que séquencée explicitement au démarrage : pas d'ordre à
// respecter, et un ancien config.json migre tout seul sans perdre le vault
// déjà choisi.
function migrateLegacyConfig(): AppConfig {
  const config = readConfig();
  if (config.vaults) return config;

  if (config.vaultPath) {
    let identity = readVaultIdentity(config.vaultPath);
    if (!identity) {
      identity = {
        id: crypto.randomUUID(),
        name: path.basename(config.vaultPath),
        createdAt: new Date().toISOString(),
      };
      try {
        writeVaultIdentity(config.vaultPath, identity);
      } catch {
        // Dossier peut-être temporairement inaccessible (lecteur externe
        // débranché...) — on migre quand même l'entrée logique, l'identité
        // sur disque sera réécrite au prochain accès réussi.
      }
    }
    const vault: VaultRegistryEntry = {
      id: identity.id,
      name: identity.name ?? path.basename(config.vaultPath),
      path: config.vaultPath,
      cloudLinked: false,
      remoteVaultId: null,
    };
    return writeConfig({ vaults: [vault], activeVaultId: vault.id });
  }

  return writeConfig({ vaults: [], activeVaultId: null });
}

export function getVaults(): VaultRegistryEntry[] {
  return migrateLegacyConfig().vaults ?? [];
}

export function getActiveVaultId(): string | null {
  return migrateLegacyConfig().activeVaultId ?? null;
}

export function getActiveVaultPath(): string | null {
  const activeId = getActiveVaultId();
  const active = getVaults().find((v) => v.id === activeId);
  return active ? active.path : null;
}

function saveVaults(vaultList: VaultRegistryEntry[], activeVaultId: string | null): AppConfig {
  return writeConfig({ vaults: vaultList, activeVaultId });
}

function findVaultOrThrow(vaultList: VaultRegistryEntry[], id: string): VaultRegistryEntry {
  const vault = vaultList.find((v) => v.id === id);
  if (!vault) throw new Error('Coffre introuvable.');
  return vault;
}

//////// 3. Ajout et création de coffres ///////////////////////////////////

// Enregistre `chosenPath` comme vault (réutilise son identité si elle
// existe déjà, ex. vault retiré de la liste puis re-ajouté) et le rend
// actif. Fonction pure vis-à-vis d'Electron (pas de dialog ici) — testable
// isolément et réutilisée par les deux points d'entrée IPC qui ajoutent un
// dossier existant (`vaults:add-existing` et `vault:choose-folder`, voir
// vault.ts).
export function addExistingVault(chosenPath: string): VaultRegistryEntry {
  const config = migrateLegacyConfig();
  const vaultList = config.vaults ?? [];

  let identity = readVaultIdentity(chosenPath);
  if (!identity) {
    identity = {
      id: crypto.randomUUID(),
      name: path.basename(chosenPath),
      createdAt: new Date().toISOString(),
    };
    writeVaultIdentity(chosenPath, identity);
  }

  const already = vaultList.find((v) => v.id === identity.id);
  if (already) {
    already.path = chosenPath;
    saveVaults(vaultList, already.id);
    return already;
  }

  const vault: VaultRegistryEntry = {
    id: identity.id,
    name: identity.name ?? path.basename(chosenPath),
    path: chosenPath,
    cloudLinked: false,
    remoteVaultId: null,
  };
  vaultList.push(vault);
  saveVaults(vaultList, vault.id);
  return vault;
}

// Crée un nouveau dossier `name` dans `parentDir`, l'initialise comme vault
// (identité + dossier .123ecriture/) et le rend actif. `vaultName` optionnel :
// nom affiché du coffre quand il doit DIFFÉRER du dossier — cas « Connecter
// sur cet appareil » : le dossier est dédoublonné (« X 2 » si « X » existe
// déjà) mais le coffre doit garder le nom ORIGINAL du coffre distant.
export function createVault(parentDir: string, name: string, vaultName?: string): VaultRegistryEntry {
  const safeName = name && name.trim().length > 0 ? name.trim() : 'Nouveau coffre';

  // Même logique de dédoublonnage que findAvailableName() dans vault.ts
  // (pas de dépendance croisée pour un si petit bout de code, mais même
  // convention " 2", " 3"...).
  let folderName = safeName;
  let counter = 2;
  while (fsSync.existsSync(path.join(parentDir, folderName))) {
    folderName = `${safeName} ${counter}`;
    counter += 1;
  }
  const fullPath = path.join(parentDir, folderName);
  fsSync.mkdirSync(fullPath, { recursive: true });

  const identity: VaultIdentity = {
    id: crypto.randomUUID(),
    name: vaultName && vaultName.trim().length > 0 ? vaultName.trim() : folderName,
    createdAt: new Date().toISOString(),
  };
  writeVaultIdentity(fullPath, identity);

  const config = migrateLegacyConfig();
  const vaultList = config.vaults ?? [];
  const vault: VaultRegistryEntry = {
    id: identity.id,
    name: identity.name ?? folderName,
    path: fullPath,
    cloudLinked: false,
    remoteVaultId: null,
  };
  vaultList.push(vault);
  saveVaults(vaultList, vault.id);
  return vault;
}

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
