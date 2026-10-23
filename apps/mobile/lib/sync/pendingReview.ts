// ✒️ 123ECRITURE — lib/sync/pendingReview.ts — file de revue manuelle des actions destructrices
//////////////////////////////////////////////////////////////////////////////
//
// Les actions destructrices SUSPECTES attendent ici une décision HUMAINE —
// jamais d'application silencieuse. Quand le moteur détecte quelque chose
// de dangereux (les suppressions massives du garde anti-destruction, des
// suppressions distantes à appliquer, un cycle en rafale d'erreurs), il
// ÉCRIT la liste dans ce fichier et S'ARRÊTE ; la levée se fait depuis
// l'interface de revue (ou explicitement par un opérateur), jamais par un
// cycle automatique.
//
// Invariants du fichier :
//   • La gestion des suppressions suspectes se fait par l'utilisatrice ou
//     par un opérateur, JAMAIS de façon silencieuse — le moteur écrit la
//     liste et s'arrête, il n'applique rien tout seul.
//   • Le fichier vit DANS le coffre (.123ecriture/pending-review.json) :
//     il suit les déplacements et reste consultable depuis n'importe quel
//     appareil.
//   • Ce module ne décide rien : il ne fait que porter la file
//     (lecture/écriture JSON) — pur, sans contexte React.
//
// SOMMAIRE :
//   1. Le contrat de la file (chemin, types, suppressions en revue)
//   2. Lecture/écriture de la file (loadPendingReview, savePendingReview)
//
//////////////////////////////////////////////////////////////////////////////

//////// 1. Le contrat de la file (chemin, types, suppressions en revue) ///////////

// Le chemin relatif, partagé avec syncEngine (même convention .123ecriture).
export const PENDING_REVIEW_REL_PATH = '.123ecriture/pending-review.json';

export type SuspiciousDeletionReview = {
  at: string; // ISO — quand le garde a bloqué
  count: number; // nombre de fichiers concernés
  paths: string[]; // échantillon (200 premiers) pour la revue
};

export type PendingReview = {
  suspiciousDeletions?: SuspiciousDeletionReview;
  // SUPPRESSIONS DISTANTES EN ATTENTE (jamais de façon silencieuse) : un
  // fichier supprimé sur un autre appareil n'est pas effacé ici
  // automatiquement — il reste EN PLACE jusqu'à ce que la revue tranche
  // (Supprimer vraiment / Restaurer dans le cloud).
  remoteDeletions?: RemoteDeletionReview[];
};

export type RemoteDeletionReview = {
  path: string;
  modified: boolean; // le fichier local avait été modifié depuis la dernière synchro
  at: string;
};


//////// 2. Lecture/écriture de la file (loadPendingReview, savePendingReview) ///////////


// Un lecteur générique (le pont vault du coffre actif) est passé en
// paramètre : ce module reste utilisable par le moteur comme par l'UI sans
// dépendre du contexte React. Absent/corrompu → file vide (jamais d'échec
// de cycle à cause de la revue elle-même).
export async function loadPendingReview(vault: {
  readNote: (relPath: string) => Promise<string>;
}): Promise<PendingReview> {
  try {
    const parsed = JSON.parse(await vault.readNote(PENDING_REVIEW_REL_PATH)) as PendingReview;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export async function savePendingReview(
  vault: {
    writeNote: (relPath: string, content: string) => Promise<void>;
  },
  review: PendingReview,
): Promise<void> {
  await vault.writeNote(PENDING_REVIEW_REL_PATH, JSON.stringify(review, null, 2));
}
