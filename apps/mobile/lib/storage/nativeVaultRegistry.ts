import * as FileSystem from 'expo-file-system/legacy';

// Registre des coffres sur Android natif — équivalent du config.json
// app-level d'Electron (`vaults: VaultRegistryEntry[]` + `activeVaultId`,
// voir apps/desktop/electron/vaults.ts) mais stocké dans le stockage privé
// de l'app (documentDirectory), PAS dans le dossier du coffre lui-même :
// contrairement à Electron où c'est un chemin fs classique, un "coffre" ici
// est une autorisation SAF (Storage Access Framework) sur un dossier
// externe — `path` porte l'URI SAF racine (content://...), pas un vrai
// chemin de fichier. Ce registre est ce qui permet de retrouver/re-choisir
// entre plusieurs coffres déjà autorisés sans redemander la permission SAF
// à chaque fois (l'autorisation elle-même persiste côté OS Android une fois
// accordée par `requestDirectoryPermissionsAsync`).
//
// //1. 📄 Lecture/écriture du fichier registre
// //2. 🔔 Écouteurs de changement (miroir de VaultsBridge.onChanged)

const REGISTRY_PATH = `${FileSystem.documentDirectory}123ecriture-vaults.json`;

type Registry = {
  vaults: VaultRegistryEntry[];
  activeVaultId: string | null;
};

const EMPTY_REGISTRY: Registry = { vaults: [], activeVaultId: null };

// //1. 📄 LECTURE/ÉCRITURE DU FICHIER REGISTRE
// ////////////////////////////////////////////////////////////////////////

export async function readRegistry(): Promise<Registry> {
  try {
    const info = await FileSystem.getInfoAsync(REGISTRY_PATH);
    if (!info.exists) return EMPTY_REGISTRY;
    const raw = await FileSystem.readAsStringAsync(REGISTRY_PATH);
    const parsed = JSON.parse(raw) as Partial<Registry>;
    return { vaults: parsed.vaults ?? [], activeVaultId: parsed.activeVaultId ?? null };
  } catch (error) {
    // Tolérant, comme lib/frontmatter.ts : un registre absent/corrompu ne
    // doit jamais empêcher l'app de démarrer, juste repartir à vide.
    console.error('[nativeVaultRegistry] lecture échouée, redémarrage à vide :', error);
    return EMPTY_REGISTRY;
  }
}

async function writeRegistry(registry: Registry): Promise<void> {
  await FileSystem.writeAsStringAsync(REGISTRY_PATH, JSON.stringify(registry, null, 2));
  notifyListeners(registry.vaults);
}

// //2. 🔔 ÉCOUTEURS DE CHANGEMENT
// ////////////////////////////////////////////////////////////////////////

const listeners = new Set<(vaults: VaultRegistryEntry[]) => void>();

function notifyListeners(vaults: VaultRegistryEntry[]): void {
  for (const listener of listeners) listener(vaults);
}

export function onRegistryChanged(callback: (vaults: VaultRegistryEntry[]) => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

export async function getActiveVaultEntry(): Promise<VaultRegistryEntry | null> {
  const { vaults, activeVaultId } = await readRegistry();
  return vaults.find((v) => v.id === activeVaultId) ?? null;
}

export async function addVault(entry: VaultRegistryEntry, makeActive: boolean): Promise<VaultRegistryEntry[]> {
  const registry = await readRegistry();
  registry.vaults.push(entry);
  if (makeActive || !registry.activeVaultId) registry.activeVaultId = entry.id;
  await writeRegistry(registry);
  return registry.vaults;
}

export async function switchActiveVault(id: string): Promise<VaultRegistryEntry[]> {
  const registry = await readRegistry();
  if (registry.vaults.some((v) => v.id === id)) registry.activeVaultId = id;
  await writeRegistry(registry);
  return registry.vaults;
}

export async function renameVaultEntry(id: string, name: string): Promise<VaultRegistryEntry[]> {
  const registry = await readRegistry();
  const entry = registry.vaults.find((v) => v.id === id);
  if (entry) entry.name = name;
  await writeRegistry(registry);
  return registry.vaults;
}

export async function removeVaultEntry(id: string): Promise<VaultRegistryEntry[]> {
  const registry = await readRegistry();
  registry.vaults = registry.vaults.filter((v) => v.id !== id);
  if (registry.activeVaultId === id) {
    registry.activeVaultId = registry.vaults[0]?.id ?? null;
  }
  await writeRegistry(registry);
  return registry.vaults;
}

export async function setVaultCloudLink(
  id: string,
  payload: { linked: boolean; remoteVaultId?: string | null },
): Promise<VaultRegistryEntry[]> {
  const registry = await readRegistry();
  const entry = registry.vaults.find((v) => v.id === id);
  if (entry) {
    entry.cloudLinked = payload.linked;
    entry.remoteVaultId = payload.remoteVaultId ?? null;
  }
  await writeRegistry(registry);
  return registry.vaults;
}
