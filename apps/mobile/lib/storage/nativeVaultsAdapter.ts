import * as FileSystem from 'expo-file-system/legacy';

import {
  addVault,
  getActiveVaultEntry,
  onRegistryChanged,
  readRegistry,
  removeVaultEntry,
  renameVaultEntry,
  setVaultCloudLink,
  switchActiveVault,
} from './nativeVaultRegistry';

// Sélecteur de dossier système (voir requestAndRegisterVault ci-dessous).
const { StorageAccessFramework } = FileSystem;

// Fichier d'identité d'appareil (voir deviceInfo ci-dessous) — même stockage
// privé que le registre des coffres (documentDirectory), mécanisme identique
// à nativeVaultRegistry.ts.
const DEVICE_INFO_PATH = `${FileSystem.documentDirectory}123ecriture-device.json`;

// Implémentation native (Android) de VaultsBridge — voir
// nativeVaultRegistry.ts pour le pourquoi du modèle de stockage. `path`
// porte l'URI SAF racine (content://...), utilisé tel quel par
// nativeVaultAdapter.ts pour toutes les opérations fichier.
//
// SAF ne permet que de CHOISIR un dossier déjà existant via le sélecteur
// système (`requestDirectoryPermissionsAsync`) — contrairement à Electron
// où "créer un nouveau coffre" peut littéralement créer un dossier vide à
// l'endroit choisi, il n'y a pas d'équivalent Android permettant de créer
// PUIS naviguer automatiquement vers un nouveau dossier sans passer par ce
// même sélecteur. `createNew` délègue donc à la même autorisation SAF que
// `addExisting` — l'utilisatrice choisit/crée le dossier depuis le
// sélecteur système lui-même (bouton "Nouveau dossier" qu'Android propose
// déjà dans ce sélecteur), puis on l'enregistre sous le nom donné.
async function requestAndRegisterVault(name: string): Promise<VaultRegistryEntry[]> {
  const permission = await StorageAccessFramework.requestDirectoryPermissionsAsync();
  if (!permission.granted) {
    // Annulé par l'utilisatrice — pas une erreur, juste rien à faire (même
    // logique que vault:choose-folder côté Electron, qui renvoie le chemin
    // actif inchangé si le sélecteur natif est annulé).
    return (await readRegistry()).vaults;
  }
  const entry: VaultRegistryEntry = {
    id: `native-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    path: permission.directoryUri,
    cloudLinked: false,
    remoteVaultId: null,
  };
  return addVault(entry, true);
}

function decodeFolderNameFromUri(uri: string): string {
  try {
    const decoded = decodeURIComponent(uri);
    const lastSegment = decoded.split(/[/:]/).filter(Boolean).pop();
    return lastSegment || 'Coffre';
  } catch {
    return 'Coffre';
  }
}

export const nativeVaultsAdapter: VaultsBridge = {
  list: async () => (await readRegistry()).vaults,

  getActive: async () => (await readRegistry()).activeVaultId,

  addExisting: () => requestAndRegisterVault('Nouveau coffre'),

  // SAF ne permet pas de créer un sous-dossier à l'endroit choisi : le
  // dossier est choisi/créé depuis le sélecteur système lui-même, puis
  // enregistré sous le nom donné (voir requestAndRegisterVault).
  createNew: async (name: string, _title?: string, _vaultName?: string) =>
    requestAndRegisterVault(name || 'Nouveau coffre'),

  // Identité d'appareil pour « appareils connectés » : stable par
  // installation (pas de hostname exposé par React Native), nom générique.
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

  // La synchronisation cloud (voir lib/sync/) reste desktop uniquement pour
  // l'instant (auth système-browser + protocole personnalisé Electron,
  // voir docs/ARCHITECTURE.md §6) — ce setter existe pour satisfaire le
  // type `VaultsBridge`, mais ne fait qu'enregistrer le drapeau localement,
  // sans déclencher de vraie synchro.
  setCloudLink: (id: string, payload: { linked: boolean; remoteVaultId?: string | null }) =>
    setVaultCloudLink(id, payload),

  onChanged: (callback: (vaults: VaultRegistryEntry[]) => void) => onRegistryChanged(callback),
};

// Utilisé par nativeVaultAdapter.ts pour résoudre le coffre actif — pas
// exposé dans VaultsBridge (pas dans son contrat), donc exporté à part.
export async function getActiveVaultRootUri(): Promise<string | null> {
  const entry = await getActiveVaultEntry();
  return entry?.path ?? null;
}

export { decodeFolderNameFromUri };
