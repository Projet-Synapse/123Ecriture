// Helpers purs de la carte « appareils connectés » d'un coffre distant
// (Paramètres → Coffres distants) — la donnée vit dans la table
// app_123ecriture.vault_devices, heartbeat par syncEngine à chaque synchro.

export type RemoteVaultDevice = {
  deviceId: string;
  name: string;
  lastSeenAt: string;
};

// « vu·e… » : date relative courte en français. Volontairement simple (pas
// de lib i18n) — seul cet endroit affiche des dates relatives d'appareils.
//  - moins d'une minute → « à l'instant »
//  - moins d'une heure → « il y a N min »
//  - plus tôt dans la même journée → « aujourd'hui »
//  - hier (calendaire) → « hier »
//  - sinon → « le JJ/MM » (+ « /AAAA » si l'année diffère)
export function formatLastSeen(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'date inconnue';
  const elapsedMs = now - then;

  const ONE_MINUTE_MS = 60 * 1000;
  const ONE_HOUR_MS = 60 * ONE_MINUTE_MS;
  if (elapsedMs < ONE_MINUTE_MS) return 'à l’instant';
  if (elapsedMs < ONE_HOUR_MS) return `il y a ${Math.floor(elapsedMs / ONE_MINUTE_MS)} min`;

  // Comparaison CALENDAIRE (pas 24 h glissantes) : un appareil vu à 23 h
  // puis à 1 h du matin est « hier », pas « il y a 2 h » à travers minuit.
  const nowDay = new Date(now);
  const thenDay = new Date(then);
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dayDiff = Math.round((startOfDay(nowDay) - startOfDay(thenDay)) / (24 * 60 * 60 * 1000));
  if (dayDiff === 0) return 'aujourd’hui';
  if (dayDiff === 1) return 'hier';

  const day = String(thenDay.getDate()).padStart(2, '0');
  const month = String(thenDay.getMonth() + 1).padStart(2, '0');
  const sameYear = nowDay.getFullYear() === thenDay.getFullYear();
  return sameYear ? `le ${day}/${month}` : `le ${day}/${month}/${thenDay.getFullYear()}`;
}

// Appareils triés du plus récemment vu au plus ancien : l'appareil ACTIF de
// l'utilisatrice (celui qui vient de heartbeater) apparaît en premier.
export function sortDevicesByLastSeen(devices: RemoteVaultDevice[]): RemoteVaultDevice[] {
  return [...devices].sort((a, b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime());
}
