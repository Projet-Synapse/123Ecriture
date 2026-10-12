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

// Version INSTALLÉE sur le téléphone : Platform.constants.appVersion expose
// le versionName Android (RN embarque ce dictionnaire natif — pas besoin
// d'expo-constants). Retourne null si indisponible (web, formats exotiques).
export function installedAppVersion(): string | null {
  if (Platform.OS !== 'android') return null;
  const constants = Platform.constants as { appVersion?: string };
  return typeof constants.appVersion === 'string' && constants.appVersion ? constants.appVersion : null;
}

// Comparaison segmentée : 0.4.9 < 0.4.54 < 0.4.100 (une comparaison de
// chaînes classerait « 0.4.100 » avant « 0.4.9 »). Retourne true si
// `candidate` est strictement plus récente que `installed`.
export function isNewerVersion(candidate: string, installed: string): boolean {
  const parse = (v: string) => v.replace(/^v/i, '').split('.').map((segment) => parseInt(segment, 10) || 0);
  const a = parse(candidate);
  const b = parse(installed);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const left = a[i] ?? 0;
    const right = b[i] ?? 0;
    if (left !== right) return left > right;
  }
  return false;
}

export async function fetchLatestRelease(): Promise<LatestRelease> {
  const response = await fetch(RELEASES_API, { headers: { Accept: 'application/vnd.github+json' } });
  if (!response.ok) {
    throw new Error(`Recherche impossible (HTTP ${response.status}).`);
  }
  const data = (await response.json()) as {
    tag_name?: string;
    name?: string;
    html_url?: string;
    published_at?: string;
    assets?: { name?: string; browser_download_url?: string }[];
  };
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
