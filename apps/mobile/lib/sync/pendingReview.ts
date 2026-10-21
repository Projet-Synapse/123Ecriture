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
//   1. Le contrat de la file (chemin, types, seuil du disjoncteur)
//   2. Levée du disjoncteur + lecture/écriture de la file (clearPendingReviewSyncBlock, loadPendingReview, savePendingReview)
//
//////////////////////////////////////////////////////////////////////////////

//////// 1. Le contrat de la file (chemin, types, seuil du disjoncteur) ///////////

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
  // DISJONCTEUR DE SYNCHRO : quand un cycle se termine avec trop d'erreurs,
  // les cycles SUIVANTS sont refusés d'office tant qu'un humain n'a pas
  // levé le bloc — on ne peut pas « resynchroniser » par-dessus un appareil
  // en échec.
  syncBlocked?: {
    at: string;
    errorCount: number;
    samples: string[]; // extraits « origine : message » pour le diagnostic
  };
};

export type RemoteDeletionReview = {
  path: string;
  modified: boolean; // le fichier local avait été modifié depuis la dernière synchro
  at: string;
};

// Seuil d'erreurs DANS UN MÊME CYCLE qui pose le disjoncteur. 1-2 erreurs
// passagères ne bloquent rien ; une rafale (SAF non inscriptible, réseau
// fou, coffre incohérent) bloque tout jusqu'à revue.
export const SYNC_ERROR_BLOCK_THRESHOLD = 10;

//////// 2. Levée du disjoncteur + lecture/écriture de la file (clearPendingReviewSyncBlock, loadPendingReview, savePendingReview) ///////////

// Lève le disjoncteur (après revue humaine, ou à distance via la passerelle
// deviceGateway.ts « clear-sync-block »).
export async function clearPendingReviewSyncBlock(vault: {
  readNote: (relPath: string) => Promise<string>;
  writeNote: (relPath: string, content: string) => Promise<void>;
}): Promise<boolean> {
  const review = await loadPendingReview(vault);
  if (!review.syncBlocked) return false;
  delete review.syncBlocked;
  await savePendingReview(vault, review);
  return true;
}

// Un lecteur générique (le pont vault du coffre actif) est passé en
// paramètre : ce module reste utilisable par le moteur comme par l'UI sans
// dépendre du contexte React. ABSENT → file vide (première exécution).
// CORROMPU (JSON invalide) → file vide AUSSI, mais le fichier corrompu est
// archivé en `.corrupt` pour l'analyse : un crash pendant l'écriture ne
// doit pas DÉSARMER en silence le disjoncteur et les revues en attente
// (c'est précisément quand l'état est abîmé que les gardes comptent).
export async function loadPendingReview(vault: {
  readNote: (relPath: string) => Promise<string>;
  writeNote: (relPath: string, content: string) => Promise<void>;
}): Promise<PendingReview> {
  let brut: string;
  try {
    brut = await vault.readNote(PENDING_REVIEW_REL_PATH);
  } catch {
    return {}; // absent (première exécution) : file vide normale
  }
  try {
    const parsed = JSON.parse(brut) as PendingReview;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    // Corrompu : archiver la version abîmée (une seule fois) et repartir
    // d'une file vide — mais le laisser une trace exploitable.
    console.error('[revue] pending-review.json illisible — archivé en .corrupt :', error);
    try {
      await vault.writeNote(`${PENDING_REVIEW_REL_PATH}.corrupt`, brut);
    } catch {
      // Best-effort : la lecture du prochain cycle re-signalera.
    }
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
