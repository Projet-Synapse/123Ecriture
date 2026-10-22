import { describe, expect, it } from 'vitest';

import { isHashableRelPath, SYNC_ATTACHMENT_EXTENSIONS, SYNCED_META_FILES } from './syncRules';

// LA RÈGLE UNIQUE partagée par les DEUX marcheurs (desktop fs Node + mobile
// fichiers ordinaires) : tout écart entre les plateformes pour un même
// coffre crée des boucles de synchronisation. Ces tests verrouillent la
// parité — toute modification de règle doit passer ICI avant tout.
describe('isHashableRelPath (règle unique desktop+mobile)', () => {
  it('hache le contenu reconnu', () => {
    expect(isHashableRelPath('1. Dossier/Note.mdx')).toBe(true);
    expect(isHashableRelPath('Note.md')).toBe(true);
    expect(isHashableRelPath('Schéma.canvas')).toBe(true);
    expect(isHashableRelPath('script.py')).toBe(true);
    expect(isHashableRelPath('attachments/image.png')).toBe(true);
  });

  it('ne synchronise PLUS la corbeille .trash (locale à chaque appareil)', () => {
    expect(isHashableRelPath('.trash/Note.mdx')).toBe(false);
    expect(isHashableRelPath('.trash/.123ecriture/tasks.json')).toBe(false);
    expect(isHashableRelPath('.trash/archive.xyz')).toBe(false);
  });

  it('exclut les segments cachés (.123ecriture, .obsidian…)', () => {
    expect(isHashableRelPath('.obsidian/config.json')).toBe(false);
    expect(isHashableRelPath('.123ecriture/sync-state.json')).toBe(false);
    expect(isHashableRelPath('Dossier/.caché.md')).toBe(false);
  });

  it('liste blanche : les métadonnées synchronisées passent malgré le segment caché', () => {
    for (const relPath of SYNCED_META_FILES) {
      expect(isHashableRelPath(relPath)).toBe(true);
    }
  });

  it('rejette les résidus à backslash (contamination, purge manuelle)', () => {
    expect(isHashableRelPath('.trash\\📈 ESPACE DE TRAVAIL\\turbo.json')).toBe(false);
    expect(isHashableRelPath('Dossier\\Note.md')).toBe(false);
  });

  it('rejette les extensions non reconnues', () => {
    expect(isHashableRelPath('Dossier/document.xyz')).toBe(false);
  });

  it('les pièces jointes connues sont hachées (même sans extension de contenu)', () => {
    expect(isHashableRelPath(`attachments/clip${SYNC_ATTACHMENT_EXTENSIONS[0]}`)).toBe(true);
  });
});
