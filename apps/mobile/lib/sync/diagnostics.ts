// ✒️ 123ECRITURE — lib/sync/diagnostics.ts — rapport de diagnostic d'un appareil
//////////////////////////////////////////////////////////////////////////////
//
// La vérité locale d'un appareil, lisible et transportable : ce module
// FORME (pur, testé) le rapport que la passerelle (deviceGateway.ts)
// collecte et publie dans le cloud — version, coffres, permission de
// stockage, état de synchro, file de revue, fin du journal. Réponse
// structurelle à l'aveuglement « je ne vois jamais l'application en train
// de mal fonctionner » : un appareil à distance décrit exactement son état.
//
// Invariants du fichier :
//   • Pur : ce module ne collecte rien, il forme et met en forme — la
//     collecte vit dans la passerelle (deviceGateway.ts).
//   • Les erreurs de COLLECTE elles-mêmes figurent dans le rapport
//     (collectionErrors) — jamais silencieuses.
//   • Le rapport est du TEXTE copiable : il se lit tel quel, depuis l'app
//     ou via la passerelle, sans outil.
//
// SOMMAIRE :
//   1. Forme du rapport (DiagnosticsReport)
//   2. Mise en forme lisible (formatDiagnosticsReport)
//
//////////////////////////////////////////////////////////////////////////////

//////// 1. Forme du rapport (DiagnosticsReport) ///////////

export type DiagnosticsJournalEntry = {
  t: string;
  type: string;
  path?: string;
  detail?: string;
};

export type DiagnosticsReport = {
  at: string;
  platform: string;
  device: { id: string; name: string; appVersion: string | null };
  // null = non pertinent sur cette plateforme (permission Android).
  storagePermission?: boolean | null; // Android/All-Files : null en mode SAF (non pertinent)
  activeVaultPath: string | null;
  vaults: { name: string; path: string; cloudLinked: boolean; remoteVaultId: string | null }[];
  syncStateFileCount: number | null;
  pendingReview: unknown;
  journalTail: DiagnosticsJournalEntry[];
  collectionErrors: string[];
};

//////// 2. Mise en forme lisible (formatDiagnosticsReport) ///////////

export function formatDiagnosticsReport(report: DiagnosticsReport): string {
  const lines: string[] = [];
  const at = new Date(report.at);
  const dateComplete = Number.isNaN(at.getTime())
    ? report.at
    : `${at.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })} ${at.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;

  lines.push(`📋 Rapport de diagnostic — ${dateComplete}`);
  lines.push(`Appareil : ${report.device.name} (${report.device.id}) — v${report.device.appVersion ?? '?'} — ${report.platform}`);
  if (report.storagePermission !== null) {
    lines.push(`Permission « tous les fichiers » : ${report.storagePermission ? 'accordée' : 'REFUSÉE ⚠'}`);
  }
  lines.push(`Coffre local actif : ${report.activeVaultPath ?? 'AUCUN ⚠'}`);
  if (report.vaults.length > 0) {
    lines.push('Coffres enregistrés :');
    for (const vault of report.vaults) {
      lines.push(
        `  - ${vault.name}${vault.cloudLinked ? ` [cloud lié: ${String(vault.remoteVaultId).slice(0, 8)}]` : ' [local]'} → ${vault.path}`,
      );
    }
  }
  if (report.syncStateFileCount !== null) {
    lines.push(`sync-state : ${report.syncStateFileCount} fichier(s) référencé(s)`);
  }
  if (report.pendingReview && typeof report.pendingReview === 'object' && Object.keys(report.pendingReview as object).length > 0) {
    lines.push(`Revue en attente : ${JSON.stringify(report.pendingReview).slice(0, 400)}`);
  }
  if (report.journalTail.length > 0) {
    lines.push('Fin du journal de synchronisation :');
    for (const entry of report.journalTail) {
      const t = new Date(entry.t);
      const quand = Number.isNaN(t.getTime()) ? entry.t : t.toLocaleString('fr-FR');
      lines.push(`  ${quand} — ${entry.type}${entry.path ? ` ${entry.path}` : ''}${entry.detail ? ` — ${entry.detail}` : ''}`);
    }
  }
  for (const error of report.collectionErrors) lines.push(`⚠ collecte : ${error}`);
  return lines.join('\n');
}
