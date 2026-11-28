import { describe, expect, it } from 'vitest';

import {
  EXPLORER_HOVER_DELAY_MS,
  buildExplorerTooltipLines,
  countFolderContents,
  explorerHoverTitle,
  formatExplorerTimestamp,
  formatFolderCounts,
} from './explorerHover';

function folder(relPath: string, name: string, children: VaultTreeNode[] = []): VaultFolderNode {
  return { type: 'folder', relPath, name, children };
}

function note(relPath: string, name: string): VaultNoteNode {
  return { type: 'note', relPath, name, kind: 'markdown', modifiedAt: 1 };
}

describe('formatExplorerTimestamp', () => {
  it('formate AAAA-MM-JJ HH:MM en heure locale', () => {
    const d = new Date(2026, 10, 28, 13, 45, 8);
    expect(formatExplorerTimestamp(d.getTime())).toBe('2026-11-28 13:45');
  });

  it('cadre les unités sur deux chiffres', () => {
    const d = new Date(2026, 0, 5, 9, 3, 0);
    expect(formatExplorerTimestamp(d.getTime())).toBe('2026-01-05 09:03');
  });

  it('ignore une date invalide', () => {
    expect(formatExplorerTimestamp(Number.NaN)).toBe('');
  });
});

describe('countFolderContents / formatFolderCounts', () => {
  it('compte notes et sous-dossiers de façon récursive', () => {
    const tree: VaultTreeNode[] = [
      note('a.mdx', 'a'),
      folder('docs', 'docs', [
        note('docs/b.mdx', 'b'),
        folder('docs/in', 'in', [note('docs/in/c.mdx', 'c')]),
      ]),
    ];
    expect(countFolderContents(tree)).toEqual({ notes: 3, folders: 2 });
    expect(countFolderContents([])).toEqual({ notes: 0, folders: 0 });
  });

  it('formule le décompte en français', () => {
    expect(formatFolderCounts({ notes: 0, folders: 0 })).toBe('Aucune note, aucun sous-dossier');
    expect(formatFolderCounts({ notes: 1, folders: 0 })).toBe('1 note, aucun sous-dossier');
    expect(formatFolderCounts({ notes: 3, folders: 1 })).toBe('3 notes, 1 sous-dossier');
    expect(formatFolderCounts({ notes: 3, folders: 2 })).toBe('3 notes, 2 sous-dossiers');
  });
});

describe('buildExplorerTooltipLines', () => {
  const created = new Date(2026, 5, 1, 10, 0).getTime();
  const modified = new Date(2026, 10, 28, 13, 45).getTime();

  it('affiche le nom complet (emoji + extension) et les dates d’une note', () => {
    expect(
      buildExplorerTooltipLines({
        name: '🐉 Dragons',
        type: 'note',
        relPath: 'WORLDBUILDING/🐉 Dragons.mdx',
        createdAt: created,
        modifiedAt: modified,
      }),
    ).toEqual([
      '🐉 Dragons.mdx',
      'Dernière modification le 2026-11-28 13:45',
      'Créé le 2026-06-01 10:00',
    ]);
  });

  it('ajoute le décompte pour un dossier', () => {
    const lines = buildExplorerTooltipLines({
      name: 'GUIDES',
      type: 'folder',
      relPath: 'GUIDES',
      createdAt: created,
      modifiedAt: modified,
      folderCounts: { notes: 4, folders: 1 },
    });
    expect(lines[0]).toBe('GUIDES');
    expect(lines).toContain('4 notes, 1 sous-dossier');
  });

  it('omet une date absente', () => {
    expect(
      buildExplorerTooltipLines({
        name: 'seul',
        type: 'note',
        relPath: 'seul.mdx',
        modifiedAt: modified,
      }),
    ).toEqual(['seul.mdx', 'Dernière modification le 2026-11-28 13:45']);
  });

  it('garde le délai de la bulle à 500 ms', () => {
    expect(EXPLORER_HOVER_DELAY_MS).toBe(500);
  });

  it('explorerHoverTitle reprend le nom tel quel pour un dossier', () => {
    expect(explorerHoverTitle({ name: '⭐ Idées', type: 'folder', relPath: '⭐ Idées' })).toBe('⭐ Idées');
  });
});
