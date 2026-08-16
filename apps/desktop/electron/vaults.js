const { dialog, ipcMain } = require('electron');
const fsSync = require('fs');
const path = require('path');
const crypto = require('crypto');
const { readConfig, writeConfig } = require('./config');

// Registre des coffres (vaults) — voir docs/ARCHITECTURE.md §5/§6. Avant ce
// fichier, l'app ne connaissait qu'un seul `vaultPath` (string) dans
// config.json ; on passe à une vraie liste `{ vaults: [...], activeVaultId }`
// tout en gardant `vault.js`/`tasks.js` inchangés au-delà d'un seul point
// d'entrée (`getActiveVaultPath`) — voir leur `getVaultPath()` local.

const IDENTITY_RELATIVE_PATH = path.join('.123ecriture', 'vault.json');

function getIdentityFilePath(vaultPath) {
  return path.join(vaultPath, IDENTITY_RELATIVE_PATH);
}

// L'identité (id stable + nom) vit DANS le dossier du vault, pas seulement
// dans config.json : ça permet de reconnaître un vault déjà connu si on le
// re-sélectionne après l'avoir retiré de la liste, ou s'il a été déplacé/
// resynchronisé depuis une autre machine — indispensable pour, plus tard, le
// faire correspondre à sa ligne Supabase sans dupliquer le coffre côté cloud.
function readVaultIdentity(vaultPath) {
  try {
    return JSON.parse(fsSync.readFileSync(getIdentityFilePath(vaultPath), 'utf8'));
  } catch {
    return null;
  }
}

function writeVaultIdentity(vaultPath, identity) {
  const filePath = getIdentityFilePath(vaultPath);
  fsSync.mkdirSync(path.dirname(filePath), { recursive: true });
  fsSync.writeFileSync(filePath, JSON.stringify(identity, null, 2), 'utf8');
}

// Migration paresseuse et idempotente de l'ancien format (`vaultPath` seul)
// vers le nouveau (`vaults[]` + `activeVaultId`). Appelée au début de chaque
// accesseur plutôt que séquencée explicitement au démarrage : pas d'ordre à
// respecter, et un ancien config.json (utilisateur déjà en prod) migre tout
// seul sans perdre le vault déjà choisi.
function migrateLegacyConfig() {
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
    const vault = {
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

function getVaults() {
  return migrateLegacyConfig().vaults ?? [];
}

function getActiveVaultId() {
  return migrateLegacyConfig().activeVaultId ?? null;
}

function getActiveVaultPath() {
  const activeId = getActiveVaultId();
  const active = getVaults().find((v) => v.id === activeId);
  return active ? active.path : null;
}

function saveVaults(vaults, activeVaultId) {
  return writeConfig({ vaults, activeVaultId });
}

function findVaultOrThrow(vaults, id) {
  const vault = vaults.find((v) => v.id === id);
  if (!vault) throw new Error('Coffre introuvable.');
  return vault;
}

// Enregistre `chosenPath` comme vault (réutilise son identité si elle
// existe déjà, ex. vault retiré de la liste puis re-ajouté) et le rend
// actif. Fonction pure vis-à-vis d'Electron (pas de dialog ici) — testable
// isolément et réutilisée par les deux points d'entrée IPC qui ont besoin
// d'ajouter un dossier existant (`vaults:add-existing` et l'ancien
// `vault:choose-folder`, gardé pour compatibilité — voir vault.js).
function addExistingVault(chosenPath) {
  const config = migrateLegacyConfig();
  const vaults = config.vaults ?? [];

  let identity = readVaultIdentity(chosenPath);
  if (!identity) {
    identity = {
      id: crypto.randomUUID(),
      name: path.basename(chosenPath),
      createdAt: new Date().toISOString(),
    };
    writeVaultIdentity(chosenPath, identity);
  }

  const already = vaults.find((v) => v.id === identity.id);
  if (already) {
    already.path = chosenPath;
    saveVaults(vaults, already.id);
    return already;
  }

  const vault = {
    id: identity.id,
    name: identity.name ?? path.basename(chosenPath),
    path: chosenPath,
    cloudLinked: false,
    remoteVaultId: null,
  };
  vaults.push(vault);
  saveVaults(vaults, vault.id);
  return vault;
}

// Crée un nouveau dossier `name` dans `parentDir`, l'initialise comme vault
// (identité + dossier .123ecriture/) et le rend actif.
function createVault(parentDir, name) {
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

  const identity = { id: crypto.randomUUID(), name: folderName, createdAt: new Date().toISOString() };
  writeVaultIdentity(fullPath, identity);

  const config = migrateLegacyConfig();
  const vaults = config.vaults ?? [];
  const vault = {
    id: identity.id,
    name: folderName,
    path: fullPath,
    cloudLinked: false,
    remoteVaultId: null,
  };
  vaults.push(vault);
  saveVaults(vaults, vault.id);
  return vault;
}

function switchVault(id) {
  const config = migrateLegacyConfig();
  const vaults = config.vaults ?? [];
  findVaultOrThrow(vaults, id);
  saveVaults(vaults, id);
  return getVaults();
}

function renameVault(id, name) {
  const config = migrateLegacyConfig();
  const vaults = config.vaults ?? [];
  const vault = findVaultOrThrow(vaults, id);
  const trimmed = (name ?? '').trim();
  if (!trimmed) throw new Error('Le nom ne peut pas être vide.');
  vault.name = trimmed;
  try {
    const identity = readVaultIdentity(vault.path) ?? { id: vault.id, createdAt: new Date().toISOString() };
    writeVaultIdentity(vault.path, { ...identity, name: trimmed });
  } catch {
    // Dossier temporairement inaccessible : le nom reste correct côté
    // registre, juste pas répercuté sur disque pour l'instant.
  }
  saveVaults(vaults, config.activeVaultId);
  return vault;
}

// Retire un vault DE LA LISTE uniquement — ne supprime jamais ses fichiers
// (règle CLAUDE.md : jamais de perte de données déclenchée par l'app).
function removeVault(id) {
  const config = migrateLegacyConfig();
  const vaults = (config.vaults ?? []).filter((v) => v.id !== id);
  const activeVaultId = config.activeVaultId === id ? (vaults[0]?.id ?? null) : config.activeVaultId;
  saveVaults(vaults, activeVaultId);
  return getVaults();
}

function setCloudLink(id, { linked, remoteVaultId }) {
  const config = migrateLegacyConfig();
  const vaults = config.vaults ?? [];
  const vault = findVaultOrThrow(vaults, id);
  vault.cloudLinked = Boolean(linked);
  if (remoteVaultId !== undefined) vault.remoteVaultId = remoteVaultId;
  saveVaults(vaults, config.activeVaultId);
  return vault;
}

// Ouvre le sélecteur de dossier natif puis ajoute+active le dossier choisi.
// Retourne null si l'utilisateur annule — partagé par `vaults:add-existing`
// et par l'ancien `vault:choose-folder` (voir vault.js) pour ne pas dupliquer
// la logique de dialog.
async function pickAndAddExistingVault() {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
  if (result.canceled || result.filePaths.length === 0) return null;
  const vault = addExistingVault(result.filePaths[0]);
  switchVault(vault.id);
  return vault;
}

// Ouvre le sélecteur natif pour choisir OÙ créer le nouveau coffre, puis
// crée+active un sous-dossier `name` à cet endroit.
async function pickAndCreateVault(name) {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
  if (result.canceled || result.filePaths.length === 0) return null;
  const vault = createVault(result.filePaths[0], name);
  switchVault(vault.id);
  return vault;
}

function broadcastVaultsChanged(getWindow) {
  const win = getWindow?.();
  if (win) win.webContents.send('vaults:changed', getVaults());
}

function registerVaultsHandlers(getWindow) {
  ipcMain.handle('vaults:list', () => getVaults());
  ipcMain.handle('vaults:get-active', () => getActiveVaultId());

  ipcMain.handle('vaults:add-existing', async () => {
    const vault = await pickAndAddExistingVault();
    if (vault) broadcastVaultsChanged(getWindow);
    return getVaults();
  });

  ipcMain.handle('vaults:create-new', async (_event, name) => {
    const vault = await pickAndCreateVault(name);
    if (vault) broadcastVaultsChanged(getWindow);
    return getVaults();
  });

  ipcMain.handle('vaults:switch', (_event, id) => {
    const vaults = switchVault(id);
    broadcastVaultsChanged(getWindow);
    return vaults;
  });

  ipcMain.handle('vaults:rename', (_event, id, name) => {
    renameVault(id, name);
    const vaults = getVaults();
    broadcastVaultsChanged(getWindow);
    return vaults;
  });

  ipcMain.handle('vaults:remove', (_event, id) => {
    const vaults = removeVault(id);
    broadcastVaultsChanged(getWindow);
    return vaults;
  });

  ipcMain.handle('vaults:set-cloud-link', (_event, id, payload) => {
    setCloudLink(id, payload ?? {});
    const vaults = getVaults();
    broadcastVaultsChanged(getWindow);
    return vaults;
  });
}

module.exports = {
  migrateLegacyConfig,
  getVaults,
  getActiveVaultId,
  getActiveVaultPath,
  addExistingVault,
  createVault,
  switchVault,
  renameVault,
  removeVault,
  setCloudLink,
  pickAndAddExistingVault,
  pickAndCreateVault,
  broadcastVaultsChanged,
  registerVaultsHandlers,
};
