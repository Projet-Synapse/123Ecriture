// ✒️ 123ECRITURE — lib/sync/journal.ts — journal de synchronisation lisible
//////////////////////////////////////////////////////////////////////////////
//
// L'équivalent du « journal des synchronisations » d'Obsidian Sync : chaque
// cycle, envoi, réception, suppression, conflit, erreur et pause y laisse
// une entrée lisible, racontée pour l'utilisatrice. Stockage :
// `.123ecriture/sync-journal.json` DANS le coffre actif (dossier caché,
// jamais synchronisé — chaque appareil voit donc SON journal, comme
// Obsidian). Lecture par l'écran Paramètres → Journal, qui se rafraîchit
// périodiquement pour un rendu « en direct ».
//
// Invariants du fichier :
//   • Historique borné (SYNC_JOURNAL_MAX entrées, les plus récentes) pour
//     que le fichier ne croisse pas sans fin — tout en restant généreux
//     pour un cycle de masse (une rafale de suppressions produit N entrées
//     d'un coup).
//   • Pur et testé : la réduction (bornage) et les libellés vivent ici —
//     le moteur (syncEngine.ts) se contente d'appeler appendJournal().
//   • Le journal raconte le CHANGEMENT (caractères ajoutés/supprimés via
//     changeStats.ts) et les gestes reconnaissables (« Corbeille : … »),
//     pas des cycles techniques à vide.
//
// SOMMAIRE :
//   1. Les types et le bornage (SyncJournalEntryType, SYNC_JOURNAL_MAX, capJournalEntries, makeJournalEntry)
//   2. Le libellé humain d'une entrée (journalEntryLabel)
//
//////////////////////////////////////////////////////////////////////////////

//////// 1. Les types et le bornage (SyncJournalEntryType, SYNC_JOURNAL_MAX, capJournalEntries, makeJournalEntry) ///////////

export type SyncJournalEntryType =
  | 'cycle-start'
  | 'cycle-end'
  | 'push'
  // Le journal raconte le CHANGEMENT — nombre de caractères
  // ajoutés/supprimés et total, calculés par comparaison avec la version
  // distante précédente (voir changeStats.ts).
  | 'modification'
  | 'modification-reçue'
  // Le push d'un chemin `.trash/…` est le CONTINU d'un déplacement en
  // corbeille (la corbeille est synchronisée) — il se raconte « Corbeille :
  // … », pas « Modifié : … », sinon le même geste se lit « supprimé PUIS
  // modifié ».
  | 'corbeille'
  | 'pull'
  | 'delete'
  | 'conflict'
  | 'error'
  | 'pause'
  | 'resume'
  | 'restore'
  | 'info'
  // Étapes progressives d'un cycle (façon Obsidian Sync : lisible en direct)
  | 'connexion'
  | 'upload-start'
  | 'upload-end'
  | 'download-start'
  | 'download-end';

export type SyncJournalEntry = {
  t: string;
  type: SyncJournalEntryType;
  path?: string;
  detail?: string;
};

// Généreuses pour un cycle de masse (une rafale de suppressions produit
// N entrées d'un coup), bornées pour ne jamais dépasser quelques centaines
// de Ko sur disque.
export const SYNC_JOURNAL_MAX = 800;

export type SyncJournal = { entries: SyncJournalEntry[] };

// Garde les SYNC_JOURNAL_MAX entrées les plus récentes (les nouvelles
// arrivent en fin de tableau).
export function capJournalEntries(entries: SyncJournalEntry[]): SyncJournalEntry[] {
  return entries.length > SYNC_JOURNAL_MAX ? entries.slice(entries.length - SYNC_JOURNAL_MAX) : entries;
}

export function makeJournalEntry(
  type: SyncJournalEntryType,
  options: { path?: string; detail?: string } = {},
  now: () => Date = () => new Date(),
): SyncJournalEntry {
  const entry: SyncJournalEntry = { t: now().toISOString(), type };
  if (options.path) entry.path = options.path;
  if (options.detail) entry.detail = options.detail;
  return entry;
}

//////// 2. Le libellé humain d'une entrée (journalEntryLabel) ///////////

// Libellé humain d'une entrée — utilisé tel quel par l'UI du journal.
// Les étapes réseau parlent comme Obsidian Sync : « Connexion au serveur »,
// « Upload en cours », « Upload terminé » — progressif et sans jargon : le
// journal raconte ce qui se passe, il n'égrene pas des cycles techniques
// à vide.
export function journalEntryLabel(entry: SyncJournalEntry): string {
  switch (entry.type) {
    case 'cycle-start':
    case 'connexion':
      return 'Connexion au serveur…';
    case 'upload-start':
      return `Upload en cours… (${entry.detail ?? ''})`;
    case 'upload-end':
      return `Upload terminé (${entry.detail ?? ''})`;
    case 'download-start':
      return `Téléchargement en cours… (${entry.detail ?? ''})`;
    case 'download-end':
      return `Téléchargement terminé (${entry.detail ?? ''})`;
    case 'cycle-end':
      return `Synchronisé — ${entry.detail ?? ''}`.trim();
    case 'push':
      return `Envoyé : ${entry.path ?? ''}`;
    case 'modification':
      return `Modifié : ${entry.path ?? ''}${entry.detail ? ` — ${entry.detail}` : ''}`;
    case 'corbeille':
      return `Corbeille : ${entry.path ?? ''}${entry.detail ? ` — ${entry.detail}` : ''}`;
    case 'pull':
      return `Reçu : ${entry.path ?? ''}`;
    case 'modification-reçue':
      return `Modifiée (reçue d'un autre appareil) : ${entry.path ?? ''}${entry.detail ? ` — ${entry.detail}` : ''}`;
    case 'delete':
      return `Supprimé : ${entry.path ?? ''}${entry.detail ? ` (${entry.detail})` : ''}`;
    case 'conflict':
      return `Conflit : ${entry.path ?? ''}${entry.detail ? ` — ${entry.detail}` : ''}`;
    case 'error':
      return `Erreur : ${entry.detail ?? entry.path ?? ''}`;
    case 'pause':
      return 'Surveillance en pause (cycle en cours)';
    case 'resume':
      return 'Surveillance reprise';
    case 'restore':
      return `Restauré : ${entry.path ?? ''}`;
    case 'info':
      return entry.detail ?? '';
  }
}
