// ✒️ 123ECRITURE — synchronisation vault/coffre-registre.ts — l'identité et le registre des coffres
//////////////////////////////////////////////////////////////////////////////
//
// L'identité d'un coffre (.123ecriture/vault.json) et le REGISTRE global
// (config.json : la liste des coffres + le coffre actif). Ajout et création
// d'entrées. vaults.ts (verrous, bascule, maintenance, handlers) importe ce
// registre — jamais l'inverse.
//
// Invariants du fichier :
//   • Un coffre local porte SON identité dans le dossier (.123ecriture/
//     vault.json) : le registre ne déclare pas, il RELIE.
//   • Le registre est tolérant aux pannes : un fichier absent/corrompu
//     repart à vide plutôt que de bloquer l'app.
//
// SOMMAIRE :
//   1. L'identité des coffres
//   2. Le registre et le coffre actif
//   3. L'ajout et la création
//
//////////////////////////////////////////////////////////////////////////////

import fsSync from 'fs';
import path from 'path';
import { readConfig, writeConfig } from '../config';
import type { AppConfig, VaultIdentity, VaultRegistryEntry } from '../types';


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
export function readVaultIdentity(vaultPath: string): VaultIdentity | null {
  try {
    return JSON.parse(fsSync.readFileSync(getIdentityFilePath(vaultPath), 'utf8')) as VaultIdentity;
  } catch {
    return null;
  }
}

export function writeVaultIdentity(vaultPath: string, identity: VaultIdentity): void {
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
export function migrateLegacyConfig(): AppConfig {
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

export function saveVaults(vaultList: VaultRegistryEntry[], activeVaultId: string | null): AppConfig {
  return writeConfig({ vaults: vaultList, activeVaultId });
}

export function findVaultOrThrow(vaultList: VaultRegistryEntry[], id: string): VaultRegistryEntry {
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

