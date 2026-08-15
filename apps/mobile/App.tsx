import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';

import { AppShell } from './components/AppShell';
import { NotesScreen } from './components/NotesScreen';
import { PlaceholderScreen } from './components/PlaceholderScreen';
import { SECTIONS } from './navigation';

export default function App() {
  const [activeId, setActiveId] = useState(SECTIONS[0].id);
  const activeSection = SECTIONS.find((section) => section.id === activeId) ?? SECTIONS[0];

  return (
    <>
      <AppShell sections={SECTIONS} activeId={activeId} onSelect={setActiveId}>
        {activeId === 'notes' ? <NotesScreen /> : <PlaceholderScreen section={activeSection} />}
      </AppShell>
      <StatusBar style="auto" />
    </>
  );
}
