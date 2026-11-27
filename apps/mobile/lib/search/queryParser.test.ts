import { describe, expect, it } from 'vitest';

import {
  insertSearchOperator,
  parseSearchQuery,
  queryNeedles,
  queryNeedsContent,
  type QueryNode,
} from './queryParser';

function parse(q: string): QueryNode | null {
  return parseSearchQuery(q).ast;
}

describe('parseSearchQuery', () => {
  it('requête vide → rien', () => {
    expect(parse('')).toBeNull();
    expect(parse('   ')).toBeNull();
  });

  it('un terme, une phrase exacte, un mot-clé #', () => {
    expect(parse('dragon')).toEqual({ type: 'term', value: 'dragon', phrase: false, field: 'content' });
    expect(parse('"elfe noir"')).toEqual({ type: 'term', value: 'elfe noir', phrase: true, field: 'content' });
    expect(parse('#Géopolitique')).toEqual({ type: 'term', value: 'Géopolitique', phrase: false, field: 'tag' });
  });

  it('plusieurs termes = ET, OR plus faible, parenthèses', () => {
    expect(parse('dragon elfe')).toEqual({
      type: 'and',
      children: [
        { type: 'term', value: 'dragon', phrase: false, field: 'content' },
        { type: 'term', value: 'elfe', phrase: false, field: 'content' },
      ],
    });
    expect(parse('dragon OR elfe guerre')).toEqual({
      type: 'or',
      children: [
        { type: 'term', value: 'dragon', phrase: false, field: 'content' },
        {
          type: 'and',
          children: [
            { type: 'term', value: 'elfe', phrase: false, field: 'content' },
            { type: 'term', value: 'guerre', phrase: false, field: 'content' },
          ],
        },
      ],
    });
    expect(parse('(dragon OR elfe) guerre')).toEqual({
      type: 'and',
      children: [
        {
          type: 'or',
          children: [
            { type: 'term', value: 'dragon', phrase: false, field: 'content' },
            { type: 'term', value: 'elfe', phrase: false, field: 'content' },
          ],
        },
        { type: 'term', value: 'guerre', phrase: false, field: 'content' },
      ],
    });
  });

  it('exclusion, opérateurs de champ, phrases et valeurs entre guillemets', () => {
    expect(parse('-brouillon')).toEqual({
      type: 'not',
      child: { type: 'term', value: 'brouillon', phrase: false, field: 'content' },
    });
    expect(parse('path:"0. ⚙️ BASE"')).toEqual({
      type: 'term',
      value: '0. ⚙️ BASE',
      phrase: true,
      field: 'path',
    });
    expect(parse('file:guide.mdx')).toEqual({
      type: 'term',
      value: 'guide.mdx',
      phrase: false,
      field: 'file',
    });
    expect(parse('tag:géopolitique')).toEqual({
      type: 'term',
      value: 'géopolitique',
      phrase: false,
      field: 'tag',
    });
    expect(parse('dragon -elfe')).toEqual({
      type: 'and',
      children: [
        { type: 'term', value: 'dragon', phrase: false, field: 'content' },
        { type: 'not', child: { type: 'term', value: 'elfe', phrase: false, field: 'content' } },
      ],
    });
  });

  it('line: et section: avec un terme ou un groupe', () => {
    expect(parse('line:dragon')).toEqual({ type: 'term', value: 'dragon', phrase: false, field: 'line' });
    expect(parse('line:(dragon elfe)')).toEqual({
      type: 'group',
      field: 'line',
      child: {
        type: 'and',
        children: [
          { type: 'term', value: 'dragon', phrase: false, field: 'content' },
          { type: 'term', value: 'elfe', phrase: false, field: 'content' },
        ],
      },
    });
    expect(parse('section:(dragon OR elfe)')).toEqual({
      type: 'group',
      field: 'section',
      child: {
        type: 'or',
        children: [
          { type: 'term', value: 'dragon', phrase: false, field: 'content' },
          { type: 'term', value: 'elfe', phrase: false, field: 'content' },
        ],
      },
    });
  });

  it('propriétés [nom] et [nom:valeur]', () => {
    expect(parse('[statut]')).toEqual({ type: 'property', name: 'statut', value: null });
    expect(parse('[statut:brouillon]')).toEqual({ type: 'property', name: 'statut', value: 'brouillon' });
    expect(parse('[statut: en cours]')).toEqual({ type: 'property', name: 'statut', value: 'en cours' });
  });

  it('mélange réaliste', () => {
    const ast = parse('path:TEMPLATES file:"Kyani" [statut:brouillon] -tag:brouillon');
    expect(ast?.type).toBe('and');
    expect(queryNeedles(ast)).toEqual(['TEMPLATES', 'Kyani', 'brouillon']);
    expect(queryNeedsContent(ast)).toBe(true);
  });

  it('path: seul ne demande pas de lire le contenu', () => {
    expect(queryNeedsContent(parse('path:BASE'))).toBe(false);
    expect(queryNeedsContent(parse('file:guide'))).toBe(false);
    expect(queryNeedsContent(parse('dragon'))).toBe(true);
  });

  it('insère un opérateur avec l’espace qui convient', () => {
    expect(insertSearchOperator('', 'path:')).toBe('path:');
    expect(insertSearchOperator('dragon', 'path:')).toBe('dragon path:');
    expect(insertSearchOperator('dragon ', 'file:')).toBe('dragon file:');
  });

  it('guillemet échappé dans une phrase', () => {
    expect(parse('"dit \\"bonjour\\""')).toEqual({
      type: 'term',
      value: 'dit "bonjour"',
      phrase: true,
      field: 'content',
    });
  });
});
