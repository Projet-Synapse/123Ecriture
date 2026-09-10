// Calcul de la grille d'un mois pour le Calendrier — logique pure, sans
// React ni Electron, testée comme lib/sync/diff.ts.
//
// //1. Grille du mois (buildMonthGrid + helpers de format).
// //2. Heures d'évènement (normalizeTimeInput, compareTimes) et décalage
//      de jour (shiftIsoDate) — introduits avec l'édition d'évènements de
//      CalendarScreen.tsx : l'heure y était un champ texte libre où "9:00"
//      passait, s'affichait mal ET cassait le tri (comparaison lexicale
//      où "9:00" > "10:00").

export type CalendarDay = {
  dateIso: string; // AAAA-MM-JJ
  day: number; // 1-31
  inCurrentMonth: boolean;
  isToday: boolean;
};

export const WEEKDAY_LABELS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

const MONTH_NAMES = [
  'Janvier',
  'Février',
  'Mars',
  'Avril',
  'Mai',
  'Juin',
  'Juillet',
  'Août',
  'Septembre',
  'Octobre',
  'Novembre',
  'Décembre',
];

export function toIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function monthLabel(year: number, month: number): string {
  return `${MONTH_NAMES[month]} ${year}`;
}

// Grille fixe de 6 semaines × 7 jours (toujours 42 cases, même hauteur
// visuelle d'un mois à l'autre) — semaines commençant le lundi. `today` est
// un paramètre (pas `new Date()` interne) pour rester testable de façon
// déterministe.
export function buildMonthGrid(year: number, month: number, today: Date = new Date()): CalendarDay[] {
  const firstOfMonth = new Date(year, month, 1);
  // Date#getDay() : 0=dimanche..6=samedi — on veut 0=lundi..6=dimanche.
  const firstWeekday = (firstOfMonth.getDay() + 6) % 7;
  const gridStart = new Date(year, month, 1 - firstWeekday);
  const todayIso = toIsoDate(today);

  const days: CalendarDay[] = [];
  for (let i = 0; i < 42; i += 1) {
    const date = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
    const dateIso = toIsoDate(date);
    days.push({
      dateIso,
      day: date.getDate(),
      inCurrentMonth: date.getMonth() === month,
      isToday: dateIso === todayIso,
    });
  }
  return days;
}

// //2. ⏰ HEURES D'ÉVÈNEMENT + DÉCALAGE DE JOUR
// //////////////////////////////////////////////////////////////////////

// Normalise une saisie d'heure libre en "HH:MM" 24h — accepte "9:00",
// "09:00", "9h05", "9 5"… et retourne null si ça ne ressemble à aucune
// heure valide (plage incluse : 0-23 h, 0-59 min). Utilisé à l'AJOUT et à
// l'ÉDITION d'évènement : le champ reste un TextInput libre (pas de
// time-picker natif multiplateforme satisfaisant), mais plus rien
// d'invalide ne peut plus entrer dans calendar.json.
export function normalizeTimeInput(raw: string): string | null {
  const match = raw.trim().match(/^(\d{1,2})\s*[:hH]?\s*(\d{0,2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = match[2] === '' ? 0 : Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function timeToMinutes(time: string): number | null {
  const match = time.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

// Compare deux heures "HH:MM" NUMÉRIQUEMENT (pas lexicalement) — "9:00"
// doit passer avant "10:00". null = pas d'heure : passe en dernier ; une
// valeur malformée (vieille donnée écrite avant la normalisation) passe
// avant null mais après toute heure valide. `a.time ?? ''` + localeCompare
// restait l'ancien comportement : conservé ici en repli, corrigé pour
// tout le reste.
export function compareTimes(a: string | null, b: string | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  const aMinutes = timeToMinutes(a);
  const bMinutes = timeToMinutes(b);
  if (aMinutes === null && bMinutes === null) return a.localeCompare(b);
  if (aMinutes === null) return 1;
  if (bMinutes === null) return -1;
  return aMinutes - bMinutes;
}

// Décale une date AAAA-MM-JJ de `days` jours (peut être négatif) — passe
// par Date locale (pas UTC) pour que le 1er mars après le 28 février d'une
// année bissextile reste juste ; les changements d'heure DST ne peuvent
// pas faire sauter un jour entier, au pire décaler l'heure interne.
export function shiftIsoDate(dateIso: string, days: number): string {
  const [year, month, day] = dateIso.split('-').map(Number);
  const shifted = new Date(year, month - 1, day + days);
  return toIsoDate(shifted);
}
