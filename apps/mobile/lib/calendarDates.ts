// Calcul de la grille d'un mois pour le Calendrier — logique pure, sans
// React ni Electron, testée comme lib/sync/diff.ts.

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
