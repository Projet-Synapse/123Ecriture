import { describe, expect, it } from 'vitest';

import { formatDiagnosticsReport, type DiagnosticsReport } from './diagnostics';

const REPORT: DiagnosticsReport = {
  at: '2026-10-18T20:00:00.000Z',
  platform: 'android',
  device: { id: 'android-abc', name: 'Appareil Android', appVersion: '0.4.76' },
  storagePermission: false,
  activeVaultPath: null,
  vaults: [{ name: '✒️ WORLDBUILDING', path: '/storage/emulated/0/✒️ 123Ecriture', cloudLinked: true, remoteVaultId: 'bbce9f43' }],
  syncStateFileCount: 980,
  pendingReview: { syncBlocked: { at: '2026-10-18T19:00:00.000Z', errorCount: 911, samples: ['…'] } },
  journalTail: [{ t: '2026-10-18T19:00:01.000Z', type: 'error', detail: 'pull bloqué : permission' }],
  collectionErrors: [],
};

describe('formatDiagnosticsReport', () => {
  it('trace appareil, version, permission et coffre actif', () => {
    const text = formatDiagnosticsReport(REPORT);
    expect(text).toContain('Appareil Android');
    expect(text).toContain('v0.4.76');
    expect(text).toContain('REFUSÉE ⚠');
    expect(text).toContain('AUCUN ⚠');
    expect(text).toContain('✒️ WORLDBUILDING');
    expect(text).toContain('980 fichier(s)');
  });

  it('inclut la revue en attente et la fin du journal', () => {
    const text = formatDiagnosticsReport(REPORT);
    expect(text).toContain('Revue en attente');
    expect(text).toContain('Fin du journal de synchronisation');
    expect(text).toContain('pull bloqué');
  });

  it('le rapport est du texte copiable multi-lignes non vide', () => {
    const text = formatDiagnosticsReport(REPORT);
    expect(text.split('\n').length).toBeGreaterThan(4);
  });
});
