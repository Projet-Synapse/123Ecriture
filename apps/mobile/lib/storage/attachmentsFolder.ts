// ✒️ 123ECRITURE — lib/storage/attachmentsFolder.ts — dossier des pièces jointes (ports Android)
//////////////////////////////////////////////////////////////////////////////
//
// Lecture du réglage « Dossier des pièces jointes » (attachmentsFolder,
// défaut 'attachments') par les ports de coffre Android — SAF, vault-fs,
// cloud — pour l'import ET la résolution des embeds : les deux DOIVENT
// lire le même dossier (avant v0.4.99, le coffre cloud l'ignorait).
//
//////////////////////////////////////////////////////////////////////////////

import { normalizeAttachmentsFolder } from '../notes/embedResolution';

export async function readAttachmentsFolderPref(): Promise<string> {
  try {
    // globalThis (pas `window`) : ce module est aussi compilé côté
    // Electron (cloudVaultCore), sans les types DOM.
    const bridge = (globalThis as { preferences?: { get: () => Promise<unknown> } }).preferences;
    const prefs = (await bridge?.get()) as { attachmentsFolder?: unknown } | null | undefined;
    return normalizeAttachmentsFolder(typeof prefs?.attachmentsFolder === 'string' ? prefs.attachmentsFolder : '');
  } catch {
    return 'attachments';
  }
}
