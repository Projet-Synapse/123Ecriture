// ✒️ 123ECRITURE — lib/sync/devices.ts — carte « appareils connectés » d'un coffre distant
//////////////////////////////////////////////////////////////////////////////
//
// Helpers purs de la carte « appareils connectés » d'un coffre distant
// (Paramètres → Coffres distants) : dates relatives lisibles, tri par
// activité, résumé du dernier cycle. La donnée vit dans la table
// app_123ecriture.vault_devices, heartbeat par syncEngine à chaque synchro.
//
// Invariants du fichier :
//   • Pur et sans accès réseau ni base : ce module ne lit/écrit rien —
//     le heartbeat et l'écriture des lignes vivent dans syncEngine.ts.
//   • Les colonnes d'observabilité sont OPTIONNELLES : absentes tant que
//     la migration n'est pas appliquée, vides pour les appareils restés
//     sur une version antérieure — tout le code tolère null/undefined.
//   • Les dates relatives comparent calendairement (pas 24 h glissantes) :
//     un appareil vu à 23 h puis à 1 h du matin est « hier ».
//
// SOMMAIRE :
//   1. Le type d'un appareil distant (RemoteVaultDevice)
//   2. Les libellés lisibles (formatLastSeen, sortDevicesByLastSeen, formatLastCycle)
//
//////////////////////////////////////////////////////////////////////////////

//////// 1. Le type d'un appareil distant (RemoteVaultDevice) ///////////

export type RemoteVaultDevice = {
  deviceId: string;
  name: string;
  lastSeenAt: string;
  // Observabilité (« donner des yeux au vault ») : colonnes OPTIONNELLES —
  // absentes tant que la migration
  // 20261017120000_vault_devices_observability.sql n'a pas été appliquée,
  // et vides pour les appareils restés sur une version antérieure.
  appVersion?: string | null;
  lastCycleAt?: string | null;
  lastCyclePushed?: number | null;
  lastCyclePulled?: number | null;
  lastCycleDeleted?: number | null;
  lastCycleConflicts?: number | null;
  lastCycleErrors?: number | null;
  // Verrou à distance (migration 20261017200000).
  locked?: boolean | null;
  lockReason?: string | null;
};

//////// 2. Les libellés lisibles (formatLastSeen, sortDevicesByLastSeen, formatLastCycle) ///////////

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

// « Dernier cycle il y a N min : X envoyé(s), Y reçu(s)… » — le résumé de
// l'activité de sync d'un appareil, vu par TOUS les autres appareils (sans
// cela, l'activité n'est consignée que dans le journal LOCAL de chaque
// machine : aucune observabilité croisée). null si l'appareil n'a pas de
// dernier cycle consigné.
export function formatLastCycle(device: RemoteVaultDevice, now: number = Date.now()): string | null {
  if (!device.lastCycleAt) return null;
  const parts = [
    `${device.lastCyclePushed ?? 0} envoyé(s)`,
    `${device.lastCyclePulled ?? 0} reçu(s)`,
    `${device.lastCycleDeleted ?? 0} supprimé(s)`,
    `${device.lastCycleConflicts ?? 0} conflit(s)`,
  ];
  const erreurs = device.lastCycleErrors ?? 0;
  if (erreurs > 0) parts.push(`${erreurs} erreur(s)`);
  return `dernier cycle ${formatLastSeen(device.lastCycleAt, now)} : ${parts.join(', ')}`;
}
