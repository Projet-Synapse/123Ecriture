import { describe, expect, it } from 'vitest';

import { matchDocument, type SearchDoc } from './queryMatch';
import { parseSearchQuery } from './queryParser';

function doc(partial: Partial<SearchDoc> & Pick<SearchDoc, 'relPath'>): SearchDoc {
  const fileName = partial.fileName ?? (partial.relPath.split('/').pop() ?? partial.relPath);
  return {
    relPath: partial.relPath,
    name: partial.name ?? fileName.replace(/\.[^.]+$/, ''),
    fileName,
    kind: partial.kind ?? 'markdown',
    body: partial.body,
    bodyOffset: partial.bodyOffset,
    properties: partial.properties,
  };
}

function hit(d: SearchDoc, q: string, caseSensitive = false) {
  const ast = parseSearchQuery(q).ast;
  if (!ast) return null;
  return matchDocument(d, ast, { caseSensitive });
}

const fiche = doc({
  relPath: "1. 👁 L'ENCHANTERESSE/📖 TEMPLATES/5. 👤 PERSONNAGES/🥇 PRINCIPAUX/👩🏻 Kyani Larsson.mdx",
  name: '👩🏻 Kyani Larsson',
  fileName: '👩🏻 Kyani Larsson.mdx',
  body: '---\nstatut: brouillon\n---\n# Pouvoirs\nKyani parle aux dragons.\n\n# Histoire\nElle a vécu à Luméville.\nUn elfe l’accompagne.\n',
  bodyOffset: 22,
  properties: { statut: 'brouillon' },
});
// body in SearchDoc is typically WITHOUT frontmatter; fix the fixture.
const kyani = doc({
  relPath: fiche.relPath,
  name: fiche.name,
  fileName: fiche.fileName,
  body: '# Pouvoirs\nKyani parle aux dragons.\n\n# Histoire\nElle a vécu à Luméville.\nUn elfe l’accompagne.\n',
  bodyOffset: 22,
  properties: { statut: 'brouillon' },
});

describe('matchDocument', () => {
  it('trouve un fichier par le nom, le chemin, les accents et les emoji', () => {
    expect(hit(kyani, 'kyani')?.matchType).toBe('title');
    expect(hit(kyani, 'KYANI')?.matchType).toBe('title');
    expect(hit(kyani, "L'ENCHANTERESSE")?.matchType).toBe('title');
    expect(hit(kyani, 'path:TEMPLATES')?.matchType).toBe('title');
    expect(hit(kyani, 'file:Larsson.mdx')?.matchType).toBe('title');
    expect(hit(kyani, 'path:Journal')).toBeNull();
  });

  it('ET, phrase exacte, exclusion, OR', () => {
    expect(hit(kyani, 'dragon luméville')?.matchType).toBe('content');
    expect(hit(kyani, '"parle aux dragons"')?.snippet).toContain('parle aux dragons');
    expect(hit(kyani, 'dragon -elfe')).toBeNull();
    expect(hit(kyani, 'dragon -licorne')?.matchType).toBe('content');
    expect(hit(kyani, 'licorne OR dragon')?.matchType).toBe('content');
    expect(hit(kyani, 'licorne OR vampire')).toBeNull();
  });

  it('respecte la casse si demandé (accents toujours ignorés)', () => {
    expect(hit(kyani, 'Kyani', true)?.matchType).toBe('title');
    expect(hit(kyani, 'kyani', true)).toBeNull();
    expect(hit(kyani, 'Luméville')?.matchType).toBe('content');
    expect(hit(kyani, 'Lumeville')?.matchType).toBe('content');
  });

  it('line: exige les mots sur la même ligne, section: sous le même titre', () => {
    expect(hit(kyani, 'line:(parle dragons)')?.matchType).toBe('content');
    expect(hit(kyani, 'line:(parle Luméville)')).toBeNull();
    expect(hit(kyani, 'section:(dragons)')?.matchType).toBe('content');
    expect(hit(kyani, 'section:(dragons Histoire)')).toBeNull();
    expect(hit(kyani, 'section:(vécu elfe)')?.matchType).toBe('content');
  });

  it('propriétés et compte des correspondances', () => {
    expect(hit(kyani, '[statut]')?.matchType).toBe('property');
    expect(hit(kyani, '[statut:BROUILLON]')?.matchType).toBe('property');
    expect(hit(kyani, '[statut:final]')).toBeNull();
    expect(hit(kyani, '[auteur]')).toBeNull();
    const several = doc({
      relPath: 'n.md',
      body: 'dragon ici, et un autre dragon plus loin.',
    });
    expect(hit(several, 'dragon')?.matchCount).toBe(2);
  });

  it('donne un décalage dans le fichier (frontmatter compris)', () => {
    const r = hit(kyani, 'Luméville');
    expect(r?.offset).toBeGreaterThan(22);
    expect(kyani.body!.slice((r!.offset! - 22), (r!.offset! - 22) + 9)).toMatch(/Luméville/i);
  });
});
