// ✒️ 123ECRITURE — lib/ai/localHttpGuard.ts — HTTP non chiffré : réseau local uniquement
//////////////////////////////////////////////////////////////////////////////
//
// v0.5.1 : l'APK Android autorise le HTTP non chiffré (network security
// config, plugin plugins/withLocalNetworkCleartext.js) pour joindre
// Ollama / LM Studio sur le PC (`http://IP-du-PC:11434`). Android ne sait
// pas limiter ce droit à des PLAGES d'adresses : c'est ce garde-fou, côté
// code, qui refuse tout `http://` hors réseau local. `https://` reste
// accepté partout.
//
// Adresses considérées locales :
//   • IPv4 : 127/8 (boucle), 10/8, 172.16/12, 192.168/16 (réseaux privés),
//     100.64/10 (Tailscale / CGNAT), 169.254/16 (lien local) ;
//   • IPv6 : ::1, fc00::/7 (ULA, Tailscale), fe80::/10 (lien local) ;
//   • noms : localhost, *.localhost, *.local (mDNS), *.ts.net (Tailscale),
//     *.lan, *.home.arpa, et les noms SANS point (nom de machine du réseau
//     local, ex. « bureau-pc »).
//
// Analyse faite À LA MAIN (pas de `new URL().hostname`, incomplet sous
// React Native/Hermes selon les versions). Module pur, testé
// (localHttpGuard.test.ts).
//
//////////////////////////////////////////////////////////////////////////////

function ipv4Parts(host: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.every((p) => p >= 0 && p <= 255) ? parts : null;
}

function isPrivateIpv4([a, b]: number[]): boolean {
  return (
    a === 127 ||
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254)
  );
}

function isPrivateIpv6(host: string): boolean {
  const h = host.toLowerCase();
  if (h === '::1' || /^0*:(0*:)*0*1$/.test(h) || h === '0:0:0:0:0:0:0:1') return true;
  // IPv4 mappée (::ffff:192.168.1.2).
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(h);
  if (mapped) {
    const v4 = ipv4Parts(mapped[1]);
    return !!v4 && isPrivateIpv4(v4);
  }
  const first = h.split(':')[0];
  if (!/^[0-9a-f]{1,4}$/.test(first)) return false;
  const word = parseInt(first.padStart(4, '0'), 16);
  return (word & 0xfe00) === 0xfc00 || (word & 0xffc0) === 0xfe80;
}

// Hôte (sans crochets ni port) appartenant au réseau local ?
export function isLocalNetworkHost(rawHost: string): boolean {
  const host = rawHost.trim().replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (!host) return false;
  if (host.includes(':')) return isPrivateIpv6(host);
  const v4 = ipv4Parts(host);
  if (v4) return isPrivateIpv4(v4);
  if (/^\d+(\.\d+)*$/.test(host)) return false; // IPv4 malformée
  if (!host.includes('.')) return true; // nom de machine du réseau local
  return /(^|\.)(localhost|local|ts\.net|lan|home\.arpa)$/.test(host);
}

// Schéma + hôte d'une URL http(s), analysés sans `URL` ; null si invalide.
export function parseHttpUrl(url: string): { protocol: 'http' | 'https'; host: string } | null {
  const m = /^(https?):\/\/(?:[^@/?#]*@)?(\[[^\]]+\]|[^/:?#]+)(?::\d+)?(?:[/?#]|$)/i.exec(url.trim());
  if (!m) return null;
  return { protocol: m[1].toLowerCase() as 'http' | 'https', host: m[2] };
}

// Lève une erreur lisible pour un `http://` hors réseau local.
export function assertLocalHttpAllowed(url: string): void {
  const parsed = parseHttpUrl(url);
  if (!parsed || parsed.protocol === 'https') return;
  if (isLocalNetworkHost(parsed.host)) return;
  throw new Error(
    `Connexion non chiffrée refusée vers « ${parsed.host} » : http:// n’est autorisé que sur le réseau local ` +
      '(IP du PC comme 192.168.x.x ou 10.x.x.x, Tailscale 100.x.x.x ou *.ts.net, nom .local). ' +
      'Pour un serveur sur Internet, utilise une adresse https://.',
  );
}
