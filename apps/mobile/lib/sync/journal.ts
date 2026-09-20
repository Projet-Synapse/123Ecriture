// Journal de synchronisation (v0.4.27) — l'équivalent du « journal des
// synchronisations » d'Obsidian Sync : chaque cycle, envoi, réception,
// suppression, conflit, erreur et pause y laisse une entrée lisible.
//
// Stockage : `.123ecriture/sync-journal.json` DANS le coffre actif (dossier
// caché, jamais synchronisé — chaque appareil voit donc SON journal, comme
// Obsidian). Historique borné (SYNC_JOURNAL_MAX entrées) pour que le
// fichier ne croisse pas sans fin ; lecture par l'écran Paramètres →
// Journal, qui se rafraîchit périodiquement pour un rendu « en direct ».
//
// Pur et testé : la réduction (bornage) et les libellés vivent ici, le
// moteur (syncEngine.ts) se contente d'appeler appendJournal().

export type SyncJournalEntryType =
  | 'cycle-start'
  | 'cycle-end'
  | 'push'
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

// Libellé humain d'une entrée — utilisé tel quel par l'UI du journal.
// Les étapes réseau parlent comme Obsidian Sync : « Connexion au serveur »,
// « Upload en cours », « Upload terminé » — progressif et sans jargon
// (demande utilisateur : le journal doit raconter ce qui se passe, pas
// égrener des cycles techniques à vide).
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
    case 'pull':
      return `Reçu : ${entry.path ?? ''}`;
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
