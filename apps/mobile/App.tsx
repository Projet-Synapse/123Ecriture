import { StatusBar } from 'expo-status-bar';
import { useCallback, useRef, useState } from 'react';

import { AppShell, type NotesActions } from './components/AppShell';
import { CalendarScreen } from './components/CalendarScreen';
import { NotesScreen } from './components/NotesScreen';
import { SettingsScreen } from './components/SettingsScreen';
import { TasksScreen } from './components/TasksScreen';
import { toIsoDate } from './lib/calendarDates';
import { AuthProvider } from './lib/sync/AuthContext';
import { SyncStatusProvider } from './lib/sync/SyncStatusContext';
import { VaultsProvider } from './lib/sync/VaultsContext';
import { SECTIONS } from './navigation';
import { PreferencesProvider } from './preferences/PreferencesContext';

function Root() {
  const [activeId, setActiveId] = useState(SECTIONS[0].id);

  // Mécanisme partagé "ouvrir cet élément" depuis un autre écran (recherche
  // globale, palette de commandes, "Ouvrir la note du jour" du Calendrier —
  // une carte-note de Canvas, elle, s'ouvre directement DANS NotesScreen
  // puisque Canvas y est maintenant embarqué en tant que type de fichier,
  // plus besoin de ce mécanisme pour ce cas) : on bascule sur le bon onglet
  // ET on note QUOI ouvrir ; l'écran cible le consomme dans un effet dès que
  // ça change, puis prévient qu'il l'a fait pour qu'on le remette à null —
  // sinon rouvrir le même onglet sans repasser par ailleurs redéclencherait
  // l'ouverture à chaque fois. Trois champs PARALLÈLES (note/tâche/
  // évènement) plutôt qu'un `pendingOpen` discriminé unique : garde le
  // mécanisme historique `pendingOpenRelPath` intact (aucune régression sur
  // "Ouvrir la note du jour", déjà en prod) tout en l'étendant proprement
  // aux deux nouvelles cibles.
  const [pendingOpenRelPath, setPendingOpenRelPath] = useState<string | null>(null);
  const requestOpenNote = useCallback((relPath: string) => {
    setPendingOpenRelPath(relPath);
    setActiveId('notes');
  }, []);
  const clearPendingOpenNote = useCallback(() => setPendingOpenRelPath(null), []);

  const [pendingOpenTask, setPendingOpenTask] = useState<{ taskListId: string; taskId: string } | null>(null);
  const requestOpenTask = useCallback((taskListId: string, taskId: string) => {
    setPendingOpenTask({ taskListId, taskId });
    setActiveId('tasks');
  }, []);
  const clearPendingOpenTask = useCallback(() => setPendingOpenTask(null), []);

  const [pendingOpenCalendarDate, setPendingOpenCalendarDate] = useState<string | null>(null);
  const requestOpenCalendarDate = useCallback((date: string) => {
    setPendingOpenCalendarDate(date);
    setActiveId('calendar');
  }, []);
  const clearPendingOpenCalendarDate = useCallback(() => setPendingOpenCalendarDate(null), []);

  // « Nouvelle tâche » (palette de commandes) : bascule sur l'écran Tâches
  // et lui signale de focusser son champ de création. Un COMPTEUR plutôt
  // qu'un booléen : redemander la création alors qu'on est déjà sur
  // Tâches doit re-déclencher l'effet de focus côté TasksScreen, ce
  // qu'un booléen déjà à true ne permettrait pas.
  const [pendingNewTaskToken, setPendingNewTaskToken] = useState(0);
  const requestNewTask = useCallback(() => {
    setPendingNewTaskToken((token) => token + 1);
    setActiveId('tasks');
  }, []);
  const clearPendingNewTask = useCallback(() => setPendingNewTaskToken(0), []);

  // « Nouvel évènement » (palette) : même mécanique côté Calendrier, la
  // date fournie est aujourd'hui (le panneau du jour s'ouvre directement
  // sur son formulaire d'ajout).
  const [pendingNewEventDate, setPendingNewEventDate] = useState<string | null>(null);
  const requestNewEvent = useCallback(() => {
    setPendingNewEventDate(toIsoDate(new Date()));
    setActiveId('calendar');
  }, []);
  const clearPendingNewEvent = useCallback(() => setPendingNewEventDate(null), []);

  // "Nouvelle note"/"Nouveau dossier" pour CommandPalette.tsx (montée dans
  // AppShell.tsx, HORS de NotesScreen) — voir NotesScreen.tsx,
  // `onRegisterActions`. Une ref (pas un state) : sa valeur ne doit pas
  // déclencher de re-render de Root, seule CommandPalette la lit, au moment
  // où elle s'ouvre/se filtre.
  const notesActionsRef = useRef<NotesActions | null>(null);
  const registerNotesActions = useCallback((actions: NotesActions) => {
    notesActionsRef.current = actions;
  }, []);

  let content;
  if (activeId === 'notes') {
    content = (
      <NotesScreen
        pendingOpenRelPath={pendingOpenRelPath}
        onOpenedPendingNote={clearPendingOpenNote}
        onRequestOpenTask={requestOpenTask}
        onRequestOpenCalendarDate={requestOpenCalendarDate}
        onRegisterActions={registerNotesActions}
      />
    );
  } else if (activeId === 'tasks') {
    content = (
      <TasksScreen
        pendingOpenTask={pendingOpenTask}
        onOpenedPendingTask={clearPendingOpenTask}
        pendingNewTaskToken={pendingNewTaskToken}
        onConsumedPendingNewTask={clearPendingNewTask}
      />
    );
  } else if (activeId === 'calendar') {
    content = (
      <CalendarScreen
        onRequestOpenNote={requestOpenNote}
        pendingOpenDate={pendingOpenCalendarDate}
        onOpenedPendingDate={clearPendingOpenCalendarDate}
        pendingNewEventDate={pendingNewEventDate}
        onOpenedPendingNewEvent={clearPendingNewEvent}
      />
    );
  } else if (activeId === 'settings') {
    content = <SettingsScreen />;
  }

  return (
    <>
      <AppShell
        sections={SECTIONS}
        activeId={activeId}
        onSelect={setActiveId}
        notesActionsRef={notesActionsRef}
        onRequestOpenNote={requestOpenNote}
        onRequestOpenTask={requestOpenTask}
        onRequestOpenCalendarDate={requestOpenCalendarDate}
        onRequestNewTask={requestNewTask}
        onRequestNewEvent={requestNewEvent}
      >
        {content}
      </AppShell>
      <StatusBar style="auto" />
    </>
  );
}

export default function App() {
  return (
    <PreferencesProvider>
      <AuthProvider>
        <VaultsProvider>
          {/* Après Auth/Vaults : la sync a besoin d'une session ET d'un
              coffre actif pour savoir s'il y a quoi que ce soit à
              synchroniser (voir SyncStatusContext.tsx). */}
          <SyncStatusProvider>
            <Root />
          </SyncStatusProvider>
        </VaultsProvider>
      </AuthProvider>
    </PreferencesProvider>
  );
}
