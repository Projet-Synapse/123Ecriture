import { describe, expect, it } from 'vitest';

import { findTodoWarnings } from './codeLint';

describe('findTodoWarnings (soulignements jaunes)', () => {
  it('repère TODO/FIXME/XXX/HACK dans les commentaires ligne (// et #)', () => {
    const text = ['// TODO: refactoriser', 'code()', '# FIXME utiliser asyncio', 'x = 1'].join('\n');
    const warnings = findTodoWarnings(text);
    expect(warnings.map((warning) => warning.marker)).toEqual(['TODO', 'FIXME']);
    // Positions ABSOLUES, prêtes pour un Diagnostic CodeMirror.
    expect(text.slice(warnings[0]!.from, warnings[0]!.to)).toBe('TODO');
    expect(text.slice(warnings[1]!.from, warnings[1]!.to)).toBe('FIXME');
  });

  it('repère les marqueurs dans les blocs /* */ et les marqueurs de ligne SQL/Lua', () => {
    const text = ['/* NOTE pas un marqueur */', '/* TODO vérifier */', '-- TODO migration', 'ok'].join('\n');
    const warnings = findTodoWarnings(text);
    expect(warnings.map((warning) => warning.marker)).toEqual(['TODO', 'TODO']);
  });

  it('ignore les mots contenant le marqueur (TODOlists) et passe en majuscule', () => {
    const warnings = findTodoWarnings('// todoliste à finir\n// todo: vrai marqueur');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.marker).toBe('TODO');
  });

  it('plafonne le nombre de résultats pour ne pas noyer le panneau', () => {
    const text = Array.from({ length: 300 }, (_, index) => `// TODO item ${index}`).join('\n');
    expect(findTodoWarnings(text)).toHaveLength(100);
  });
});
