// //1. 🗃️ REGISTRE DES COFFRES WEB — équivalent navigateur de vaults.ts
// ////////////////////////////////////////////////////////////////////////
//
// Port du registre multi-coffres (apps/desktop/electron/vaults.ts) sur la
// File System Access API :
// - L'IDENTITÉ de chaque coffre vit toujours DANS le dossier
//   (`.123ecriture/vault.json`) — un dossier re-choisi après retrait, ou
//   partagé desktop/navigateur, reste le même coffre (même clé de sync).
// - Le REGISTRE (liste + id actif) vit dans IndexedDB au lieu de
//   config.json : c'est là qu'on peut persister les handles de dossiers,
//   seule façon de retrouver l'accès entre deux visites.
// - `path` d'une entrée du registre : le handle ne connaît pas son chemin
//   disque (jamais exposé par le navigateur, pour raison de sécurité) — on
//   met le NOM du dossier choisi, suffisant à l'affichage.
//
// Toutes les méthodes attendent `whenReady()` : l'installation des ponts
// (installWebBridges.ts, appelé avant le premier rendu React) lance le
// chargement IndexedDB de façon asynchrone — les consommateurs
// (VaultsContext) lisent `window.vaults` de façon synchrone au premier
// rendu, l'objet doit donc exister IMMÉDIATEMENT, avec un état interne qui
// se remplit ensuite (chaque appel attend la fin du chargement).

import { type FsaDirectoryHandleLike, getDirByRelPath, readFileText, writeFileText } from './webFs';

import { idbDelete, idbGet, idbGetAll, idbPut, META_STORE, VAULTS_STORE } from './webIdb';
import { randomUUID as uuid } from './webUuid';

// Formes stockées en IndexedDB — miroir de config.json côté Electron
// (types.ts : VaultRegistryEntry) + le handle qui EST la valeur unique d'un
// coffre web.
interface StoredVault {
  id: string;
  name: string;
  handle: FsaDirectoryHandleLike;
  cloudLinked: boolean;
  remoteVaultId: string | null;
  createdAt: string;
}

const META_ACTIVE_ID = 'activeVaultId';

// Identité lue/écrite dans le coffre lui-même (`.123ecriture/vault.json`) —
// même fichier que le desktop, pour qu'un coffre utilisé sur les deux
// plateformes garde la même identité (et donc la même ligne de sync un jour).
interface VaultIdentity {
  id: string;
  name: string;
  createdAt: string;
}

async function readVaultIdentity(root: FsaDirectoryHandleLike): Promise<VaultIdentity | null> {
  try {
    return JSON.parse(await readFileText(root, '.123ecriture/vault.json')) as VaultIdentity;
  } catch {
    return null;
  }
}

async function writeVaultIdentity(root: FsaDirectoryHandleLike, identity: VaultIdentity): Promise<void> {
  await writeFileText(root, '.123ecriture/vault.json', JSON.stringify(identity, null, 2));
}

// Permission déjà accordée au handle (readwrite) ? `queryPermission` ne
// demande RIEN à l'utilisatrice — c'est le seul appel légal sans geste
// utilisateur. Un handle restauré d'IndexedDB démarre souvent en 'prompt' :
// dans ce cas le coffre reste listé mais inactif, et le RE-CLIC de
// l'utilisatrice (Paramètres → coffre, ou « Choisir un dossier ») déclenche
// requestPermission DANS le geste, qui ouvre la boîte de permission du
// navigateur.
export async function hasGrantedReadWrite(handle: FsaDirectoryHandleLike): Promise<boolean> {
  if (typeof handle.queryPermission !== 'function') return true; // environnement de test
  return (await handle.queryPermission({ mode: 'readwrite' })) === 'granted';
}

// (Re)demande la permission — à n'appeler que depuis un geste utilisateur.
export async function requestReadWrite(handle: FsaDirectoryHandleLike): Promise<boolean> {
  if (typeof handle.requestPermission !== 'function') return true;
  return (await handle.requestPermission({ mode: 'readwrite' })) === 'granted';
}

class WebVaultRegistry {
  private vaults: StoredVault[] = [];
  private activeId: string | null = null;
  private readyPromise: Promise<void>;
  private listeners = new Set<(vaults: VaultRegistryEntry[]) => void>();

  constructor() {
    // Idempotent : plusieurs appels d'installation partagent le même
    // chargement (installWebBridges ne devrait l'appeler qu'une fois, mais
    // la robustesse ne coûte rien ici).
    this.readyPromise = this.load().catch((error) => {
      console.error('[vaults-web] échec du chargement du registre :', error);
    });
  }

  private async load(): Promise<void> {
    this.vaults = await idbGetAll<StoredVault>(VAULTS_STORE);
    // Les entrées sans handle (ne devrait jamais arriver) sont purgées
    // silencieusement plutôt que de casser tout le registre.
    this.vaults = this.vaults.filter((vault) => Boolean(vault.handle));
    const storedActive = await idbGet<string>(META_STORE, META_ACTIVE_ID);
    // Le coffre actif n'est restauré que si sa permission est déjà accordée
    // — sinon il reste listé et se réactive au premier clic (voir
    // hasGrantedReadWrite ci-dessus).
    const active = this.vaults.find((vault) => vault.id === storedActive);
    this.activeId = active && (await hasGrantedReadWrite(active.handle)) ? active.id : null;
  }

  whenReady(): Promise<void> {
    return this.readyPromise;
  }

  // Handle du coffre ACTIF (permission accordée), ou null — l'équivalent de
  // getActiveVaultPath() dont tous les modules Electron dérivent.
  async getActiveHandle(): Promise<FsaDirectoryHandleLike | null> {
    await this.whenReady();
    const active = this.vaults.find((vault) => vault.id === this.activeId);
    if (!active) return null;
    if (!(await hasGrantedReadWrite(active.handle))) return null;
    return active.handle;
  }

  // Active un coffre en (re)demandant la permission — à appeler dans le
  // geste utilisateur (clic sur le coffre dans Paramètres).
  async activate(id: string): Promise<boolean> {
    await this.whenReady();
    const vault = this.vaults.find((entry) => entry.id === id);
    if (!vault) return false;
    if (!(await requestReadWrite(vault.handle))) return false;
    this.activeId = id;
    await idbPut(META_STORE, id, META_ACTIVE_ID);
    this.notify();
    return true;
  }

  async addExisting(handle: FsaDirectoryHandleLike): Promise<VaultRegistryEntry[]> {
    await this.whenReady();

    // Identité existante → même coffre (re-ajout après retrait, ou dossier
    // déjà utilisé côté desktop) ; sinon on crée `.123ecriture/vault.json`.
    let identity = await readVaultIdentity(handle);
    if (!identity) {
      identity = { id: uuid(), name: handle.name, createdAt: new Date().toISOString() };
      await writeVaultIdentity(handle, identity);
    }

    const already = this.vaults.find((vault) => vault.id === identity.id);
    if (already) {
      already.handle = handle;
      already.name = identity.name ?? handle.name;
    } else {
      this.vaults.push({
        id: identity.id,
        name: identity.name ?? handle.name,
        handle,
        cloudLinked: false,
        remoteVaultId: null,
        createdAt: identity.createdAt,
      });
    }
    await this.persistVault(already?.id ?? identity.id);
    this.activeId = identity.id;
    await idbPut(META_STORE, identity.id, META_ACTIVE_ID);
    this.notify();
    return this.toEntries();
  }

  // Crée un sous-dossier `name` dans le dossier parent choisi — port de
  // createVault (vaults.ts), dédoublonnage " 2", " 3"... inclus.
  async createNew(parent: FsaDirectoryHandleLike, name: string): Promise<VaultRegistryEntry[]> {
    await this.whenReady();
    const safeName = name && name.trim().length > 0 ? name.trim() : 'Nouveau coffre';
    let folderName = safeName;
    let counter = 2;
    for (;;) {
      try {
        await parent.getDirectoryHandle(folderName);
        folderName = `${safeName} ${counter}`;
        counter += 1;
      } catch {
        break;
      }
    }
    const handle = await parent.getDirectoryHandle(folderName, { create: true });
    const identity: VaultIdentity = { id: uuid(), name: folderName, createdAt: new Date().toISOString() };
    await writeVaultIdentity(handle, identity);
    this.vaults.push({
      id: identity.id,
      name: folderName,
      handle,
      cloudLinked: false,
      remoteVaultId: null,
      createdAt: identity.createdAt,
    });
    await this.persistVault(identity.id);
    this.activeId = identity.id;
    await idbPut(META_STORE, identity.id, META_ACTIVE_ID);
    this.notify();
    return this.toEntries();
  }

  async rename(id: string, name: string): Promise<VaultRegistryEntry[]> {
    await this.whenReady();
    const vault = this.findOrThrow(id);
    const trimmed = (name ?? '').trim();
    if (!trimmed) throw new Error('Le nom ne peut pas être vide.');
    vault.name = trimmed;
    // Répercuté sur l'identité du dossier, best-effort (comme desktop : un
    // dossier momentanément inaccessible n'empêche pas le renommage du
    // registre).
    try {
      const identity = (await readVaultIdentity(vault.handle)) ?? {
        id: vault.id,
        name: trimmed,
        createdAt: new Date().toISOString(),
      };
      await writeVaultIdentity(vault.handle, { ...identity, name: trimmed });
    } catch (error) {
      console.error('[vaults-web] échec de la réécriture de l\'identité :', error);
    }
    await this.persistVault(id);
    this.notify();
    return this.toEntries();
  }

  // Retire DE LA LISTE — jamais de suppression de fichiers (règle
  // CLAUDE.md, portée telle quelle du commentaire de removeVault).
  async remove(id: string): Promise<VaultRegistryEntry[]> {
    await this.whenReady();
    this.vaults = this.vaults.filter((vault) => vault.id !== id);
    await idbDelete(VAULTS_STORE, id);
    if (this.activeId === id) {
      // Premier coffre restant par défaut — seulement si sa permission est
      // déjà accordée (sinon il reste listé, inactif, et se réactive au
      // premier clic, voir hasGrantedReadWrite).
      const next = this.vaults[0];
      const canActivate = next ? await hasGrantedReadWrite(next.handle) : false;
      this.activeId = canActivate && next ? next.id : null;
      await idbPut(META_STORE, this.activeId, META_ACTIVE_ID);
    }
    this.notify();
    return this.toEntries();
  }

  async setCloudLink(
    id: string,
    payload: { linked: boolean; remoteVaultId?: string | null },
  ): Promise<VaultRegistryEntry[]> {
    await this.whenReady();
    const vault = this.findOrThrow(id);
    vault.cloudLinked = Boolean(payload?.linked);
    if (payload?.remoteVaultId !== undefined) vault.remoteVaultId = payload.remoteVaultId;
    await this.persistVault(id);
    this.notify();
    return this.toEntries();
  }

  getActiveId(): Promise<string | null> {
    return this.getActiveHandle().then((handle) => (handle ? this.activeId : null));
  }

  toEntries(): VaultRegistryEntry[] {
    return this.vaults.map((vault) => ({
      id: vault.id,
      name: vault.name,
      // Pas de chemin disque accessible en navigateur — le nom du dossier
      // tient lieu de repère (voir l'en-tête du module).
      path: vault.handle.name,
      cloudLinked: vault.cloudLinked,
      remoteVaultId: vault.remoteVaultId,
    }));
  }

  onChanged(callback: (vaults: VaultRegistryEntry[]) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  private findOrThrow(id: string): StoredVault {
    const vault = this.vaults.find((entry) => entry.id === id);
    if (!vault) throw new Error('Coffre introuvable.');
    return vault;
  }

  private async persistVault(id: string): Promise<void> {
    const vault = this.findOrThrow(id);
    await idbPut(VAULTS_STORE, {
      id: vault.id,
      name: vault.name,
      handle: vault.handle,
      cloudLinked: vault.cloudLinked,
      remoteVaultId: vault.remoteVaultId,
      createdAt: vault.createdAt,
    });
  }

  private notify(): void {
    const entries = this.toEntries();
    for (const listener of this.listeners) listener(entries);
  }
}

// Singleton partagé par tous les ponts web (window.vault pour chooseFolder,
// window.vaults pour le registre, les modules pour getActiveHandle).
export const webVaultRegistry = new WebVaultRegistry();

// Dossier `.123ecriture/` du coffre actif (créé au besoin) — les registres
// JSON de modules (tasks.json, events.json...) y vivent, comme côté desktop.
export async function getActiveConfigDir(): Promise<FsaDirectoryHandleLike | null> {
  const root = await webVaultRegistry.getActiveHandle();
  if (!root) return null;
  return getDirByRelPath(root, '.123ecriture', true);
}
