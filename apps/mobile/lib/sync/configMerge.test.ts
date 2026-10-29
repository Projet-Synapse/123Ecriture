import { describe, expect, it } from 'vitest';
import {
  CLOCK_TOLERANCE_MS,
  configConflictBackupPath,
  isStructuredConfigFile,
  mergeConfigJson,
  newerSide,
  planConfigResolution,
  verifiedBase,
} from './configMerge';
import { sha256HexOfText } from './nativeSha256';
import { isHashableRelPath, shouldWatchTrigger } from './syncRules';

const j = (v: unknown) => JSON.stringify(v, null, 2);
const parsed = (r: ReturnType<typeof mergeConfigJson>) => {
  if (r.kind !== 'merged') throw new Error(r.kind);
  return JSON.parse(r.text);
};

describe('mergeConfigJson — tasks.json (par id)', () => {
  const t = (id: string, extra: Record<string, unknown> = {}) => ({ id, title: id, done: false, ...extra });

  it('une suppression locale ne revient pas si le cloud n’a pas touché la tâche', () => {
    const base = j([t('a'), t('b')]);
    const local = j([t('a')]);
    const remote = j([t('a'), t('b')]);
    expect(parsed(mergeConfigJson(base, local, remote)).map((x: { id: string }) => x.id)).toEqual(['a']);
  });

  it('une suppression côté cloud est appliquée', () => {
    const base = j([t('a'), t('b')]);
    expect(parsed(mergeConfigJson(base, base, j([t('b')]))).map((x: { id: string }) => x.id)).toEqual(['b']);
  });

  it('ajouts des deux côtés réunis, modifs de champs différents fusionnées', () => {
    const base = j([t('a')]);
    const local = j([t('n1'), t('a', { done: true })]);
    const remote = j([t('a', { title: 'A2' }), t('n2')]);
    const out = parsed(mergeConfigJson(base, local, remote));
    expect(out.map((x: { id: string }) => x.id).sort()).toEqual(['a', 'n1', 'n2']);
    expect(out.find((x: { id: string }) => x.id === 'a')).toEqual({ id: 'a', title: 'A2', done: true });
  });

  it('même champ modifié des deux côtés : la plus récente gagne', () => {
    const base = j([t('a')]);
    const L = j([t('a', { title: 'L' })]);
    const R = j([t('a', { title: 'R' })]);
    expect(parsed(mergeConfigJson(base, L, R, 'remote'))[0].title).toBe('R');
    expect(parsed(mergeConfigJson(base, L, R, 'local'))[0].title).toBe('L');
    // défaut (aucune date) : le cloud
    expect(parsed(mergeConfigJson(base, L, R))[0].title).toBe('R');
  });

  it('suppression d’un côté + modification de l’autre : la tâche est gardée (rien perdu)', () => {
    const base = j([t('a')]);
    const out = parsed(mergeConfigJson(base, j([]), j([t('a', { done: true })])));
    expect(out).toEqual([t('a', { done: true })]);
  });
});

describe('mergeConfigJson — tasklists.json et preferences.json', () => {
  it('listes par id + activeListId par clé', () => {
    const base = j({ lists: [{ id: 'l1', name: 'Tâches' }], activeListId: 'l1' });
    const local = j({ lists: [{ id: 'l1', name: 'Tâches' }, { id: 'l2', name: 'Perso' }], activeListId: 'l2' });
    const remote = j({ lists: [{ id: 'l1', name: 'Boulot' }], activeListId: 'l1' });
    expect(parsed(mergeConfigJson(base, local, remote))).toEqual({
      lists: [{ id: 'l1', name: 'Boulot' }, { id: 'l2', name: 'Perso' }],
      activeListId: 'l2',
    });
  });

  it('un côté INCHANGÉ ne l’emporte jamais : themeMode changé sur le téléphone reste', () => {
    const base = j({ themeMode: 'light', fontSize: 16 });
    const local = j({ themeMode: 'light', fontSize: 18 }); // PC : police seulement
    const remote = j({ themeMode: 'dark', fontSize: 16 }); // téléphone : thème
    expect(parsed(mergeConfigJson(base, local, remote))).toEqual({ themeMode: 'dark', fontSize: 18 });
    // symétrique
    expect(parsed(mergeConfigJson(base, remote, local))).toEqual({ themeMode: 'dark', fontSize: 18 });
  });

  it('clé retirée d’un côté seulement : retirée', () => {
    const base = j({ a: 1, b: 2 });
    expect(parsed(mergeConfigJson(base, j({ a: 1 }), base))).toEqual({ a: 1 });
  });

  it('résultat identique au cloud : texte du cloud réutilisé tel quel', () => {
    const base = j({ a: 1 });
    const remote = '{"a":2}';
    const r = mergeConfigJson(base, base, remote);
    expect(r).toMatchObject({ kind: 'merged', text: remote });
  });
});

describe('mergeConfigJson — replis', () => {
  it('sans base : le côté le plus récent gagne', () => {
    expect(mergeConfigJson(null, j({ a: 1 }), j({ a: 2 }))).toEqual({ kind: 'side-wins', side: 'remote', reason: 'no-base' });
    expect(mergeConfigJson(null, j({ a: 1 }), j({ a: 2 }), 'local')).toEqual({ kind: 'side-wins', side: 'local', reason: 'no-base' });
  });
  it('base illisible = pas de base ; local ou distant illisible : le cloud gagne', () => {
    expect(mergeConfigJson('{', j({}), j({}), 'local')).toEqual({ kind: 'side-wins', side: 'local', reason: 'no-base' });
    expect(mergeConfigJson(j({}), '{', j({})).kind).toBe('remote-wins');
    expect(mergeConfigJson(j({}), j({}), 'xx').kind).toBe('remote-wins');
  });
});

describe('fichiers de conflit', () => {
  it('chemin .conflict local, jamais synchronisé', () => {
    const p = configConflictBackupPath('.123ecriture/preferences.json', new Date('2026-10-24T14:43:00.000Z'));
    expect(p).toBe('.123ecriture/preferences.conflict-2026-10-24T14-43-00-000Z.json');
    expect(isHashableRelPath(p)).toBe(false);
  });
  it('seuls les 3 fichiers JSON de configuration sont concernés (appearance hors périmètre)', () => {
    expect(isStructuredConfigFile('.123ecriture/tasks.json')).toBe(true);
    expect(isStructuredConfigFile('.123ecriture/tasklists.json')).toBe(true);
    expect(isStructuredConfigFile('.123ecriture/preferences.json')).toBe(true);
    expect(isStructuredConfigFile('.123ecriture/appearance.json')).toBe(false);
    expect(isStructuredConfigFile('notes/x.json')).toBe(false);
  });
});

describe('la plus récente gagne — newerSide', () => {
  const r = '2026-10-25T10:00:00.000Z';
  const rMs = Date.parse(r);
  it('local nettement plus récent : local', () => {
    expect(newerSide(rMs + CLOCK_TOLERANCE_MS + 1, r)).toBe('local');
  });
  it('dans la tolérance d’horloge : le cloud', () => {
    expect(newerSide(rMs + CLOCK_TOLERANCE_MS, r)).toBe('remote');
    expect(newerSide(rMs - 1000, r)).toBe('remote');
  });
  it('dates manquantes : côté daté, sinon le cloud', () => {
    expect(newerSide(undefined, r)).toBe('remote');
    expect(newerSide(rMs, undefined)).toBe('local');
    expect(newerSide(undefined, undefined)).toBe('remote');
  });
});

describe('base vérifiée (A)', () => {
  it('base dont le hash ≠ sync-state : ignorée (pas de référence)', () => {
    const stale = j({ themeMode: 'light' });
    expect(verifiedBase(stale, sha256HexOfText(j({ themeMode: 'dark' })))).toBeNull();
    expect(verifiedBase(stale, undefined)).toBeNull();
    expect(verifiedBase(stale, sha256HexOfText(stale))).toBe(stale);
  });
  it('base périmée : plus de fusion silencieuse — la plus récente gagne et le perdant est sauvegardé', () => {
    // Scénario LORDI : base périmée = valeur du cloud → l'ancienne logique
    // concluait « local inchangé » et écrasait la modif locale.
    const stale = j({ themeMode: 'dark' });
    const local = j({ themeMode: 'sepia' });
    const remote = j({ themeMode: 'dark', fontSize: 16 });
    const base = verifiedBase(stale, sha256HexOfText(j({ themeMode: 'light' })));
    const plan = planConfigResolution(base, local, remote, 'local');
    expect(plan).toMatchObject({ final: local, push: true, pull: false, backupCloud: true, backupLocal: false, reason: 'no-base' });
  });
});

describe('planConfigResolution (B)', () => {
  it('sans base, local plus récent : envoi, version cloud sauvegardée', () => {
    const p = planConfigResolution(null, j({ a: 1 }), j({ a: 2 }), 'local');
    expect(p).toMatchObject({ final: j({ a: 1 }), push: true, pull: false, backupCloud: true, backupLocal: false });
  });
  it('sans base, cloud plus récent : réception + .conflict local', () => {
    const p = planConfigResolution(null, j({ a: 1 }), j({ a: 2 }), 'remote');
    expect(p).toMatchObject({ final: j({ a: 2 }), push: false, pull: true, backupLocal: true, backupCloud: false });
  });
  it('deux appareils, même champ : le plus récent gagne, résultat ≠ cloud envoyé', () => {
    const base = j({ themeMode: 'light', fontSize: 16 });
    const pc = j({ themeMode: 'sepia', fontSize: 18 });
    const tel = j({ themeMode: 'dark', fontSize: 16 });
    const p = planConfigResolution(base, pc, tel, 'local');
    expect(JSON.parse(p.final)).toEqual({ themeMode: 'sepia', fontSize: 18 });
    expect(p).toMatchObject({ push: true, backupCloud: true, backupLocal: false });
    const q = planConfigResolution(base, pc, tel, 'remote');
    expect(JSON.parse(q.final)).toEqual({ themeMode: 'dark', fontSize: 18 });
    // fusion ≠ cloud (fontSize locale) → DOIT être envoyée ; les deux perdants sauvegardés
    expect(q).toMatchObject({ push: true, backupCloud: true, backupLocal: true });
  });
  it('fusion identique au cloud : pas d’envoi', () => {
    const base = j({ a: 1 });
    const p = planConfigResolution(base, base, j({ a: 2 }), 'local');
    expect(p).toMatchObject({ final: j({ a: 2 }), push: false, backupCloud: false, backupLocal: true });
  });
});

describe('pas de conflit répété au cycle suivant', () => {
  // Modèle du cycle : L = disque, R = cloud, B = hash sync-state ; base
  // texte stockée dans bases/. Après résolution, le moteur enregistre base
  // ET hash (mergedHashes) dans le MÊME cycle.
  const classify = (L: string, R: string, B: string | undefined) =>
    L === R ? 'noop' : R === B ? 'push' : L === B ? 'pull' : 'conflict';
  for (const newer of ['local', 'remote'] as const) {
    for (const withBase of [true, false]) {
      it(`newer=${newer}, base=${withBase ? 'fiable' : 'absente'}`, () => {
        const b = j({ themeMode: 'light', fontSize: 16 });
        const local = j({ themeMode: 'sepia', fontSize: 18 });
        let remote = j({ themeMode: 'dark', fontSize: 16 });
        const h = sha256HexOfText;
        expect(classify(h(local), h(remote), withBase ? h(b) : undefined)).toBe('conflict');
        const plan = planConfigResolution(withBase ? verifiedBase(b, h(b)) : null, local, remote, newer);
        // exécution : disque = final ; push → cloud = final ; base = final ; hash = h(final)
        const disk = plan.final;
        if (plan.push) remote = plan.final;
        const baseText = plan.final;
        const stateHash = h(disk);
        expect(classify(h(disk), h(remote), stateHash)).toBe('noop');
        expect(verifiedBase(baseText, stateHash)).toBe(baseText);
      });
    }
  }
});

describe('watcher desktop (C)', () => {
  it('laisse passer contenu, corbeille et les 4 métadonnées synchronisées', () => {
    for (const f of ['Chapitre 1.md', 'dossier/note.md', '.trash/x.md',
      '.123ecriture/tasks.json', '.123ecriture/tasklists.json',
      '.123ecriture/preferences.json', '.123ecriture/appearance.json',
      '.123ecriture\\tasks.json']) expect(shouldWatchTrigger(f), f).toBe(true);
  });
  it('ignore les fichiers internes du moteur', () => {
    for (const f of ['.123ecriture/sync-journal.json', '.123ecriture/sync-state.json',
      '.123ecriture/bases/abc', '.123ecriture/devices/x.json',
      '.123ecriture/preferences.conflict-2026-10-24T14-43-00-000Z.json',
      '.123ecriture/tasks.conflict-cloud-2026-10-24T14-43-00-000Z.json',
      '.123ecriture', '.git/HEAD', 'dossier/.cache', '']) expect(shouldWatchTrigger(f), f).toBe(false);
  });
});

describe('sauvegarde cloud distincte', () => {
  it('nom .conflict-cloud- : deux perdants du même cycle ne s’écrasent pas', () => {
    const d = new Date('2026-10-24T14:43:00.000Z');
    expect(configConflictBackupPath('.123ecriture/tasks.json', d, 'cloud')).toBe('.123ecriture/tasks.conflict-cloud-2026-10-24T14-43-00-000Z.json');
    expect(isHashableRelPath(configConflictBackupPath('.123ecriture/tasks.json', d, 'cloud'))).toBe(false);
  });
});
