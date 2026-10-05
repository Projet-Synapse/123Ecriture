import { Linking } from 'react-native';

// Vérification de mise à jour ANDROID — l'équivalent light de l'updater
// desktop (electron-updater + GitHub Releases) : on interroge l'API GitHub
// pour la dernière release publiée et on renvoie sa version + sa page.
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
};

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
  };
  const version = (data.tag_name ?? data.name ?? '').replace(/^v/i, '') || 'inconnue';
  return {
    version,
    url: data.html_url ?? 'https://github.com/Projet-Synapse/123Ecriture/releases',
    publishedAt: data.published_at ?? null,
  };
}

// Ouvre la page de téléchargement dans le navigateur du téléphone.
export function openReleasePage(url: string): void {
  void Linking.openURL(url).catch((error) => {
    console.error('[updater-android] échec de l’ouverture de la page :', error);
  });
}
