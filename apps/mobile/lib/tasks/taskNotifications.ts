// Rappels locaux d'échéance des tâches (mobile natif uniquement). Même
// principe que les rappels Obsidian/Todoist : quand une tâche non terminée
// porte une échéance, une notification est planifiée AU NIVEAU DU SYSTÈME
// (AlarmManager via expo-notifications) le jour J à l'heure configurée —
// elle part même si l'app est fermée. Replanifiée à chaque changement des
// tâches (ajout, coche, suppression, changement d'échéance) : la source de
// vérité reste .123ecriture/tasks.json du coffre, les notifications ne
// sont qu'une projection.
//
// Limite assumée v1 : la replanification se fait au passage dans l'écran
// Tâches (et au changement de réglage) — une échéance créée puis jamais
// revue ne déclenche pas de rappel tant que l'écran n'a pas été rouvert.
// Les rappels DÉJÀ planifiés, eux, partent sans ouvrir l'app.

import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

// Afficher même au premier plan (sinon la notif ne serait visible que
// l'app en arrière-plan) — sans son, la v1 reste discrète.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

// Préfixe réservé à CE module : la resynchronisation n'annule jamais les
// notifications d'un autre module futur qui partagerait le scheduler.
const IDENTIFIER_PREFIX = 'task-due-';

export function parseNotifyTime(time: string): { hours: number; minutes: number } {
  const match = /^(\d{1,2}):(\d{2})$/.exec((time ?? '').trim());
  if (!match) return { hours: 9, minutes: 0 };
  const hours = Math.min(23, Math.max(0, Number(match[1])));
  const minutes = Math.min(59, Math.max(0, Number(match[2])));
  return { hours, minutes };
}

export function isValidNotifyTime(time: string): boolean {
  return /^\d{1,2}:\d{2}$/.test((time ?? '').trim());
}

export async function getNotificationsPermission(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  const asked = await Notifications.requestPermissionsAsync();
  return Boolean(asked.granted);
}

// « AAAA-MM-JJ » (format stocké, voir normalizeDueDateInput) → Date locale
// à l'heure de rappel configurée ; null si la date est invalide ou déjà
// passée (pas de rappel rattrapé : une échéance d'hier ne sert plus).
function reminderDate(dueDate: string, hours: number, minutes: number): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dueDate.trim());
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), hours, minutes, 0, 0);
  if (Number.isNaN(date.getTime())) return null;
  return date.getTime() > Date.now() ? date : null;
}

// Resynchronise TOUTES les notifications d'échéance avec les tâches et le
// réglage courants : annule les rappels périmés (tâche cochée, échéance
// retirée/dépassée, rappels désactivés) et planifie les manquants. Idempotent
// : appelé à chaque rendu utile de TasksScreen, il ne fait rien si rien n'a
// changé côté planification (les Date identiques sont ré-écrites — bénin).
// Retourne le nombre de rappels planifiés (-1 si la permission manque).
export async function syncTaskDueNotifications(tasks: Task[], enabled: boolean, time: string): Promise<number> {
  if (Platform.OS === 'web') return 0;
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled
      .filter((entry) => entry.identifier.startsWith(IDENTIFIER_PREFIX))
      .map((entry) => Notifications.cancelScheduledNotificationAsync(entry.identifier)),
  );
  if (!enabled) return 0;
  if (!(await Notifications.getPermissionsAsync()).granted) return -1;
  const { hours, minutes } = parseNotifyTime(time);
  let planned = 0;
  for (const task of tasks) {
    if (task.done || !task.dueDate) continue;
    const date = reminderDate(task.dueDate, hours, minutes);
    if (!date) continue;
    await Notifications.scheduleNotificationAsync({
      identifier: `${IDENTIFIER_PREFIX}${task.id}`,
      content: {
        title: '⏰ Échéance de tâche',
        body: task.text,
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date },
    });
    planned += 1;
  }
  return planned;
}
