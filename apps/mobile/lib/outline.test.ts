import { describe, expect, it } from 'vitest';

import { extractOutline } from './outline';

describe('extractOutline', () => {
  it('extrait les titres avec niveau et position', () => {
    const text = 'intro\n## Chapitre\nblabla\n### Scène 1\nfin';
    expect(extractOutline(text)).toEqual([
      { level: 2, title: 'Chapitre', offset: 6 },
      { level: 3, title: 'Scène 1', offset: 25 },
    ]);
  });

  it('ignore les titres dans un bloc de code', () => {
    const text = '```md\n# pas un titre\n```\n# vrai titre';
    const outline = extractOutline(text);
    expect(outline).toHaveLength(1);
    expect(outline[0].title).toBe('vrai titre');
  });
});
