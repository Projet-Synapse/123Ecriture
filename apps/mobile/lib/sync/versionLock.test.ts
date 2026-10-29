import { describe, expect, it } from 'vitest';

import {
  buildNextReference,
  isMissingRpcError,
  isVersionConflictError,
  parseLockResult,
  parseSyncState,
  VersionConflictError,
} from './versionLock';

describe('parseLockResult', () => {
  it('lit une réponse acceptée', () => {
    expect(parseLockResult({ ok: true, conflict: false, current_version: 3, current_hash: 'h', deleted: false })).toEqual({
      ok: true, conflict: false, currentVersion: 3, currentHash: 'h', deleted: false,
    });
  });
  it('lit un conflit sur pierre tombale', () => {
    const r = parseLockResult({ ok: false, conflict: true, current_version: '7', current_hash: 'x', deleted: true });
    expect(r.ok).toBe(false);
    expect(r.currentVersion).toBe(7);
    expect(r.deleted).toBe(true);
  });
  it('réponse illisible = refus (jamais un écrit présumé accepté)', () => {
    expect(parseLockResult(null).ok).toBe(false);
    expect(parseLockResult('oops').conflict).toBe(true);
  });
});

describe('isMissingRpcError', () => {
  it('reconnaît la RPC absente', () => {
    expect(isMissingRpcError({ code: 'PGRST202' })).toBe(true);
    expect(isMissingRpcError({ message: 'Could not find the function app.push_file' })).toBe(true);
  });
  it('ne confond pas une vraie erreur (RLS, réseau)', () => {
    expect(isMissingRpcError({ code: '42501', message: 'permission denied' })).toBe(false);
    expect(isMissingRpcError(null)).toBe(false);
  });
});

describe('VersionConflictError', () => {
  it('est reconnu', () => {
    const e = new VersionConflictError('a.md', parseLockResult({ ok: false, current_version: 2 }));
    expect(isVersionConflictError(e)).toBe(true);
    expect(isVersionConflictError(new Error('x'))).toBe(false);
  });
});

describe('parseSyncState (migration d’état)', () => {
  it('jette les références .trash/ (plus synchronisé)', () => {
    const s = parseSyncState(JSON.stringify({ files: { '.trash/a.md': 'h', 'b.md': 'h2' }, versions: { '.trash/a.md': 3 } }));
    expect(s.files).toEqual({ 'b.md': 'h2' });
    expect(s.versions).toEqual({});
  });
  it('accepte l’ancien format sans versions', () => {
    const s = parseSyncState(JSON.stringify({ files: { 'a.md': 'h1' }, rootPath: '/v' }));
    expect(s).toEqual({ files: { 'a.md': 'h1' }, versions: {}, rootPath: '/v' });
  });
  it('lit les versions et jette backslash / valeurs invalides / orphelines', () => {
    const s = parseSyncState(
      JSON.stringify({
        files: { 'a.md': 'h1', 'b\\c.md': 'h2', 'd.md': 'h3' },
        versions: { 'a.md': 4, 'd.md': 'x', 'orphan.md': 2 },
      }),
    );
    expect(s.files).toEqual({ 'a.md': 'h1', 'd.md': 'h3' });
    expect(s.versions).toEqual({ 'a.md': 4 });
  });
});

describe('buildNextReference', () => {
  const previous = { files: { 'a.md': 'old', 'b.md': 'b0' }, versions: { 'a.md': 2, 'b.md': 5 } };
  it('conserve l’ancienne référence d’un chemin non confirmé (échec/conflit)', () => {
    const r = buildNextReference({
      candidateFiles: { 'a.md': 'local-new', 'b.md': 'b1' },
      previous,
      keepPrevious: new Set(['a.md']),
      pushedVersions: { 'b.md': 6 },
      remoteVersions: {},
    });
    expect(r.files).toEqual({ 'a.md': 'old', 'b.md': 'b1' });
    expect(r.versions).toEqual({ 'a.md': 2, 'b.md': 6 });
  });
  it('un chemin non confirmé sans référence précédente reste sans référence', () => {
    const r = buildNextReference({
      candidateFiles: { 'n.md': 'h' },
      previous,
      keepPrevious: new Set(['n.md']),
      pushedVersions: {},
      remoteVersions: {},
    });
    expect(r.files).toEqual({});
  });
  it('prend la version distante pour noop/pull', () => {
    const r = buildNextReference({
      candidateFiles: { 'c.md': 'h' },
      previous,
      keepPrevious: new Set(),
      pushedVersions: {},
      remoteVersions: { 'c.md': 9 },
    });
    expect(r.versions).toEqual({ 'c.md': 9 });
  });
});
