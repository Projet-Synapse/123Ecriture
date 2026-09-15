// Mini wrapper IndexedDB promisifié — tout ce dont les ponts web ont besoin
// (deux magasins : les coffres et leurs métadonnées), sans dépendance.
//
// Pourquoi IndexedDB et pas localStorage : un FileSystemDirectoryHandle est
// sérialisable en IndexedDB (c'est le mécanisme officiel pour retrouver
// l'accès à un dossier entre deux visites) mais PAS en localStorage, qui
// n'accepte que des chaînes.

export const DB_NAME = '123ecriture';
export const DB_VERSION = 1;

export const VAULTS_STORE = 'vaults';
export const META_STORE = 'meta';

export function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(VAULTS_STORE)) db.createObjectStore(VAULTS_STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB indisponible.'));
  });
}

// Exécute une opération dans une transaction fraîche (un IDBTransaction est
// inutilisable après un await : chaque appel rouvre la transaction, c'est la
// convention standard des wrappers IndexedDB).
export async function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T> | void,
): Promise<T | undefined> {
  const db = await openDatabase();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const transaction = db.transaction(storeName, mode);
      const store = transaction.objectStore(storeName);
      const request = operation(store);
      let result: T | undefined;
      if (request) {
        request.onsuccess = () => {
          result = request.result;
        };
      }
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(transaction.error ?? new Error('Erreur IndexedDB.'));
      transaction.onabort = () => reject(transaction.error ?? new Error('Transaction IndexedDB avortée.'));
    });
  } finally {
    db.close();
  }
}

export async function idbPut(storeName: string, value: unknown, key?: IDBValidKey): Promise<void> {
  await withStore(storeName, 'readwrite', (store) => (key !== undefined ? store.put(value, key) : store.put(value)));
}

export async function idbGet<T>(storeName: string, key: IDBValidKey): Promise<T | undefined> {
  return (await withStore(storeName, 'readonly', (store) => store.get(key))) as T | undefined;
}

export async function idbGetAll<T>(storeName: string): Promise<T[]> {
  return ((await withStore(storeName, 'readonly', (store) => store.getAll())) as T[]) ?? [];
}

export async function idbDelete(storeName: string, key: IDBValidKey): Promise<void> {
  await withStore(storeName, 'readwrite', (store) => store.delete(key));
}
