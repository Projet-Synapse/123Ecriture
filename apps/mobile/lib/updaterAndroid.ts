import { Linking, Platform } from 'react-native';

// Vérification de mise à jour ANDROID — l'équivalent light de l'updater
// desktop (electron-updater + GitHub Releases) : on interroge l'API GitHub
// pour la dernière release publiée et on renvoie sa version, sa page et le
// lien direct de l'APK.
//
// Pourquoi pas de téléchargement/installation in-app : l'installation d'un
// APK par une app requiert des permissions système spécifiques
// (REQUEST_INSTALL_PACKAGES + validation utilisateur par version
// d'Android) — le flux standard, fiable sur tous les téléphones, est
// d'ouvrir la page GitHub Releases où l'APK est téléchargeable.
const RELEASES_API = 'https://api.github.com/repos/Projet-Synapse/123Ecriture/releases/latest';

export type LatestRelease = {
  version: string;
  url: string;
  publishedAt: string | null;
  // Lien direct de l'APK joint à la release (null si absent) — ouvre le
  // téléchargement sans passer par la page.
  apkUrl: string | null;
};

// Version INSTALLÉE sur le téléphone : module natif expo-application
// (nativeApplicationVersion = versionName, nativeBuildVersion =
// versionCode), lu via le registre global des modules Expo — aucun import
// statique, ce fichier reste partagé avec le desktop. Repli :
// Platform.constants.appVersion. null si indisponible (web, desktop).
type ExpoApplicationModule = { nativeApplicationVersion?: string | null; nativeBuildVersion?: string | null };
function expoApplication(): ExpoApplicationModule | null {
  const g = globalThis as { expo?: { modules?: Record<string, unknown> } };
  const mod = g.expo?.modules?.ExpoApplication as ExpoApplicationModule | undefined;
  return mod ?? null;
}

export function installedAppVersion(): string | null {
  if (Platform.OS !== 'android') return null;
  const native = expoApplication()?.nativeApplicationVersion;
  if (typeof native === 'string' && native) return native;
  const constants = Platform.constants as { appVersion?: string };
  return typeof constants.appVersion === 'string' && constants.appVersion ? constants.appVersion : null;
}

export function installedBuildNumber(): number | null {
  if (Platform.OS !== 'android') return null;
  const raw = expoApplication()?.nativeBuildVersion;
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) ? n : null;
}

// SEMVER RÉEL (prérelease comprise) : 0.4.9 < 0.4.54 < 0.4.100 ;
// 0.4.96-test.1 < 0.4.96 ; 0.4.95 < 0.4.96-test.1 (une -test de la version
// SUIVANTE n'est pas plus vieille que la stable précédente).
type SemVer = { core: number[]; pre: (string | number)[] };
export function parseSemver(v: string): SemVer {
  const clean = v.trim().replace(/^v/i, '').split('+')[0];
  const dash = clean.indexOf('-');
  const coreStr = dash >= 0 ? clean.slice(0, dash) : clean;
  const preStr = dash >= 0 ? clean.slice(dash + 1) : '';
  const core = coreStr.split('.').map((x) => parseInt(x, 10) || 0);
  while (core.length < 3) core.push(0);
  const pre = preStr ? preStr.split('.').map((x) => (/^\d+$/.test(x) ? parseInt(x, 10) : x)) : [];
  return { core, pre };
}

export function compareSemver(a: string, b: string): number {
  const x = parseSemver(a);
  const y = parseSemver(b);
  for (let i = 0; i < Math.max(x.core.length, y.core.length); i += 1) {
    const d = (x.core[i] ?? 0) - (y.core[i] ?? 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  if (!x.pre.length && !y.pre.length) return 0;
  if (!x.pre.length) return 1; // stable > prérelease du même noyau
  if (!y.pre.length) return -1;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i += 1) {
    const l = x.pre[i];
    const r = y.pre[i];
    if (l === undefined) return -1;
    if (r === undefined) return 1;
    if (l === r) continue;
    if (typeof l === 'number' && typeof r === 'number') return l > r ? 1 : -1;
    if (typeof l === 'number') return -1;
    if (typeof r === 'number') return 1;
    return l > r ? 1 : -1;
  }
  return 0;
}

// true si `candidate` est STRICTEMENT plus récente que `installed`.
export function isNewerVersion(candidate: string, installed: string): boolean {
  return compareSemver(candidate, installed) > 0;
}

// versionCode Android dérivé de la version (même formule que le workflow
// build-android-apk.yml) : major*10000 + minor*100 + patch, ×100 + rang de
// prérelease (stable = 99). 0.4.95 → 49599 ; 0.4.96-test.2 → 49602.
export function versionCodeFor(version: string): number {
  const { core, pre } = parseSemver(version);
  const base = core[0] * 10000 + core[1] * 100 + core[2];
  const last = pre.length ? pre[pre.length - 1] : null;
  const rank = pre.length ? (typeof last === 'number' ? Math.min(98, last) : 1) : 99;
  return base * 100 + rank;
}

export async function fetchLatestRelease(): Promise<LatestRelease> {
  const response = await fetch(RELEASES_API, { headers: { Accept: 'application/vnd.github+json' } });
  if (!response.ok) {
    throw new Error(`Recherche impossible (HTTP ${response.status}).`);
  }
  const data = (await response.json()) as {
    draft?: boolean;
    prerelease?: boolean;
    tag_name?: string;
    name?: string;
    html_url?: string;
    published_at?: string;
    assets?: { name?: string; browser_download_url?: string }[];
  };
  // /releases/latest ne renvoie déjà ni brouillon ni prérelease ; garde-fou
  // explicite quand même (jamais proposer une -test).
  if (data.draft || data.prerelease) throw new Error('Aucune version stable publiée.');
  const version = (data.tag_name ?? data.name ?? '').replace(/^v/i, '') || 'inconnue';
  const apkAsset = (data.assets ?? []).find((asset) => asset.name === '123Ecriture.apk');
  return {
    version,
    url: data.html_url ?? 'https://github.com/Projet-Synapse/123Ecriture/releases',
    publishedAt: data.published_at ?? null,
    apkUrl: apkAsset?.browser_download_url ?? null,
  };
}

// Ouvre une URL dans le navigateur du téléphone (page de release ou APK
// direct — le navigateur télécharge le fichier, l'installation se fait
// ensuite en l'ouvrant depuis les notifications).
export function openUrl(url: string): void {
  void Linking.openURL(url).catch((error) => {
    console.error('[updater-android] échec de l’ouverture :', error);
  });
}
