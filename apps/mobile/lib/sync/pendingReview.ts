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
//   3. Suppressions distantes en attente (reconcileRemoteDeletions, withoutRemoteDeletions)
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
  at: string; // ISO — mise en file sur CET appareil
  // Traçabilité (colonnes vault_files.deleted_by_device / deleted_at,
  // renseignées par la RPC tombstone_file) : absents avec un ancien serveur.
  deletedByDevice?: string | null;
  deletedAt?: string | null;
  remoteVersion?: number | null;
};

// File illisible (JSON corrompu, lecture en échec) : JAMAIS confondue avec
// « file vide » — l'écraser perdrait des décisions en attente.
export class PendingReviewUnreadableError extends Error {
  constructor(detail: string) {
    super(`file de revue illisible (.123ecriture/pending-review.json) : ${detail}`);
    this.name = 'PendingReviewUnreadableError';
  }
}

const NOT_FOUND = /introuvable|not found|could not be found|ENOENT|no such file|does not exist/i;

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
// dépendre du contexte React. ABSENT → file vide ; illisible/corrompu →
// PendingReviewUnreadableError (l'appelant décide, sans rien écraser).
export async function loadPendingReview(vault: {
  readNote: (relPath: string) => Promise<string>;
}): Promise<PendingReview> {
  let raw: string;
  try {
    raw = await vault.readNote(PENDING_REVIEW_REL_PATH);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (NOT_FOUND.test(message)) return {};
    throw new PendingReviewUnreadableError(message);
  }
  if (raw.trim() === '') return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new PendingReviewUnreadableError(error instanceof Error ? error.message : String(error));
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new PendingReviewUnreadableError('contenu inattendu');
  }
  return parsed as PendingReview;
}

export async function savePendingReview(
  vault: {
    writeNote: (relPath: string, content: string) => Promise<void>;
  },
  review: PendingReview,
): Promise<void> {
  await vault.writeNote(PENDING_REVIEW_REL_PATH, JSON.stringify(review, null, 2));
}

//////// 3. Suppressions distantes en attente (logique pure) ///////////////

// Nouvelle file à partir de l'ancienne et des candidates de ce cycle :
//   • une entrée reste tant que la ligne est TOUJOURS une pierre tombale et
//     que le fichier existe localement (sinon elle est résolue ailleurs :
//     restaurée depuis un autre appareil, ou fichier déjà parti) ;
//   • une candidate déjà en file garde sa date de mise en file d'origine ;
//   • ordre stable par chemin.
export function reconcileRemoteDeletions(
  existing: RemoteDeletionReview[],
  candidates: RemoteDeletionReview[],
  stillPending: Set<string>,
): { entries: RemoteDeletionReview[]; added: RemoteDeletionReview[] } {
  const previous = new Map(existing.map((e) => [e.path, e]));
  const byPath = new Map<string, RemoteDeletionReview>();
  const added: RemoteDeletionReview[] = [];
  for (const entry of existing) {
    if (stillPending.has(entry.path)) byPath.set(entry.path, entry);
  }
  for (const candidate of candidates) {
    if (!stillPending.has(candidate.path)) continue;
    const old = previous.get(candidate.path);
    if (!old) added.push(candidate);
    byPath.set(candidate.path, { ...candidate, at: old?.at ?? candidate.at });
  }
  const entries = [...byPath.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { entries, added };
}

export function sameRemoteDeletions(a: RemoteDeletionReview[] | undefined, b: RemoteDeletionReview[]): boolean {
  return JSON.stringify(a ?? []) === JSON.stringify(b);
}

// Retire des chemins tranchés (approuvés / refusés) de la file.
export function withoutRemoteDeletions(review: PendingReview, paths: Iterable<string>): PendingReview {
  const done = new Set(paths);
  return { ...review, remoteDeletions: (review.remoteDeletions ?? []).filter((r) => !done.has(r.path)) };
}
