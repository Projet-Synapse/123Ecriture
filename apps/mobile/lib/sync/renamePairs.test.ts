import { describe, expect, it } from 'vitest';

import { EMPTY_SHA256 } from './folderMarker';
import { pairRenames } from './renamePairs';
import { planSync, type SyncBase } from './threeWay';

describe('pairRenames', () => {
  it('même contenu : renommage ou déplacement', () => {
    expect(pairRenames([{ relPath: 'A/x.md', hash: 'h1' }], [{ relPath: 'B/y.md', hash: 'h1' }])).toEqual([{ from: 'A/x.md', to: 'B/y.md' }]);
  });

  it('conversion .md ⇄ .mdx : même dossier, même nom, contenu différent', () => {
    expect(pairRenames([{ relPath: 'A/Note.md', hash: 'h1' }], [{ relPath: 'A/Note.mdx', hash: 'h2' }])).toEqual([
      { from: 'A/Note.md', to: 'A/Note.mdx' },
    ]);
    expect(pairRenames([{ relPath: 'Note.mdx', hash: 'h1' }], [{ relPath: 'Note.md', hash: 'h2' }])).toEqual([{ from: 'Note.mdx', to: 'Note.md' }]);
  });

  it('jamais d’appariement sans apparition correspondante', () => {
    expect(pairRenames([{ relPath: 'A/Note.md', hash: 'h1' }], [])).toEqual([]);
    expect(pairRenames([{ relPath: 'A/Note.md', hash: 'h1' }], [{ relPath: 'B/Note.mdx', hash: 'h2' }])).toEqual([]);
    expect(pairRenames([{ relPath: 'A/Note.md', hash: 'h1' }], [{ relPath: 'A/Autre.mdx', hash: 'h2' }])).toEqual([]);
  });

  it('fichiers vides : pas d’appariement par contenu', () => {
    expect(pairRenames([{ relPath: 'a.md', hash: EMPTY_SHA256 }], [{ relPath: 'b.md', hash: EMPTY_SHA256 }])).toEqual([]);
  });

  it('un pour un, ordre déterministe', () => {
    const pairs = pairRenames(
      [
        { relPath: 'b.md', hash: 'h' },
        { relPath: 'a.md', hash: 'h' },
      ],
      [{ relPath: 'c.md', hash: 'h' }],
    );
    expect(pairs).toEqual([{ from: 'a.md', to: 'c.md' }]);
  });
});

// 30 notes .md converties en .mdx sur CET appareil.
function massConversion(count: number) {
  const base: SyncBase = {};
  const remote = [];
  const local = [];
  for (let i = 0; i < count; i += 1) {
    base[`Notes/n${i}.md`] = { hash: `md${i}` };
    remote.push({ relPath: `Notes/n${i}.md`, hash: `md${i}`, deleted: false, version: 1 });
    local.push({ relPath: `Notes/n${i}.mdx`, hash: `mdx${i}` });
  }
  return { base, remote, local };
}

describe('planSync — un renommage n’est pas une suppression massive', () => {
  it('ici : conversion en masse → tombstones appariées, garde-fou NON déclenché', () => {
    const { base, remote, local } = massConversion(30);
    const plan = planSync({ local, remote, base });
    expect(plan.guard.suspended).toBe(false);
    const tombstones = plan.actions.filter((a) => a.kind === 'tombstone-remote');
    expect(tombstones).toHaveLength(30);
    expect(tombstones.every((a) => a.renamedTo === a.relPath.replace(/\.md$/, '.mdx'))).toBe(true);
    expect(plan.actions.filter((a) => a.kind === 'push')).toHaveLength(30);
  });

  it('ici : de vraies disparitions restent comptées (garde-fou intact)', () => {
    const { base, remote } = massConversion(30);
    const plan = planSync({ local: [{ relPath: 'autre.md', hash: 'z' }], remote, base });
    expect(plan.guard.suspended).toBe(true);
    expect(plan.actions.some((a) => a.kind === 'tombstone-remote')).toBe(false);
  });

  it('ici : renommages appariés conservés même si le garde-fou se lève pour d’autres suppressions', () => {
    const { base, remote, local } = massConversion(3);
    for (let i = 0; i < 25; i += 1) {
      base[`Vrai/s${i}.md`] = { hash: `s${i}` };
      remote.push({ relPath: `Vrai/s${i}.md`, hash: `s${i}`, deleted: false, version: 1 });
    }
    local.push({ relPath: 'reste.md', hash: 'r' });
    const plan = planSync({ local, remote, base });
    expect(plan.guard.suspended).toBe(true);
    expect(plan.guard.deletions).toHaveLength(25);
    expect(plan.actions.filter((a) => a.kind === 'tombstone-remote').map((a) => a.relPath)).toEqual([
      'Notes/n0.md',
      'Notes/n1.md',
      'Notes/n2.md',
    ]);
  });

  it('ailleurs : tombstones distantes appariées aux nouveaux chemins reçus, garde-fou NON déclenché', () => {
    const count = 30;
    const base: SyncBase = {};
    const remote = [];
    const local = [];
    for (let i = 0; i < count; i += 1) {
      base[`Notes/n${i}.md`] = { hash: `md${i}` };
      local.push({ relPath: `Notes/n${i}.md`, hash: `md${i}` });
      remote.push({ relPath: `Notes/n${i}.md`, hash: `md${i}`, deleted: true, version: 2 });
      remote.push({ relPath: `Notes/n${i}.mdx`, hash: `mdx${i}`, deleted: false, version: 1 });
    }
    const plan = planSync({ local, remote, base });
    expect(plan.guard.suspended).toBe(false);
    const deletions = plan.actions.filter((a) => a.kind === 'delete-local');
    expect(deletions).toHaveLength(count);
    expect(deletions.every((a) => a.renamedTo?.endsWith('.mdx'))).toBe(true);
    expect(plan.actions.filter((a) => a.kind === 'pull')).toHaveLength(count);
  });

  it('renommage simple sans changement de contenu : apparié par hash', () => {
    const plan = planSync({
      local: [{ relPath: 'B.md', hash: 'h' }],
      remote: [{ relPath: 'A.md', hash: 'h', deleted: false, version: 1 }],
      base: { 'A.md': { hash: 'h' } },
    });
    expect(plan.actions.find((a) => a.relPath === 'A.md')).toMatchObject({ kind: 'tombstone-remote', renamedTo: 'B.md' });
  });
});
