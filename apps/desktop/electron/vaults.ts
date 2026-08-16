import { dialog, ipcMain, type BrowserWindow } from 'electron';
import crypto from 'crypto';
import fsSync from 'fs';
import path from 'path';

import { readConfig, writeConfig } from './config';
import type { AppConfig, VaultIdentity, VaultRegistryEntry } from './types';

type GetWindow = () => BrowserWindow | null;

// Registre des coffres (vaults) — voir docs/ARCHITECTURE.md §5/§6. Avant ce
// fichier, l'app ne connaissait qu'un seul `vaultPath` (string) dans
// config.json ; on passe à une vraie liste `{ vaults: [...], activeVaultId }`
// tout en gardant `vault.js`/`tasks.js` inchangés au-delà d'un seul point
// d'entrée (`getActiveVaultPath`) — voir leur `getVaultPath()` local.

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

// Migration paresseuse et idempotente de l'ancien format (`vaultPath` seul)
// vers le nouveau (`vaults[]` + `activeVaultId`). Appelée au début de chaque
// accesseur plutôt que séquencée explicitement au démarrage : pas d'ordre à
// respecter, et un ancien config.json (utilisateur déjà en prod) migre tout
// seul sans perdre le vault déjà choisi.
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

// Enregistre `chosenPath` comme vault (réutilise son identité si elle
// existe déjà, ex. vault retiré de la liste puis re-ajouté) et le rend
// actif. Fonction pure vis-à-vis d'Electron (pas de dialog ici) — testable
// isolément et réutilisée par les deux points d'entrée IPC qui ont besoin
// d'ajouter un dossier existant (`vaults:add-existing` et l'ancien
// `vault:choose-folder`, gardé pour compatibilité — voir vault.js).
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
// (identité + dossier .123ecriture/) et le rend actif.
export function createVault(parentDir: string, name: string): VaultRegistryEntry {
  const safeName = name && name.trim().length > 0 ? name.trim() : 'Nouveau coffre';

  // Même logique de dédoublonnage que findAvailableName() dans vault.js
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

  const identity: VaultIdentity = { id: crypto.randomUUID(), name: folderName, createdAt: new Date().toISOString() };
  writeVaultIdentity(fullPath, identity);

  const config = migrateLegacyConfig();
  const vaultList = config.vaults ?? [];
  const vault: VaultRegistryEntry = {
    id: identity.id,
    name: folderName,
    path: fullPath,
    cloudLinked: false,
    remoteVaultId: null,
  };
  vaultList.push(vault);
  saveVaults(vaultList, vault.id);
  return vault;
}

export function switchVault(id: string): VaultRegistryEntry[] {
  const config = migrateLegacyConfig();
  const vaultList = config.vaults ?? [];
  findVaultOrThrow(vaultList, id);
  saveVaults(vaultList, id);
  return getVaults();
}

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
// (règle CLAUDE.md : jamais de perte de données déclenchée par l'app).
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

// Ouvre le sélecteur de dossier natif puis ajoute+active le dossier choisi.
// Retourne null si l'utilisateur annule — partagé par `vaults:add-existing`
// et par l'ancien `vault:choose-folder` (voir vault.js) pour ne pas dupliquer
// la logique de dialog.
export async function pickAndAddExistingVault(): Promise<VaultRegistryEntry | null> {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
  if (result.canceled || result.filePaths.length === 0) return null;
  const vault = addExistingVault(result.filePaths[0]);
  switchVault(vault.id);
  return vault;
}

// Ouvre le sélecteur natif pour choisir OÙ créer le nouveau coffre, puis
// crée+active un sous-dossier `name` à cet endroit.
export async function pickAndCreateVault(name: string): Promise<VaultRegistryEntry | null> {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
  if (result.canceled || result.filePaths.length === 0) return null;
  const vault = createVault(result.filePaths[0], name);
  switchVault(vault.id);
  return vault;
}

export function broadcastVaultsChanged(getWindow: GetWindow): void {
  const win = getWindow?.();
  if (win) win.webContents.send('vaults:changed', getVaults());
}

export function registerVaultsHandlers(getWindow: GetWindow): void {
  ipcMain.handle('vaults:list', () => getVaults());
  ipcMain.handle('vaults:get-active', () => getActiveVaultId());

  ipcMain.handle('vaults:add-existing', async () => {
    const vault = await pickAndAddExistingVault();
    if (vault) broadcastVaultsChanged(getWindow);
    return getVaults();
  });

  ipcMain.handle('vaults:create-new', async (_event, name: string) => {
    const vault = await pickAndCreateVault(name);
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
}
