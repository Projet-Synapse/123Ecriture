import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  buildMonthGrid,
  compareTimes,
  monthLabel,
  normalizeTimeInput,
  shiftIsoDate,
  WEEKDAY_LABELS,
} from '../lib/calendarDates';
import { useVaults } from '../lib/sync/VaultsContext';
import { usePreferences } from '../preferences/PreferencesContext';

// Écran Calendrier — notes journalières (façon Obsidian, convention de
// chemin `Journal/AAAA-MM-JJ.mdx`, voir vault:ensure-daily-note dans
// apps/desktop/electron/vault.js) ET évènements horodatés (stockage dédié,
// voir apps/desktop/electron/calendar.js) dans la même vue — décision
// prise avec l'utilisatrice en amont. Desktop uniquement pour l'instant
// (window.vault/window.calendar, comme Notes/Tâches).
//
// Les évènements sont éditables en place dans le panneau du jour (✎) :
// titre, heure (normalisée via normalizeTimeInput), déplacement à un
// autre jour — via calendar:update-event, câblé depuis le début côté
// Electron mais jamais exposé dans l'UI avant cette refonte.
type Props = {
  onRequestOpenNote: (relPath: string) => void;
  // Révélation d'un jour demandée par un AUTRE écran (recherche globale,
  // palette de commandes — voir App.tsx, `requestOpenCalendarDate`, résultat
  // "évènement") : navigue vers le bon mois puis ouvre le panneau du jour.
  // Même mécanique que `pendingOpenRelPath` pour les notes.
  pendingOpenDate?: string | null;
  onOpenedPendingDate?: () => void;
};

export function CalendarScreen({ onRequestOpenNote, pendingOpenDate, onOpenedPendingDate }: Props) {
  const { theme } = usePreferences();
  const vault = typeof window !== 'undefined' ? window.vault : undefined;
  const calendarBridge = typeof window !== 'undefined' ? window.calendar : undefined;
  const { activeVaultPath: vaultPath } = useVaults();

  // "Aujourd'hui" en state, rafraîchi toutes les minutes : un simple
  // useMemo([ mounting ]) figeait le jour courant au lancement — une app
  // laissée ouverte passait minuit sans jamais encadrer le nouveau jour
  // ni recaler le bouton "Aujourd'hui".
  const [today, setToday] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setToday(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [tree, setTree] = useState<VaultTreeNode[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [newEventTitle, setNewEventTitle] = useState('');
  const [newEventTime, setNewEventTime] = useState('');
  const [newEventAllDay, setNewEventAllDay] = useState(false);
  const [dayActionError, setDayActionError] = useState<string | null>(null);
  // Édition d'un évènement existant (✎ dans le panneau du jour) — un seul
  // évènement édité à la fois, même idée que `renamingRelPath` de
  // NotesScreen.tsx : les champs portent l'état brouillon, la mutation
  // bridge ne part qu'au "Enregistrer".
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editTime, setEditTime] = useState('');
  const [editDate, setEditDate] = useState('');

  const refresh = useCallback(async () => {
    if (!vault || !calendarBridge) return;
    const [freshTree, freshEvents] = await Promise.all([vault.listTree(), calendarBridge.listEvents()]);
    setTree(freshTree);
    setEvents(freshEvents);
  }, [vault, calendarBridge]);

  useEffect(() => {
    if (!vault || !vaultPath || !calendarBridge) return;
    void (async () => {
      try {
        await refresh();
      } catch (error) {
        console.error('[calendar] échec du chargement initial :', error);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vault, vaultPath, calendarBridge]);

  const handleChooseFolder = async () => {
    if (!vault) return;
    try {
      await vault.chooseFolder();
    } catch (error) {
      console.error('[vault] échec du choix de dossier :', error);
    }
  };

  // Dates AAAA-MM-JJ pour lesquelles une note journalière existe déjà —
  // dérivé de l'arborescence déjà chargée (dossier "Journal"), pas d'appel
  // dédié : `child.name` d'une note EST déjà la date (walkTree retire déjà
  // l'extension .mdx).
  const journalDates = useMemo(() => {
    const journalFolder = tree.find((node) => node.type === 'folder' && node.name === 'Journal');
    if (!journalFolder || journalFolder.type !== 'folder') return new Set<string>();
    return new Set(
      journalFolder.children.filter((child) => child.type === 'note').map((child) => child.name),
    );
  }, [tree]);

  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const ev of events) {
      const list = map.get(ev.date) ?? [];
      list.push(ev);
      map.set(ev.date, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => {
        if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
        return compareTimes(a.time, b.time);
      });
    }
    return map;
  }, [events]);

  const grid = useMemo(() => buildMonthGrid(viewYear, viewMonth, today), [viewYear, viewMonth, today]);

  const goToPrevMonth = () => {
    if (viewMonth === 0) {
      setViewYear((y) => y - 1);
      setViewMonth(11);
    } else {
      setViewMonth((m) => m - 1);
    }
  };

  const goToNextMonth = () => {
    if (viewMonth === 11) {
      setViewYear((y) => y + 1);
      setViewMonth(0);
    } else {
      setViewMonth((m) => m + 1);
    }
  };

  const goToToday = () => {
    setViewYear(today.getFullYear());
    setViewMonth(today.getMonth());
  };

  const openDay = (dateIso: string) => {
    setSelectedDate(dateIso);
    setNewEventTitle('');
    setNewEventTime('');
    setNewEventAllDay(false);
    setDayActionError(null);
    setEditingEventId(null);
  };

  const closeDay = () => setSelectedDate(null);

  // Révèle le jour demandé par un AUTRE écran (voir Props ci-dessus) —
  // navigue d'abord vers le bon mois (le jour demandé peut être hors du mois
  // actuellement affiché), puis ouvre son panneau comme un clic normal sur
  // la cellule (`openDay`).
  useEffect(() => {
    if (!pendingOpenDate) return;
    const [year, month] = pendingOpenDate.split('-').map(Number);
    if (year && month) {
      // Réagit à une demande d'ouverture EXTERNE (prop `pendingOpenDate`,
      // voir App.tsx), pas un état dérivable pendant le rendu — même
      // exception que NotesScreen.tsx pour sa révélation de note active.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setViewYear(year);
      setViewMonth(month - 1);
    }
    openDay(pendingOpenDate);
    onOpenedPendingDate?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingOpenDate]);

  const handleOpenDailyNote = useCallback(async () => {
    if (!vault || !selectedDate) return;
    try {
      const entry = await vault.ensureDailyNote(selectedDate);
      onRequestOpenNote(entry.relPath);
      closeDay();
    } catch (error) {
      console.error('[calendar] échec d’ouverture de la note du jour :', error);
      setDayActionError(error instanceof Error ? error.message : String(error));
    }
  }, [vault, selectedDate, onRequestOpenNote]);

  const handleAddEvent = useCallback(async () => {
    if (!calendarBridge || !selectedDate) return;
    const title = newEventTitle.trim();
    if (!title) return;
    // L'heure est un champ libre : normalisée avant d'entrer dans
    // calendar.json ("9:00" → "09:00", "9h05" → "09:05") — refusée avec
    // message si ça ne ressemble à aucune heure (voir normalizeTimeInput).
    let time: string | null = null;
    if (!newEventAllDay && newEventTime.trim()) {
      const normalized = normalizeTimeInput(newEventTime);
      if (!normalized) {
        setDayActionError('Heure invalide — format attendu HH:MM (ex. 09:30).');
        return;
      }
      time = normalized;
    }
    try {
      setEvents(
        await calendarBridge.addEvent({
          title,
          date: selectedDate,
          allDay: newEventAllDay,
          time,
        }),
      );
      setNewEventTitle('');
      setNewEventTime('');
      setNewEventAllDay(false);
      setDayActionError(null);
    } catch (error) {
      console.error('[calendar] échec de l’ajout de l’évènement :', error);
      setDayActionError(error instanceof Error ? error.message : String(error));
    }
  }, [calendarBridge, selectedDate, newEventTitle, newEventTime, newEventAllDay]);

  const startEditEvent = useCallback((event: CalendarEvent) => {
    setEditingEventId(event.id);
    setEditTitle(event.title);
    setEditTime(event.time ?? '');
    setEditDate(event.date);
    setDayActionError(null);
  }, []);

  const cancelEditEvent = useCallback(() => setEditingEventId(null), []);

  // "Enregistrer" de l'édition (✎) — titre/heure/date d'un coup via
  // calendar:update-event. Titre vide : garde l'ancien plutôt que de
  // créer un évènement sans nom (le champ part prérempli, un effacement
  // accidentel ne doit pas détruire l'information).
  const submitEditEvent = useCallback(
    async (event: CalendarEvent) => {
      if (!calendarBridge) return;
      let time: string | null = null;
      if (!event.allDay && editTime.trim()) {
        const normalized = normalizeTimeInput(editTime);
        if (!normalized) {
          setDayActionError('Heure invalide — format attendu HH:MM (ex. 09:30).');
          return;
        }
        time = normalized;
      }
      try {
        setEvents(
          await calendarBridge.updateEvent(event.id, {
            title: editTitle.trim() || event.title,
            date: editDate,
            ...(event.allDay ? {} : { time }),
          }),
        );
        setEditingEventId(null);
        setDayActionError(null);
      } catch (error) {
        console.error('[calendar] échec de l’édition de l’évènement :', error);
        setDayActionError(error instanceof Error ? error.message : String(error));
      }
    },
    [calendarBridge, editTitle, editTime, editDate],
  );

  const handleRemoveEvent = useCallback(
    async (id: string) => {
      if (!calendarBridge) return;
      try {
        setEvents(await calendarBridge.removeEvent(id));
        if (editingEventId === id) setEditingEventId(null);
      } catch (error) {
        // Affiché dans le panneau du jour (dayActionError) : avant, l'échec
        // n'était que loggué console — l'évènement semblait indestructible
        // sans explication.
        console.error('[calendar] échec de la suppression de l’évènement :', error);
        setDayActionError(error instanceof Error ? error.message : String(error));
      }
    },
    [calendarBridge, editingEventId],
  );

  if (!vault || !calendarBridge) {
    return (
      <View style={styles.centered}>
        <Text style={[styles.title, { color: theme.text }]}>📅 Calendrier</Text>
        <Text style={[styles.muted, { color: theme.textMuted }]}>
          Disponible sur la version desktop pour l’instant (Phase 2 pour mobile/web).
        </Text>
      </View>
    );
  }

  if (!vaultPath) {
    return (
      <View style={styles.centered}>
        <Text style={[styles.title, { color: theme.text }]}>📅 Calendrier</Text>
        <Text style={[styles.muted, { color: theme.textMuted }]}>
          Choisis un dossier local pour en faire ton vault.
        </Text>
        <Pressable
          onPress={() => void handleChooseFolder()}
          style={[styles.button, { backgroundColor: theme.accent }]}
        >
          <Text style={styles.buttonText}>Choisir un dossier</Text>
        </Pressable>
      </View>
    );
  }

  const selectedDayEvents = selectedDate ? (eventsByDate.get(selectedDate) ?? []) : [];

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={goToPrevMonth} style={styles.navButton}>
          <Text style={[styles.navButtonText, { color: theme.text }]}>‹</Text>
        </Pressable>
        <Text style={[styles.monthLabel, { color: theme.text }]}>{monthLabel(viewYear, viewMonth)}</Text>
        <Pressable onPress={goToNextMonth} style={styles.navButton}>
          <Text style={[styles.navButtonText, { color: theme.text }]}>›</Text>
        </Pressable>
        <Pressable
          onPress={goToToday}
          style={[styles.todayButton, { borderColor: theme.border }]}
        >
          <Text style={{ color: theme.textMuted }}>Aujourd’hui</Text>
        </Pressable>
      </View>

      <View style={styles.weekdaysRow}>
        {WEEKDAY_LABELS.map((label) => (
          <Text key={label} style={[styles.weekdayLabel, { color: theme.textMuted }]}>
            {label}
          </Text>
        ))}
      </View>

      <View style={styles.grid}>
        {grid.map((day) => {
          const dayEvents = eventsByDate.get(day.dateIso) ?? [];
          const hasNote = journalDates.has(day.dateIso);
          return (
            <Pressable
              key={day.dateIso}
              onPress={() => openDay(day.dateIso)}
              style={[
                styles.dayCell,
                { borderColor: theme.border },
                day.isToday && { borderColor: theme.accent, borderWidth: 2 },
              ]}
            >
              <View style={styles.dayCellHeader}>
                <Text style={[styles.dayNumber, { color: day.inCurrentMonth ? theme.text : theme.textMuted }]}>
                  {day.day}
                </Text>
                {hasNote && <Text style={styles.dayNoteDot}>📓</Text>}
              </View>
              {dayEvents.slice(0, 2).map((ev) => (
                <Text
                  key={ev.id}
                  numberOfLines={1}
                  style={[styles.eventChip, { backgroundColor: `${theme.accent}22`, color: theme.text }]}
                >
                  {ev.allDay ? '' : ev.time ? `${ev.time} ` : ''}
                  {ev.title}
                </Text>
              ))}
              {dayEvents.length > 2 && (
                <Text style={[styles.moreEvents, { color: theme.textMuted }]}>+{dayEvents.length - 2}</Text>
              )}
            </Pressable>
          );
        })}
      </View>

      <Modal visible={selectedDate !== null} transparent animationType="fade" onRequestClose={closeDay}>
        <Pressable style={styles.backdrop} onPress={closeDay}>
          <Pressable
            style={[styles.dayPanel, { backgroundColor: theme.surface }]}
            onPress={(e) => e.stopPropagation()}
          >
            <Text style={[styles.dayPanelTitle, { color: theme.text }]}>{selectedDate}</Text>

            <Pressable
              onPress={() => void handleOpenDailyNote()}
              style={[styles.button, { backgroundColor: theme.accent }]}
            >
              <Text style={styles.buttonText}>📓 Ouvrir la note du jour</Text>
            </Pressable>

            {dayActionError && <Text style={styles.error}>⚠️ {dayActionError}</Text>}

            <ScrollView style={styles.dayEventsList}>
              {selectedDayEvents.map((ev) =>
                editingEventId === ev.id ? (
                  <View key={ev.id} style={[styles.dayEventEdit, { borderColor: theme.accent }]}>
                    <TextInput
                      autoFocus
                      value={editTitle}
                      onChangeText={setEditTitle}
                      placeholder="Titre…"
                      placeholderTextColor={theme.textMuted}
                      style={[styles.input, { color: theme.text, borderColor: theme.border }]}
                    />
                    {!ev.allDay && (
                      <TextInput
                        value={editTime}
                        onChangeText={setEditTime}
                        placeholder="HH:MM"
                        placeholderTextColor={theme.textMuted}
                        style={[styles.input, styles.timeInput, { color: theme.text, borderColor: theme.border }]}
                      />
                    )}
                    <View style={styles.editDateRow}>
                      <Text style={[styles.editDateLabel, { color: theme.textMuted }]}>Jour</Text>
                      <Pressable onPress={() => setEditDate((d) => shiftIsoDate(d, -1))} style={styles.navButton}>
                        <Text style={{ color: theme.text }}>◀</Text>
                      </Pressable>
                      <Text style={{ color: theme.text }}>{editDate}</Text>
                      <Pressable onPress={() => setEditDate((d) => shiftIsoDate(d, 1))} style={styles.navButton}>
                        <Text style={{ color: theme.text }}>▶</Text>
                      </Pressable>
                    </View>
                    <View style={styles.editActionsRow}>
                      <Pressable onPress={cancelEditEvent} style={styles.editCancelButton}>
                        <Text style={{ color: theme.textMuted }}>Annuler</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => void submitEditEvent(ev)}
                        style={[styles.button, styles.editSaveButton, { backgroundColor: theme.accent }]}
                      >
                        <Text style={styles.buttonText}>Enregistrer</Text>
                      </Pressable>
                    </View>
                  </View>
                ) : (
                  <View key={ev.id} style={[styles.dayEventRow, { borderColor: theme.border }]}>
                    <Text style={[styles.dayEventText, { color: theme.text }]}>
                      {ev.allDay ? 'Toute la journée' : ev.time || '—'} · {ev.title}
                    </Text>
                    <Pressable
                      onPress={() => startEditEvent(ev)}
                      style={styles.removeButton}
                      accessibilityLabel={`Modifier ${ev.title}`}
                    >
                      <Text style={{ color: theme.textMuted }}>✎</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => void handleRemoveEvent(ev.id)}
                      style={styles.removeButton}
                      accessibilityLabel={`Supprimer ${ev.title}`}
                    >
                      <Text style={{ color: theme.textMuted }}>✕</Text>
                    </Pressable>
                  </View>
                ),
              )}
              {selectedDayEvents.length === 0 && (
                <Text style={[styles.muted, { color: theme.textMuted }]}>Aucun évènement ce jour-là.</Text>
              )}
            </ScrollView>

            <Text style={[styles.formLabel, { color: theme.textMuted }]}>Ajouter un évènement</Text>
            <TextInput
              value={newEventTitle}
              onChangeText={setNewEventTitle}
              placeholder="Titre…"
              placeholderTextColor={theme.textMuted}
              style={[styles.input, { color: theme.text, borderColor: theme.border }]}
            />
            <View style={styles.formRow}>
              {!newEventAllDay && (
                <TextInput
                  value={newEventTime}
                  onChangeText={setNewEventTime}
                  placeholder="HH:MM"
                  placeholderTextColor={theme.textMuted}
                  style={[styles.input, styles.timeInput, { color: theme.text, borderColor: theme.border }]}
                />
              )}
              <Pressable
                onPress={() => setNewEventAllDay((prev) => !prev)}
                style={[
                  styles.allDayToggle,
                  { borderColor: theme.border },
                  newEventAllDay && { backgroundColor: theme.accent, borderColor: theme.accent },
                ]}
              >
                <Text style={{ color: newEventAllDay ? '#fff' : theme.textMuted }}>Toute la journée</Text>
              </Pressable>
            </View>
            <Pressable
              onPress={() => void handleAddEvent()}
              style={[styles.button, { backgroundColor: theme.accent }]}
            >
              <Text style={styles.buttonText}>Ajouter</Text>
            </Pressable>

            <Pressable onPress={closeDay} style={styles.cancelButton}>
              <Text style={{ color: theme.textMuted }}>Fermer</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    maxWidth: 720,
    width: '100%',
    alignSelf: 'center',
    gap: 12,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 12,
  },
  title: {
    fontSize: 22,
    fontWeight: '600',
  },
  muted: {
    fontSize: 14,
    textAlign: 'center',
    maxWidth: 360,
  },
  button: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  navButton: {
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  navButtonText: {
    fontSize: 20,
    fontWeight: '600',
  },
  monthLabel: {
    fontSize: 18,
    fontWeight: '600',
    flex: 1,
  },
  todayButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
  },
  weekdaysRow: {
    flexDirection: 'row',
  },
  weekdayLabel: {
    flex: 1,
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '600',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  dayCell: {
    width: '14.28%',
    minHeight: 84,
    borderWidth: 1,
    padding: 4,
    gap: 2,
  },
  dayCellHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  dayNumber: {
    fontSize: 13,
    fontWeight: '600',
  },
  dayNoteDot: {
    fontSize: 10,
  },
  eventChip: {
    fontSize: 10,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
  },
  moreEvents: {
    fontSize: 10,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayPanel: {
    width: 360,
    maxHeight: '80%',
    borderRadius: 12,
    padding: 16,
    gap: 10,
  },
  dayPanelTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  dayEventsList: {
    maxHeight: 160,
  },
  dayEventRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: 1,
  },
  dayEventText: {
    fontSize: 13,
    flex: 1,
  },
  // Formulaire d'édition d'un évènement (✎) — remplace la ligne le temps
  // de l'édition ; bordure accent pour le distinguer d'une ligne de
  // lecture, même idiome que la ligne de renommage de l'explorateur.
  dayEventEdit: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 8,
    marginVertical: 6,
    gap: 8,
  },
  editDateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  editDateLabel: {
    fontSize: 12,
    marginRight: 4,
  },
  editActionsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    alignItems: 'center',
  },
  editCancelButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  editSaveButton: {
    paddingVertical: 6,
    paddingHorizontal: 14,
  },
  removeButton: {
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  formLabel: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 6,
  },
  formRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    fontSize: 14,
  },
  timeInput: {
    width: 90,
  },
  allDayToggle: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: 'center',
  },
  cancelButton: {
    alignSelf: 'flex-end',
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  error: {
    color: '#dc2626',
    fontSize: 13,
  },
});
