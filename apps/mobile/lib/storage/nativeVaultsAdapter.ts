//////////
// ✒️ 123ECRITURE — nativeVaultsAdapter.ts
// REGISTRE DES COFFRES (ANDROID) — chemins ordinaires, migration SAF,
// sélection, identité d'appareil (refonte v0.4.76)
//////////

// INTRODUCTION — Implémentation de VaultsBridge : le REGISTRE des coffres
// (stockage privé de l'app, voir nativeVaultRegistry.ts) et les opérations
// associées. Depuis la refonte du socle, le `path` d'un coffre est un CHEMIN
// ORDINAIRE (`/storage/emulated/0/…`) exploitant la permission « Accès à
// tous les fichiers » — plus aucune opération fichier ne passe par SAF.
// Les coffres enregistrés à l'époque SAF (URI `content://…`) sont migrés
// automatiquement au premier `list()` : l'identifiant document est décodé
// (`primary:✒️ 123Ecriture` → `/storage/emulated/0/✒️ 123Ecriture`), le
// contenu du dossier est intact (rien ne se déplace).
//
// SOMMAIRE :
//   1. 🔁 Migration des anciennes URI SAF → chemins ordinaires
//   2. 🗑️ Déconnexion — vider le CONTENU d'un coffre (clearVaultContent)
//   3. 📂 Sélection & enregistrement (sélecteur système ou dossier créé)
//   4. 🔌 Implémentation de VaultsBridge (l'objet exposé à l'app)
//   5. 🧭 Résolution du coffre actif (getActiveVaultRootUri)

import * as FileSystem from 'expo-file-system/legacy';
import { StorageAccessFramework } from 'expo-file-system/legacy';

import {
  addVault,
  getActiveVaultEntry,
  onRegistryChanged,
  readRegistry,
  removeVaultEntry,
  renameVaultEntry,
  saveRegistry,
  setVaultCloudLink,
  switchActiveVault,
} from './nativeVaultRegistry';

const PRIMARY_ROOT = '/storage/emulated/0';

function fileUri(plainPath: string): string {
  return plainPath.startsWith('file://') ? plainPath : `file://${plainPath}`;
}

async function listEntryNames(dirUri: string): Promise<string[]> {
  const entries = await FileSystem.readDirectoryAsync(dirUri);
  return entries.map((entry) =>
    entry.includes('/') ? decodeURIComponent(entry.slice(entry.lastIndexOf('/') + 1)) : entry,
  );
}

// Suppression récursive (fichiers ordinaires — plus de limitation SAF).
async function deleteRecursive(targetUri: string): Promise<void> {
  const children = await listEntryNames(targetUri).catch(() => null);
  if (children === null) {
    await FileSystem.deleteAsync(targetUri, { idempotent: true });
    return;
  }
  for (const child of children) await deleteRecursive(`${targetUri}/${child}`);
  await FileSystem.deleteAsync(targetUri, { idempotent: true });
}

//////// 1. 🔁 MIGRATION DES ANCIENNES URI SAF → CHEMINS ORDINAIRES ///////////

// `content://com.android.externalstorage.documents/tree/primary%3A✒️%20123Ecriture`
//   → `/storage/emulated/0/✒️ 123Ecriture` (l'identifiant document est
// relatif à la racine du volume primaire). Toute autre forme est rendue
// telle quelle (l'erreur claire du pont la signalera).
export function plainPathFromVaultPath(vaultPath: string): string {
  if (!vaultPath.startsWith('content://')) return vaultPath;
  const marker = '/tree/';
  const markerIndex = vaultPath.indexOf(marker);
  if (markerIndex < 0) return vaultPath;
  const documentId = decodeURIComponent(vaultPath.slice(markerIndex + marker.length));
  const colon = documentId.indexOf(':');
  const rest = colon >= 0 ? documentId.slice(colon + 1) : documentId;
  return `${PRIMARY_ROOT}/${rest}`;
}

async function migrateRegistryPaths(): Promise<void> {
  const registry = await readRegistry();
  let changed = false;
  const vaults = registry.vaults.map((vault) => {
    const migrated = plainPathFromVaultPath(vault.path);
    if (migrated !== vault.path) {
      changed = true;
      return { ...vault, path: migrated };
    }
    return vault;
  });
  if (changed) await saveRegistry({ vaults, activeVaultId: registry.activeVaultId });
}

//////// 2. 🗑️ DÉCONNEXION — VIDER LE CONTENU D'UN COFFRE ///////////

// v0.4.67 — « Déconnecter… » vide le CONTENU du coffre avant le retrait du
// registre (réinitialisation d'un coffre pollué). Le dossier racine est
// conservé. GESTE EXPLICITE uniquement — jamais appelé par le moteur.
async function viderContenuCoffre(root: string): Promise<void> {
  const rootUri = fileUri(root);
  const children = await listEntryNames(rootUri).catch(() => null);
  if (children === null) return; // coffre déjà illisible/vide : rien à faire
  for (const child of children) await deleteRecursive(`${rootUri}/${child}`);
}

//////// 3. 📂 SÉLECTION & ENREGISTREMENT ///////////

// Enregistre un coffre. Deux voies :
//  - `plainPath` fournie (création directe, migration) → mkdir si absent ;
//  - sinon → sélecteur système SAF (le seul moyen de pointer un dossier
//    existant précis, ex. celui qu'Obsidian mobile utilise) — l'URI retournée
//    est convertie en chemin ordinaire ; la permission SAF accordée ici n'a
//    plus d'autre usage.
export async function requestAndRegisterVault(name: string, plainPath?: string): Promise<VaultRegistryEntry[]> {
  let path = plainPath ?? '';
  if (!path) {
    const permission = await StorageAccessFramework.requestDirectoryPermissionsAsync();
    if (!permission.granted) return (await readRegistry()).vaults;
    path = plainPathFromVaultPath(permission.directoryUri);
  }
  await FileSystem.makeDirectoryAsync(fileUri(path), { intermediates: true }).catch(() => undefined);
  const entry: VaultRegistryEntry = {
    id: `native-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    path,
    cloudLinked: false,
    remoteVaultId: null,
  };
  return addVault(entry, true);
}

// Fichier d'identité d'appareil (« Appareils connectés ») — stockage privé,
// id stable par installation, nom générique.
const DEVICE_INFO_PATH = `${FileSystem.documentDirectory}123ecriture-device.json`;

//////// 4. 🔌 IMPLÉMENTATION DE VaultsBridge (l'objet exposé à l'app) ///////////

export const nativeVaultsAdapter: VaultsBridge = {
  clearVaultContent: async (id: string): Promise<void> => {
    const registry = await readRegistry();
    const entry = registry.vaults.find((v) => v.id === id);
    if (!entry) return;
    await viderContenuCoffre(plainPathFromVaultPath(entry.path));
  },
  list: async () => {
    await migrateRegistryPaths();
    return (await readRegistry()).vaults;
  },

  getActive: async () => (await readRegistry()).activeVaultId,

  addExisting: () => requestAndRegisterVault('Nouveau coffre'),

  // Dossier créé directement (permission fichiers ordinaires) — si le nom
  // est pris, suffixe numéroté.
  createNew: async (name: string) => {
    let finalName = name || 'Nouveau coffre';
    let candidate = `${PRIMARY_ROOT}/${finalName}`;
    let n = 2;
    while (
      await FileSystem.getInfoAsync(fileUri(candidate))
        .then((i) => i.exists)
        .catch(() => false)
    ) {
      finalName = `${finalName} ${n}`;
      candidate = `${PRIMARY_ROOT}/${finalName}`;
      n += 1;
    }
    await FileSystem.makeDirectoryAsync(fileUri(candidate), { intermediates: true });
    return requestAndRegisterVault(finalName, candidate);
  },

  deviceInfo: async () => {
    try {
      const info = await FileSystem.getInfoAsync(DEVICE_INFO_PATH);
      if (info.exists) {
        const parsed = JSON.parse(await FileSystem.readAsStringAsync(DEVICE_INFO_PATH)) as { id?: string };
        if (parsed.id) return { id: parsed.id, name: 'Appareil Android' };
      }
    } catch {
      // Fichier absent/corrompu : on en génère un neuf ci-dessous.
    }
    const id = `android-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    try {
      await FileSystem.writeAsStringAsync(DEVICE_INFO_PATH, JSON.stringify({ id }), { encoding: 'utf8' });
    } catch {
      // Écriture impossible : l'identité changera au prochain lancement —
      // dégradé acceptable, jamais de crash pour du best-effort.
    }
    return { id, name: 'Appareil Android' };
  },

  switch: (id: string) => switchActiveVault(id),

  rename: (id: string, name: string) => renameVaultEntry(id, name),

  remove: (id: string) => removeVaultEntry(id),

  // Enregistre le lien cloud dans le registre local — la synchro elle-même
  // vit dans lib/sync/ et fonctionne identiquement desktop/mobile.
  setCloudLink: (id: string, payload: { linked: boolean; remoteVaultId?: string | null }) =>
    setVaultCloudLink(id, payload),

  onChanged: (callback: (vaults: VaultRegistryEntry[]) => void) => onRegistryChanged(callback),
};

//////// 5. 🧭 RÉSOLUTION DU COFFRE ACTIF (getActiveVaultRootUri) ///////////

// Utilisé par nativeVaultAdapter.ts pour résoudre le coffre actif — pas
// exposé dans VaultsBridge (pas dans son contrat), donc exporté à part.
// La migration est rejouée ici : les premiers appels de l'app passent par
// cette fonction avant tout list().
export async function getActiveVaultRootUri(): Promise<string | null> {
  await migrateRegistryPaths().catch(() => undefined);
  const entry = await getActiveVaultEntry();
  if (!entry) return null;
  return plainPathFromVaultPath(entry.path);
}
