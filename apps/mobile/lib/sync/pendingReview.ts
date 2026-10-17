//////////
// ✒️ 123ECRITURE — pendingReview.ts
// FILE DE REVUE MANUELLE (v0.4.72) : les actions destructrices SUSPECTES
// attendent ici une décision HUMAINE — jamais d'application silencieuse
//////////

// INTRODUCTION — Demande de Catelina (17/10, après l'incident « Projet
// L'Enchanteresse ») : la gestion des suppressions se fait par ELLE ou par
// un opérateur, JAMAIS de façon silencieuse. Quand le moteur détecte
// quelque chose de dangereux (aujourd'hui : les suppressions massives du
// garde anti-destruction), il ÉCRIT la liste ici —
// .123ecriture/pending-review.json, DANS le coffre (elle suit les
// déplacements et reste consultable depuis n'importe quel appareil) — et
// S'ARRÊTE. La levée se fait depuis l'interface de revue (ou explicitement
// par un opérateur), jamais par un cycle automatique. Pur et simple : ce
// module ne décide rien, il ne fait que porter la file.
//
// SOMMAIRE :
//   1. 📥 Lecture / écriture de la file (loadPendingReview / savePendingReview)

// Le chemin relatif, partagé avec syncEngine (même convention .123ecriture).
export const PENDING_REVIEW_REL_PATH = '.123ecriture/pending-review.json';

export type SuspiciousDeletionReview = {
  at: string; // ISO — quand le garde a bloqué
  count: number; // nombre de fichiers concernés
  paths: string[]; // échantillon (200 premiers) pour la revue
};

export type PendingReview = {
  suspiciousDeletions?: SuspiciousDeletionReview;
  // v0.4.72 — SUPPRESSIONS DISTANTES EN ATTENTE (règle Catelina : « JAMAIS
  // de façon silencieuse ») : un fichier supprimé sur un autre appareil
  // n'est plus effacé ici automatiquement — il reste EN PLACE jusqu'à ce
  // que la revue tranche (Supprimer vraiment / Restaurer dans le cloud).
  remoteDeletions?: RemoteDeletionReview[];
  // v0.4.72 — DISJONCTEUR DE SYNCHRO (angle mort signalé par Catelina) :
  // quand un cycle se termine avec trop d'erreurs, les cycles SUIVANTS sont
  // refusés d'office tant qu'un humain n'a pas levé le bloc — on ne peut
  // plus « resynchroniser » par-dessus un appareil en échec.
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

// v0.4.76 — Lève le disjoncteur (après revue humaine, ou via la passerelle
// à distance deviceGateway.ts « clear-sync-block »).
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

//////// 1. 📥 LECTURE / ÉCRITURE DE LA FILE ///////////

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
