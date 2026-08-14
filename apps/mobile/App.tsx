import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';

// Écran minimal de la Phase 0 : sert uniquement à valider que le pipeline
// Expo (mobile + web) démarre correctement. La logique réelle (vault,
// éditeur MDX...) arrive en Phase 1 — voir docs/ARCHITECTURE.md.
export default function App() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>123Ecriture</Text>
      <Text style={styles.subtitle}>Phase 0 — le socle multiplateforme est en place ✅</Text>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  title: {
    fontSize: 24,
    fontWeight: '600',
  },
  subtitle: {
    fontSize: 14,
    color: '#555',
  },
});
