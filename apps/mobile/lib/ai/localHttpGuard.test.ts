import { describe, expect, it } from 'vitest';

import { normalizeEllieBaseUrl } from './ellieSettings';
import { assertLocalHttpAllowed, isLocalNetworkHost, parseHttpUrl } from './localHttpGuard';

describe('garde-fou HTTP local', () => {
  it('adresses locales acceptées', () => {
    for (const h of [
      '127.0.0.1', '127.5.5.5', '10.0.2.2', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.42',
      '100.64.0.1', '100.101.102.103', '100.127.255.254', '169.254.1.1',
      '::1', '[::1]', 'fd7a:115c:a1e0::1', 'fc00::1', 'fe80::1', '::ffff:192.168.0.2',
      'localhost', 'pc.local', 'mon-pc.tail1234.ts.net', 'bureau-pc', 'nas.lan', 'box.home.arpa',
    ]) {
      expect(isLocalNetworkHost(h), h).toBe(true);
    }
  });

  it('adresses publiques refusées', () => {
    for (const h of [
      '8.8.8.8', '172.15.0.1', '172.32.0.1', '192.169.1.1', '100.63.255.255', '100.128.0.1', '11.0.0.1',
      '2001:4860::8888', '::ffff:8.8.8.8', 'example.com', 'ollama.example.org', 'local.example.com', '999.1.1.1', '1.2.3',
    ]) {
      expect(isLocalNetworkHost(h), h).toBe(false);
    }
  });

  it('analyse d’URL sans URL()', () => {
    expect(parseHttpUrl('http://192.168.1.10:11434/api')).toEqual({ protocol: 'http', host: '192.168.1.10' });
    expect(parseHttpUrl('HTTPS://[fd00::2]:1234')).toEqual({ protocol: 'https', host: '[fd00::2]' });
    expect(parseHttpUrl('ftp://x')).toBeNull();
  });

  it('http:// public refusé avec un message clair ; https:// partout OK', () => {
    expect(() => assertLocalHttpAllowed('http://192.168.1.10:11434')).not.toThrow();
    expect(() => assertLocalHttpAllowed('http://mon-pc.tail1234.ts.net:11434')).not.toThrow();
    expect(() => assertLocalHttpAllowed('https://ollama.example.org')).not.toThrow();
    expect(() => assertLocalHttpAllowed('http://ollama.example.org')).toThrow(/non chiffrée refusée.*https:\/\//);
    expect(() => assertLocalHttpAllowed('http://8.8.8.8:11434')).toThrow(/réseau local/);
  });

  it('appliqué à l’URL d’Ellie', () => {
    expect(normalizeEllieBaseUrl('http://192.168.1.10:11434/')).toBe('http://192.168.1.10:11434');
    expect(() => normalizeEllieBaseUrl('http://example.com:11434')).toThrow(/non chiffrée refusée/);
    expect(normalizeEllieBaseUrl('https://example.com/v1')).toBe('https://example.com');
  });
});
