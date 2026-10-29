import { describe, expect, it, vi } from 'vitest';

import { compareSemver, isNewerVersion, versionCodeFor } from './updaterAndroid';

vi.mock('react-native', () => ({ Platform: { OS: 'android', constants: {} }, Linking: { openURL: vi.fn() } }));

describe('semver de l’updater Android', () => {
  it('segments numériques', () => {
    expect(isNewerVersion('0.4.100', '0.4.9')).toBe(true);
    expect(isNewerVersion('v0.4.95', '0.4.95')).toBe(false);
  });
  it('prérelease : 0.4.96-test.1 n’est PAS plus vieille que 0.4.95', () => {
    expect(isNewerVersion('0.4.95', '0.4.96-test.1')).toBe(false);
    expect(isNewerVersion('0.4.96', '0.4.96-test.2')).toBe(true);
    expect(isNewerVersion('0.4.96-test.1', '0.4.96-test.2')).toBe(false);
    expect(compareSemver('0.4.96-test.12', '0.4.96-test.2')).toBe(1);
  });
  it('jamais proposer une version ≤ installée', () => {
    expect(isNewerVersion('0.4.90', '0.4.95')).toBe(false);
  });
  it('versionCode croissant, -test.2 > 0.4.95', () => {
    expect(versionCodeFor('0.4.95')).toBe(49599);
    expect(versionCodeFor('0.4.96-test.2')).toBe(49602);
    expect(versionCodeFor('0.4.96-test.2')).toBeGreaterThan(versionCodeFor('0.4.95'));
    expect(versionCodeFor('0.4.96')).toBeGreaterThan(versionCodeFor('0.4.96-test.2'));
  });
});
