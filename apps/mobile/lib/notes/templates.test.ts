import { describe, expect, it } from 'vitest';

import {
  insertableTemplates,
  listTemplateNotes,
  matchingTemplateRules,
  normalizeTemplateRules,
  renderTemplate,
  templateForNewFile,
} from './templates';

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

describe('templateForNewFile (règles par chemin)', () => {
  const templateNotes = listTemplateNotes(tree, 'Gabarits');
  const existing = ['Gabarits/Journal.md', 'Gabarits/Sous/Réunion.mdx', '0. BASE/📁 MODÈLES/Fiche.md'];
  const rules = [
    { folder: 'Projets', template: 'Gabarits/Journal.md' },
    { folder: 'Projets/Réunions', template: 'Gabarits/Sous/Réunion.mdx' },
    { folder: 'Plantes', template: 'Gabarits/Supprimé.md' },
  ];
  const pick = (newRelPath: string, kind = 'markdown', defaultTemplate = '0. BASE/📁 MODÈLES/Fiche.md') =>
    templateForNewFile({ newRelPath, kind, rules, defaultTemplate, existingNotes: existing, templateNotes });

  it('la règle la plus spécifique gagne, sous-dossiers compris', () => {
    expect(pick('Projets/Réunions/2026/Lundi.md')).toBe('Gabarits/Sous/Réunion.mdx');
    expect(pick('projets/Idée.md')).toBe('Gabarits/Journal.md');
  });

  it('sinon le template par défaut, ou aucun', () => {
    expect(pick('Ailleurs/Note.md')).toBe('0. BASE/📁 MODÈLES/Fiche.md');
    expect(pick('Ailleurs/Note.md', 'markdown', '')).toBeNull();
    expect(pick('Projets-old/Note.md', 'markdown', '')).toBeNull();
  });

  it('template de règle disparu → règle moins spécifique / défaut', () => {
    expect(pick('Plantes/Rose.md')).toBe('0. BASE/📁 MODÈLES/Fiche.md');
  });

  it('jamais pour un fichier non-Markdown ni pour un template', () => {
    expect(pick('Projets/A.canvas', 'canvas')).toBeNull();
    expect(pick('Gabarits/Journal.md')).toBeNull();
  });

  it('à profondeur égale, ordre de la liste ; règle racine = tout le coffre', () => {
    const r = [
      { folder: '', template: 'Gabarits/Journal.md' },
      { folder: 'A', template: 'Gabarits/Sous/Réunion.mdx' },
      { folder: 'A', template: 'Gabarits/Journal.md' },
    ];
    expect(matchingTemplateRules('A/x.md', r).map((x) => x.template)).toEqual([
      'Gabarits/Sous/Réunion.mdx',
      'Gabarits/Journal.md',
      'Gabarits/Journal.md',
    ]);
    expect(matchingTemplateRules('B/x.md', r)).toHaveLength(1);
  });
});

describe('normalizeTemplateRules / insertableTemplates', () => {
  it('réglage tolérant', () => {
    expect(normalizeTemplateRules([{ folder: ' /Projets/ ', template: 'T.md' }, { folder: 1 }, null])).toEqual([
      { folder: 'Projets', template: 'T.md' },
    ]);
    expect(normalizeTemplateRules(undefined)).toEqual([]);
  });

  it('les templates des règles s\'ajoutent au menu d\'insertion', () => {
    expect(insertableTemplates(tree, undefined, ['Libre.md', 'Absent.md']).map((n) => n.relPath)).toEqual([
      '0. BASE/📁 MODÈLES/Fiche.md',
      'Libre.md',
    ]);
  });
});
