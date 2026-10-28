// ✒️ 123ECRITURE — lib/storage/nativeCalendarAdapter.ts — pont Calendrier natif (Android)
//////////////////////////////////////////////////////////////////////////////
//
// Miroir du pont Electron (apps/desktop/electron/calendar.ts) et du pont
// web (webCalendarAdapter, webModulesAdapter.ts) — duplication assumée
// entre paquets (CLAUDE.md). Les évènements vivent dans
// `.123ecriture/events.json` DU COFFRE ACTIF, lus/écrits via
// readNote/writeNote, exactement comme tasks.json (nativeTasksAdapter.ts).
//
// Invariants du fichier :
//   • Même format et mêmes validations que desktop (titre non vide, date
//     AAAA-MM-JJ, `time` null si toute la journée).
//   • JSON cassé à la lecture = sauvegarde `.corrupt-*` dans le coffre
//     avant de repartir à vide — jamais de perte silencieuse.
//   • Jamais de réécriture à contenu identique (writeNoteIfChanged) : pas de
//     faux « modifié » pour la synchro.
//
//////////////////////////////////////////////////////////////////////////////

import { activeVaultAdapter as nativeVaultAdapter } from './vaultBackend';
import { writeNoteIfChanged } from './writeIfChanged';

export const EVENTS_PATH = '.123ecriture/events.json';

// Hermes n'expose pas crypto.randomUUID — identifiant local suffisant.
let idCounter = 0;
function newId(): string {
  idCounter += 1;
  return `e-${Date.now().toString(36)}-${idCounter.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

async function readEvents(): Promise<CalendarEvent[]> {
  let brut: string;
  try {
    brut = await nativeVaultAdapter.readNote(EVENTS_PATH);
  } catch {
    return []; // fichier absent (aucun évènement encore) ou coffre inactif
  }
  try {
    const value: unknown = JSON.parse(brut);
    return Array.isArray(value) ? (value as CalendarEvent[]) : [];
  } catch {
    const sauvegarde = `${EVENTS_PATH}.corrupt-${Date.now()}`;
    try {
      await nativeVaultAdapter.writeNote(sauvegarde, brut);
      console.error(`[calendar] events.json : JSON cassé — contenu sauvegardé dans ${sauvegarde}`);
    } catch {
      console.error('[calendar] events.json : JSON cassé ET sauvegarde impossible');
    }
    return [];
  }
}

async function writeEvents(events: CalendarEvent[]): Promise<CalendarEvent[]> {
  await writeNoteIfChanged(
    (p) => nativeVaultAdapter.readNote(p),
    (p, c) => nativeVaultAdapter.writeNote(p, c),
    EVENTS_PATH,
    JSON.stringify(events, null, 2),
  );
  return events;
}

export const nativeCalendarBridge = {
  listEvents: () => readEvents(),

  addEvent: async (input: CalendarEventInput): Promise<CalendarEvent[]> => {
    const title = (input?.title ?? '').trim();
    if (!title) throw new Error('Le titre de l’évènement ne peut pas être vide.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input?.date ?? '')) {
      throw new Error('Date invalide (attendu AAAA-MM-JJ).');
    }
    const events = await readEvents();
    events.push({
      id: newId(),
      title,
      date: input.date,
      time: input?.allDay ? null : input?.time || null,
      allDay: Boolean(input?.allDay),
      notes: input?.notes ?? '',
      createdAt: new Date().toISOString(),
    });
    return writeEvents(events);
  },

  updateEvent: async (id: string, patch: Partial<CalendarEventInput>): Promise<CalendarEvent[]> => {
    const events = (await readEvents()).map((ev) => (ev.id === id ? { ...ev, ...patch, id: ev.id } : ev));
    return writeEvents(events);
  },

  removeEvent: async (id: string): Promise<CalendarEvent[]> => {
    return writeEvents((await readEvents()).filter((ev) => ev.id !== id));
  },
} satisfies CalendarBridge;
