import { StatusBar } from 'expo-status-bar';
import { useCallback, useState } from 'react';

import { AppShell } from './components/AppShell';
import { CalendarScreen } from './components/CalendarScreen';
import { NotesScreen } from './components/NotesScreen';
import { PlaceholderScreen } from './components/PlaceholderScreen';
import { SettingsScreen } from './components/SettingsScreen';
import { TasksScreen } from './components/TasksScreen';
import { AuthProvider } from './lib/sync/AuthContext';
import { SyncStatusProvider } from './lib/sync/SyncStatusContext';
import { VaultsProvider } from './lib/sync/VaultsContext';
import { SECTIONS } from './navigation';
import { PreferencesProvider } from './preferences/PreferencesContext';

function Root() {
  const [activeId, setActiveId] = useState(SECTIONS[0].id);
  const activeSection = SECTIONS.find((section) => section.id === activeId) ?? SECTIONS[0];

  // Mécanisme partagé "ouvrir cette note" depuis un autre écran ("Ouvrir la
  // note du jour" du Calendrier — une carte-note de Canvas, elle, s'ouvre
  // directement DANS NotesScreen puisque Canvas y est maintenant embarqué en
  // tant que type de fichier, plus besoin de ce mécanisme pour ce cas) : on
  // bascule sur l'onglet Notes ET on note le relPath à ouvrir ; NotesScreen
  // le consomme dans un effet dès qu'il change, puis prévient qu'il l'a fait
  // (onOpenedPendingNote) pour qu'on le remette à null — sinon rouvrir le
  // même onglet Notes sans repasser par un autre écran re-déclencherait
  // l'ouverture à chaque fois.
  const [pendingOpenRelPath, setPendingOpenRelPath] = useState<string | null>(null);
  const requestOpenNote = useCallback((relPath: string) => {
    setPendingOpenRelPath(relPath);
    setActiveId('notes');
  }, []);
  const clearPendingOpenNote = useCallback(() => setPendingOpenRelPath(null), []);

  let content;
  if (activeId === 'notes') {
    content = <NotesScreen pendingOpenRelPath={pendingOpenRelPath} onOpenedPendingNote={clearPendingOpenNote} />;
  } else if (activeId === 'tasks') {
    content = <TasksScreen />;
  } else if (activeId === 'calendar') {
    content = <CalendarScreen onRequestOpenNote={requestOpenNote} />;
  } else if (activeId === 'settings') {
    content = <SettingsScreen />;
  } else {
    content = <PlaceholderScreen section={activeSection} />;
  }

  return (
    <>
      <AppShell sections={SECTIONS} activeId={activeId} onSelect={setActiveId}>
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
