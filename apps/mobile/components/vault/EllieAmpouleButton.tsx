import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';

import type { Theme } from '../../theme';

// ✒️ 123ECRITURE — components/vault/EllieAmpouleButton.tsx — bouton 💡 d'analyse
//////////////////////////////////////////////////////////////////////////////
//
// Petit bouton posé à côté du statut « Enregistré » de l'éditeur. Un clic
// demande à Ellie d'analyser la note ouverte ; pendant l'analyse, l'ampoule
// montre un indicateur et un second clic annule. Grisé si l'IA n'est pas
// activée ou si le fichier est verrouillé 🔒. Lecture seule.
//
//////////////////////////////////////////////////////////////////////////////

type Props = {
  theme: Theme;
  disabled: boolean;
  analyzing: boolean;
  disabledReason?: string;
  onPress: () => void;
};

export function EllieAmpouleButton({ theme, disabled, analyzing, disabledReason, onPress }: Props) {
  const blocked = disabled && !analyzing;
  const label = analyzing
    ? 'Analyse en cours, toucher pour annuler'
    : blocked
      ? (disabledReason ?? 'Analyse indisponible')
      : 'Demander à Ellie d’analyser cette note';
  return (
    <Pressable
      onPress={onPress}
      disabled={blocked}
      accessibilityRole="button"
      accessibilityState={{ disabled: blocked, busy: analyzing }}
      accessibilityLabel={label}
      style={[styles.btn, { opacity: blocked ? 0.4 : 1 }]}
    >
      {analyzing ? (
        <ActivityIndicator size="small" color={theme.accent} />
      ) : (
        <Text style={{ fontSize: 16, color: blocked ? theme.textMuted : theme.accent }}>💡</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    minWidth: 32,
    minHeight: 32,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
});
