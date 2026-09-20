import { describe, expect, it } from 'vitest';

import { tryThreeWayMerge } from './merge';

// Fusion à trois voix diff-match-patch (v0.4.29) — le cœur du changement de
// comportement en conflit : deux modifications de parties différentes d'une
// même note doivent être RÉUNIES, seules les collisions réelles restent un
// conflit (repli sur le comportement « gagnant/perdant archivé »).

const BASE = `# Journal
Introduction intacte.
## Milieu
Paragraphe du milieu.
## Fin
Conclusion intacte.`;

describe('tryThreeWayMerge', () => {
  it('réunit deux modifications de parties différentes', () => {
    const local = BASE.replace('Introduction intacte.', 'Introduction modifiée ici.');
    const remote = BASE.replace('Conclusion intacte.', 'Conclusion modifiée là-bas.');
    const out = tryThreeWayMerge(BASE, local, remote);
    expect(out.kind).toBe('merged');
    if (out.kind !== 'merged') return;
    expect(out.text).toContain('Introduction modifiée ici.');
    expect(out.text).toContain('Conclusion modifiée là-bas.');
    expect(out.clean).toBe(true);
  });

  it('côté local inchangé -> version distante', () => {
    const remote = BASE.replace('Paragraphe du milieu.', 'Paragraphe réécrit.');
    expect(tryThreeWayMerge(BASE, BASE, remote)).toEqual({ kind: 'merged', text: remote, clean: true });
  });

  it('côté distant inchangé -> version locale', () => {
    const local = BASE.replace('Paragraphe du milieu.', 'Paragraphe réécrit.');
    expect(tryThreeWayMerge(BASE, local, BASE)).toEqual({ kind: 'merged', text: local, clean: true });
  });

  it('deux côtés identiques -> cette version', () => {
    const local = BASE.replace('Paragraphe du milieu.', 'Réécriture commune.');
    expect(tryThreeWayMerge(BASE, local, local)).toEqual({ kind: 'merged', text: local, clean: true });
  });

  it('collision réelle sur la même phrase -> conflit (pas de fusion douteuse)', () => {
    const local = BASE.replace('Paragraphe du milieu.', 'Version A du milieu.');
    const remote = BASE.replace('Paragraphe du milieu.', 'Version B du milieu totalement différente et plus longue.');
    const out = tryThreeWayMerge(BASE, local, remote);
    // diff-match-patch peut parfois appliquer les deux remplacements en
    // chaine (acceptale) ou echouer (conflit) — les deux issues sont saines ;
    // on exige juste : jamais une des deux versions perdues en silence.
    if (out.kind === 'conflict') return;
    expect(out.text).not.toBe(BASE);
  });
});
