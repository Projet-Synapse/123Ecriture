import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';

import { AppShell } from './components/AppShell';
import { NotesScreen } from './components/NotesScreen';
import { PlaceholderScreen } from './components/PlaceholderScreen';
import { SettingsScreen } from './components/SettingsScreen';
import { SECTIONS } from './navigation';

const SCREENS: Record<string, () => React.JSX.Element> = {
  notes: NotesScreen,
  settings: SettingsScreen,
};

export default function App() {
  const [activeId, setActiveId] = useState(SECTIONS[0].id);
  const activeSection = SECTIONS.find((section) => section.id === activeId) ?? SECTIONS[0];
  const ActiveScreen = SCREENS[activeId];

  return (
    <>
      <AppShell sections={SECTIONS} activeId={activeId} onSelect={setActiveId}>
        {ActiveScreen ? <ActiveScreen /> : <PlaceholderScreen section={activeSection} />}
      </AppShell>
      <StatusBar style="auto" />
    </>
  );
}
