// ✒️ 123ECRITURE — lib/storage/permisDirect.ts — l'accès direct au stockage
//////////////////////////////////////////////////////////////////////////////
//
// v0.4.92 — L'OPTION A (modèle Obsidian, GO de Catelina le 21/10) : la
// permission « Tous les fichiers » (MANAGE_EXTERNAL_STORAGE) débloque le
// CHEMIN DIRECT (/storage/emulated/0/…) pour TOUT le coffre — le parcours,
// la lecture, l'écriture, le hachage. SAF ne reste que le repli.
//
// Pourquoi : le provider SAF de certains constructeurs (OneUI du A13 vécu
// 17-21/10) rejette le listage et l'écriture des dossiers dont le chemin
// contient une apostrophe (L'ENCHANTERESSE, L'HOMME VOLANT…) — le parcours
// saute ces sous-arbres entiers : indexation partielle, dossiers
// invisibles, disjoncteur halluciné. Le chemin direct n'a AUCUNE de ces
// limites (File API natif : ~x10-x100 plus rapide, tous les caractères
// légaux du FS Linux, parcours complet).
//
// Invariants :
//   • Le test est COMPORTEMENTAL (pas de module natif) : on tente le
//     listage direct du stockage partagé — la réponse dit la vérité de
//     l'appareil, quelle que soit sa version d'Android.
//   • La demande ouvre l'INTERRUPTEUR système (« Tous les fichiers ») —
//     jamais bloquant : l'app démarre et fonctionne en SAF tant que la
//     permission n'est pas accordée.
//   • Le résultat est mis en cache process, re-testé à chaque retour au
//     premier plan (l'utilisatrice peut l'accorder/revoquer).
//
// SOMMAIRE :
//   1. Le test comportemental + le cache
//   2. La demande (l'interrupteur système)
//
//////////////////////////////////////////////////////////////////////////////

import { Linking } from 'react-native';

import * as FileSystem from 'expo-file-system/legacy';

//////// 1. Le test comportemental + le cache /////////////////////////////////////////

let cacheDirect: boolean | null = null;

// Le chemin de test : un dossier du stockage partagé qui existe sur tous
// les appareils. En direct + permission accordée : le listage répond.
// Sans permission (Android 11+) : le listage échoue ou est vide-anormal.
export async function hasAllFilesAccess(): Promise<boolean> {
  if (cacheDirect !== null) return cacheDirect;
  const accorde = await sonderAccesDirect();
  cacheDirect = accorde;
  return accorde;
}

// Force le re-test (au retour au premier plan, après l'ouverture des
// réglages).
export function invaliderCacheDirect(): void {
  cacheDirect = null;
}

async function sonderAccesDirect(): Promise<boolean> {
  const cibles = [
    'file:///storage/emulated/0/Download/',
    'file:///storage/emulated/0/Documents/',
    'file:///storage/emulated/0/',
  ];
  for (const cible of cibles) {
    try {
      const contenu = await FileSystem.readDirectoryAsync(cible);
      // Un listage RÉUSSI (même vide) avec les entrées attendues = le
      // chemin direct est accessible. Un échec (permission) : passer au
      // chemin suivant, puis refuser.
      if (contenu.length > 0) return true;
    } catch {
      // Ce chemin est refusé : essayer le suivant.
    }
  }
  return false;
}

//////// 2. La demande (l'interrupteur système) ///////////////////////////////////////

// Ouvre l'interrupteur système « Tous les fichiers » pour 123Ecriture.
// Retourne false si l'ouverture des réglages a elle-même échoué (rare).
export async function demanderAccesDirect(): Promise<boolean> {
  try {
    await Linking.openURL(
      'android.settings.MANAGE_APP_ALL_FILES_ACCESS_PERMISSION?package=com.ecriture.app',
    );
    invaliderCacheDirect();
    return true;
  } catch {
    try {
      // Repli : la page générique de gestion (l'utilisatrice cherchera
      // 123Ecriture dans la liste).
      await Linking.openURL('android.settings.MANAGE_ALL_FILES_ACCESS_PERMISSION');
      invaliderCacheDirect();
      return true;
    } catch {
      return false;
    }
  }
}
