import { describe, expect, it } from 'vitest';

import { findLiveMatches, planInline, planMark, type InlinePiece, type MarkMatch } from './liveDecorations';

// Rendu « visible » d'une ligne : texte avec les morceaux masqués retirés.
function visible(text: string, pieces: InlinePiece[]): string {
  let out = '';
  let cursor = 0;
  for (const p of [...pieces].sort((a, b) => a.from - b.from)) {
    if (p.kind === 'hide') {
      out += text.slice(cursor, p.from);
      cursor = p.to;
    }
  }
  return out + text.slice(cursor);
}

// Plan complet d'une ligne pour un curseur donné (null = curseur ailleurs).
function plan(text: string, cursor: number | null): InlinePiece[] {
  const touches = (from: number, to: number) => cursor !== null && cursor >= from && cursor <= to;
  const pieces: InlinePiece[] = [];
  for (const m of findLiveMatches(text)) {
    if (m.kind === 'mark') pieces.push(...planMark(text, m, m.contentSpans, '', touches));
    if (m.kind === 'heading') for (const s of m.contentSpans) pieces.push(...planInline(text, s.from, s.to, 'h', touches));
  }
  return pieces;
}

describe('révélation des marqueurs (mode Intermédiaire)', () => {
  it('gras : masqué hors curseur, visible et éditable curseur dedans ou collé', () => {
    const t = 'un **mot** ici';
    expect(visible(t, plan(t, null))).toBe('un mot ici');
    expect(visible(t, plan(t, 6))).toBe(t); // dans le mot
    expect(visible(t, plan(t, 3))).toBe(t); // collé avant
    expect(visible(t, plan(t, 10))).toBe(t); // collé après
    expect(visible(t, plan(t, 12))).toBe('un mot ici');
    // Révélé : marqueurs estompés, contenu toujours en gras.
    const pieces = plan(t, 6);
    expect(pieces.filter((p) => p.kind === 'marker')).toHaveLength(2);
    expect(pieces.find((p) => p.kind === 'text')?.style).toContain('font-weight:700');
  });

  it('italique *x* et _x_, imbriqués : tout se révèle au clic', () => {
    for (const t of ['a *mot* b', 'a _mot_ b']) {
      expect(visible(t, plan(t, null))).toBe('a mot b');
      expect(visible(t, plan(t, 4))).toBe(t);
    }
    const t = 'x **_Procédure_** y';
    expect(visible(t, plan(t, null))).toBe('x Procédure y');
    expect(visible(t, plan(t, 8))).toBe(t);
  });

  it('gras+italique ***x*** : un seul bloc cohérent', () => {
    const t = 'a ***fort*** b';
    const m = findLiveMatches(t).filter((x): x is MarkMatch => x.kind === 'mark');
    expect(m).toHaveLength(1);
    expect(m[0].type).toBe('boldItalic');
    expect(visible(t, plan(t, null))).toBe('a fort b');
    expect(visible(t, plan(t, 6))).toBe(t);
    expect(visible('___fort___', plan('___fort___', null))).toBe('fort');
  });

  it('marqueurs orphelins / parasites : jamais avalés', () => {
    for (const t of ['**Présentation du mode_*', '**1• début', 'mot** seul', 'a * b', 'snake_case_name', '****']) {
      expect(visible(t, plan(t, null))).toBe(t);
    }
  });

  it('titres : marqueurs du contenu révélés au clic, orphelins visibles', () => {
    const t = '## Chap 1 • 🖊️ **Présentation** du mode';
    const hidden = visible(t, plan(t, null));
    expect(hidden).toBe('## Chap 1 • 🖊️ Présentation du mode'); // (préfixe géré à part)
    expect(visible(t, plan(t, t.indexOf('Présentation') + 3))).toBe(t);
    const orphan = '## Chap 1 • 🖊️ **Présentation du mode_*';
    expect(visible(orphan, plan(orphan, null))).toBe(orphan);
    const mixed = '### **1• ⏯️** Activation/désactivation';
    expect(visible(mixed, plan(mixed, null))).toBe('### 1• ⏯️ Activation/désactivation');
    expect(visible(mixed, plan(mixed, 6))).toBe(mixed);
  });

  it('_ collé à un mot (snake_case) n’est pas de l’italique', () => {
    expect(findLiveMatches('ma_variable_longue').some((m) => m.kind === 'mark')).toBe(false);
    expect(findLiveMatches('un _vrai_ italique').some((m) => m.kind === 'mark')).toBe(true);
  });
});
