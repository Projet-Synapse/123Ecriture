// ✒️ 123ECRITURE — lib/storage/cloud/legacyImportCore.ts — import UNIQUE d'un ancien coffre SAF
//////////////////////////////////////////////////////////////////////////////
//
// Un ancien coffre Android non lié au cloud (ex. DIVERS) est importé UNE
// fois : ses fichiers sont LUS dans l'ancien dossier (aucune écriture,
// aucune suppression, aucun fichier temporaire dedans) et publiés comme
// CRÉATIONS dans un coffre distant neuf. Un chemin déjà présent côté cloud
// n'est jamais écrasé (« exists » → ignoré). Le dossier reste sur le
// téléphone tel quel.
//
//////////////////////////////////////////////////////////////////////////////

export type LegacyFile = { relPath: string; uri: string; binary: boolean };

export type LegacyReader = {
  list: (rootUri: string) => Promise<LegacyFile[]>;
  read: (file: LegacyFile) => Promise<string>; // utf8 ou base64 selon binary
  size?: (file: LegacyFile) => Promise<number | null>;
};

export type ImportSink = {
  importFile: (relPath: string, content: string, encoding: 'utf8' | 'base64') => Promise<'exists' | 'queued'>;
  flush: () => Promise<{ pending: number; offline: boolean; errors: string[] }>;
};

export type ImportReport = {
  total: number;
  imported: number;
  skippedExisting: number;
  skippedTooLarge: string[];
  failed: string[];
  pending: number;
  offline: boolean;
};

export const IMPORT_MAX_FILE_BYTES = 50 * 1024 * 1024;

const IMPORTED_META = new Set([
  '.123ecriture/appearance.json',
  '.123ecriture/tasks.json',
  '.123ecriture/tasklists.json',
  '.123ecriture/preferences.json',
]);

export function shouldImportRelPath(relPath: string): boolean {
  if (relPath === '.trash' || relPath.startsWith('.trash/')) return false;
  if (relPath.startsWith('.123ecriture/')) return IMPORTED_META.has(relPath);
  return !relPath.split('/').some((seg) => seg.startsWith('.') || seg.includes('\\'));
}

export async function importLegacyFiles(
  rootUri: string,
  reader: LegacyReader,
  sink: ImportSink,
  onProgress?: (done: number, total: number) => void,
): Promise<ImportReport> {
  const files = (await reader.list(rootUri)).filter((f) => shouldImportRelPath(f.relPath));
  const report: ImportReport = { total: files.length, imported: 0, skippedExisting: 0, skippedTooLarge: [], failed: [], pending: 0, offline: false };
  let done = 0;
  for (const f of files) {
    try {
      const size = reader.size ? await reader.size(f) : null;
      if (size !== null && size > IMPORT_MAX_FILE_BYTES) {
        report.skippedTooLarge.push(f.relPath);
      } else {
        const content = await reader.read(f);
        const r = await sink.importFile(f.relPath, content, f.binary ? 'base64' : 'utf8');
        if (r === 'exists') report.skippedExisting += 1;
        else report.imported += 1;
      }
    } catch (error) {
      report.failed.push(`${f.relPath} : ${String((error as Error)?.message ?? error)}`);
    }
    done += 1;
    onProgress?.(done, files.length);
  }
  const flushed = await sink.flush();
  report.pending = flushed.pending;
  report.offline = flushed.offline;
  report.failed.push(...flushed.errors);
  return report;
}
