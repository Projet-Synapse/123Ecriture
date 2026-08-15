import { StyleSheet, Text, View } from 'react-native';

import type { Section } from '../navigation';
import { usePreferences } from '../preferences/PreferencesContext';

// Écran générique pour les sections pas encore construites — évite
// d'attendre d'avoir chaque module fini pour que la navigation soit
// utilisable de bout en bout.
type Props = {
  section: Section;
};

export function PlaceholderScreen({ section }: Props) {
  const { theme } = usePreferences();

  return (
    <View style={styles.container}>
      <Text style={styles.icon}>{section.icon}</Text>
      <Text style={[styles.title, { color: theme.text }]}>{section.label}</Text>
      <Text style={[styles.description, { color: theme.textMuted }]}>{section.description}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 8,
  },
  icon: {
    fontSize: 40,
  },
  title: {
    fontSize: 22,
    fontWeight: '600',
  },
  description: {
    fontSize: 14,
    textAlign: 'center',
    maxWidth: 360,
  },
});
