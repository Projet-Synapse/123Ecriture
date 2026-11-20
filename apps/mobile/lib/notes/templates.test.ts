import { describe, expect, it } from 'vitest';

import { defaultTemplateFor, listTemplateNotes, renderTemplate } from './templates';

const note = (relPath: string): VaultNoteNode =>
  ({ type: 'note', relPath, name: relPath.split('/').pop()!.replace(/\.[^.]+$/, ''), kind: 'markdown' }) as VaultNoteNode;
const folder = (relPath: string, children: VaultTreeNode[]): VaultTreeNode =>
  ({ type: 'folder', relPath, name: relPath.split('/').pop()!, children }) as VaultTreeNode;

const tree: VaultTreeNode[] = [
  folder('0. BASE', [folder('0. BASE/📁 MODÈLES', [note('0. BASE/📁 MODÈLES/Fiche.md')])]),
  folder('Gabarits', [note('Gabarits/Journal.md'), folder('Gabarits/Sous', [note('Gabarits/Sous/Réunion.mdx')])]),
  note('Libre.md'),
];

describe('listTemplateNotes', () => {
  it('détection automatique MODÈLES/TEMPLATES sans réglage', () => {
    expect(listTemplateNotes(tree).map((n) => n.relPath)).toEqual(['0. BASE/📁 MODÈLES/Fiche.md']);
  });

  it('dossier choisi dans Paramètres → Templates (sous-dossiers compris)', () => {
    expect(listTemplateNotes(tree, ' /Gabarits/ ').map((n) => n.relPath)).toEqual([
      'Gabarits/Journal.md',
      'Gabarits/Sous/Réunion.mdx',
    ]);
  });
});

describe('renderTemplate', () => {
  const now = new Date(2026, 10, 20, 9, 5, 7);
  it('remplace {{title}}, {{date}}, {{time}} et les formats', () => {
    expect(
      renderTemplate('# {{title}}\nCréé le {{date}} à {{ time }} — {{date:DD/MM/YYYY}} {{time:HH:mm:ss}} {{autre}}', {
        title: 'Plantes',
        now,
      }),
    ).toBe('# Plantes\nCréé le 2026-11-20 à 09:05 — 20/11/2026 09:05:07 {{autre}}');
  });
});

describe('defaultTemplateFor', () => {
  const templates = listTemplateNotes(tree, 'Gabarits');
  it('appliqué à une nouvelle note Markdown si le modèle existe', () => {
    expect(defaultTemplateFor({ templateRelPath: 'Gabarits/Journal.md', newRelPath: 'Sans titre.md', kind: 'markdown', templates })).toBe(
      'Gabarits/Journal.md',
    );
  });

  it('aucun : réglage vide, modèle disparu, autre type de fichier, fichier créé dans les modèles', () => {
    expect(defaultTemplateFor({ templateRelPath: '', newRelPath: 'A.md', kind: 'markdown', templates })).toBeNull();
    expect(defaultTemplateFor({ templateRelPath: 'Gabarits/Supprimé.md', newRelPath: 'A.md', kind: 'markdown', templates })).toBeNull();
    expect(defaultTemplateFor({ templateRelPath: 'Gabarits/Journal.md', newRelPath: 'A.canvas', kind: 'canvas', templates })).toBeNull();
    expect(defaultTemplateFor({ templateRelPath: 'Gabarits/Journal.md', newRelPath: 'Gabarits/Sous/Réunion.mdx', kind: 'markdown', templates })).toBeNull();
  });
});
