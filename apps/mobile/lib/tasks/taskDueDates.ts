// ✒️ 123ECRITURE — lib/tasks/taskDueDates.ts — dates d'échéance des tâches (logique pure)
//////////////////////////////////////////////////////////////////////////////
//
// Dates d'échéance des tâches — logique pure, sans React ni Electron,
// testée comme lib/calendarDates.ts (même convention d'extraction). Le
// champ d'échéance reste un TextInput libre (pas de date-picker natif
// multiplateforme satisfaisant, même choix assumé que l'heure des
// évènements — voir calendarDates.ts, normalizeTimeInput) : la
// normalisation se fait au commit, et les boutons de raccourci de la fiche
// tâche contournent la saisie libre.
//
// Invariants du fichier :
//   • normalizeDueDateInput vérifie les PLAGES RÉELLES, pas seulement le
//     format ("2026-02-31" est refusé via l'aller-retour Date).
//   • Les comparaisons (via toComparable) se font sur la date ISO
//     (lexicographique = chronologique pour AAAA-MM-JJ), jamais sur des
//     Date partielles (heures/minutes) : une échéance est un JOUR, pas un
//     instant. Sans échéance ou valeur malformée → statut null et fin de
//     tri.
//   • Les formats courts utilisent des tableaux internes (pas
//     Intl.DateTimeFormat) : déterministes et testables quel que soit
//     l'environnement.
//   • Les décalages de jours passent par le constructeur Date (y, m,
//     day+n), pas par un ajout de millisecondes : immunisés contre les
//     heures d'été/hiver (un offset de 24 h saute une heure de trop deux
//     jours par an).
//   • `today` est un paramètre (pas un `new Date()` interne) partout où il
//     influe sur le résultat : tests déterministes.
//
// SOMMAIRE :
//   1. Normalisation de la saisie — normalizeDueDateInput
//   2. Statut vis-à-vis d'aujourd'hui — dueDateStatus
//   3. Format court français — formatDueDate
//   4. Tri — compareByDueDate
//   5. Raccourcis de saisie — isoDateFromOffset
//
//////////////////////////////////////////////////////////////////////////////

export type DueDateStatus = 'overdue' | 'today' | 'upcoming';

//////// 1. Normalisation de la saisie — normalizeDueDateInput ///////////////

// Accepte "AAAA-MM-JJ", "JJ/MM/AAAA" et "JJ-MM-AAAA" (séparateurs / ou -,
// année 4 chiffres) — retourne "AAAA-MM-JJ", ou null si ça ne ressemble à
// aucune date valide (plages réelles vérifiées, pas juste le format :
// "2026-02-31" est refusé via l'aller-retour Date).
export function normalizeDueDateInput(raw: string): string | null {
  const trimmed = raw.trim();
  const iso = trimmed.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  const french = trimmed.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (!iso && !french) return null;
  const [year, month, day] = iso
    ? [Number(iso[1]), Number(iso[2]), Number(iso[3])]
    : [Number(french?.[3]), Number(french?.[2]), Number(french?.[1])];
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// La comparaison se fait sur la date ISO (lexicographique = chronologique
// pour AAAA-MM-JJ) — jamais sur des Date partielles (heures/minutes), une
// échéance est un JOUR, pas un instant.
function toComparable(dueDate: string | null | undefined): string | null {
  return typeof dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dueDate) ? dueDate : null;
}

//////// 2. Statut vis-à-vis d'aujourd'hui — dueDateStatus ///////////////////

// Pilote la couleur du badge d'échéance dans TasksScreen — null si la date
// est absente ou malformée (rien à signaler).
export function dueDateStatus(
  dueDate: string | null | undefined,
  today: Date = new Date(),
): DueDateStatus | null {
  const comparable = toComparable(dueDate);
  if (comparable === null) return null;
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  if (comparable < todayIso) return 'overdue';
  if (comparable === todayIso) return 'today';
  return 'upcoming';
}

//////// 3. Format court français — formatDueDate ////////////////////////////

// "12 sept. 2026" (ou "12 sept." si l'année est celle de `today` — une
// échéance de l'année en cours n'a pas besoin de l'année pour être lue).
// Tableaux internes plutôt qu'Intl.DateTimeFormat : déterministe et testable
// quel que soit l'environnement, même approche que MONTH_NAMES de
// calendarDates.ts.
const MONTHS_SHORT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

export function formatDueDate(dueDate: string, today: Date = new Date()): string {
  const comparable = toComparable(dueDate);
  if (comparable === null) return dueDate;
  const [year, month, day] = comparable.split('-').map(Number);
  const withYear = year !== today.getFullYear();
  return `${day} ${MONTHS_SHORT[month - 1]}${withYear ? ` ${year}` : ''}`;
}

//////// 4. Tri — compareByDueDate ///////////////////////////////////////////

// Tri croissant, sans échéance en fin de liste — stable (compare 0 entre
// égaux) pour ne pas mélanger l'ordre d'ajout des tâches non planifiées.
export function compareByDueDate(a: string | null | undefined, b: string | null | undefined): number {
  const ca = toComparable(a);
  const cb = toComparable(b);
  if (ca === null && cb === null) return 0;
  if (ca === null) return 1;
  if (cb === null) return -1;
  return ca < cb ? -1 : ca > cb ? 1 : 0;
}

//////// 5. Raccourcis de saisie — isoDateFromOffset /////////////////////////

// Date ISO (AAAA-MM-JJ) décalée de `days` jours par rapport à `today` —
// pilote les boutons de raccourci d'échéance de TasksScreen ("Aujourd'hui",
// "Demain", "+7 j") sans passer par la saisie libre. Passage par le
// constructeur (y, m, day+n) plutôt que par un ajout de millisecondes :
// immunise contre les heures d'été/hiver (un offset de 24 h saute une heure
// de trop deux jours par an). `today` en paramètre, même convention
// testable que dueDateStatus.
export function isoDateFromOffset(days: number, today: Date = new Date()): string {
  const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
