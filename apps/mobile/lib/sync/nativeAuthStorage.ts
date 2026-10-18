// ✒️ 123ECRITURE — lib/sync/nativeAuthStorage.ts — stockage de session Supabase pour le natif (Android)
//////////////////////////////////////////////////////////////////////////////
//
// L'équivalent du localStorage du renderer Electron, sur un fichier du
// stockage privé de l'app. Interface StorageLike attendue par supabase-js
// (createClient, option auth.storage) — mêmes signatures que localStorage.
//
// Invariants du fichier :
//   • Sans ce pont, supabase-js retombe sur un stockage EN MÉMOIRE : la
//     session et l'état PKCE du flux Google (code verifier) disparaissent
//     au redémarrage — et une Android qui tue l'app en arrière-plan
//     pendant le passage navigateur casse l'échange du code au retour.
//   • Un cache mémoire évite de relire le fichier à chaque getItem (les
//     refresh tokens y passent souvent) ; les écritures sérialisent via
//     le cache, le risque de course reste borné (supabase-js verrouille
//     déjà ses propres écritures).
//   • Fichier absent ou corrompu → cache vide : on repart déconnecté,
//     jamais de crash au chargement.
//
// SOMMAIRE :
//   1. Le chargement et la persistance (STORAGE_PATH, load, persist)
//   2. L'adaptateur StorageLike exposé (nativeAuthStorage)
//
//////////////////////////////////////////////////////////////////////////////

//////// 1. Le chargement et la persistance (STORAGE_PATH, load, persist) ///////////

import * as FileSystem from 'expo-file-system/legacy';

const STORAGE_PATH = `${FileSystem.documentDirectory}supabase-auth.json`;

type StoredMap = Record<string, string>;
let cache: StoredMap | null = null;

async function load(): Promise<StoredMap> {
  if (cache) return cache;
  try {
    const raw = await FileSystem.readAsStringAsync(STORAGE_PATH);
    cache = JSON.parse(raw) as StoredMap;
  } catch {
    cache = {}; // fichier absent ou corrompu : repart à vide
  }
  return cache;
}

async function persist(map: StoredMap): Promise<void> {
  cache = map;
  try {
    await FileSystem.writeAsStringAsync(STORAGE_PATH, JSON.stringify(map));
  } catch (error) {
    // L'écriture peut échouer (stockage saturé) — la session courante reste
    // utilisable en mémoire ; le prochain lancement repartira déconnecté.
    console.error('[auth-storage] échec d’écriture :', error);
  }
}

//////// 2. L'adaptateur StorageLike exposé (nativeAuthStorage) ///////////

export const nativeAuthStorage = {
  getItem: async (key: string): Promise<string | null> => (await load())[key] ?? null,
  setItem: async (key: string, value: string): Promise<void> => {
    const map = await load();
    map[key] = value;
    await persist(map);
  },
  removeItem: async (key: string): Promise<void> => {
    const map = await load();
    delete map[key];
    await persist(map);
  },
};
