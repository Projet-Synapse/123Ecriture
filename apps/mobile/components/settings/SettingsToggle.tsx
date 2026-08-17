import { Pressable, Text, View } from 'react-native';

import type { Theme } from '../../theme';
import { settingsStyles } from './settingsStyles';

// Interrupteur générique (case à cocher + libellé) réutilisé par plusieurs
// sections de Paramètres (Éditeur, Gestion des fichiers et des liens...) —
// même visuel que la case des boutons de la barre d'outils Notes
// (PersonalizationCard.tsx), extrait ici pour ne pas le redéfinir à chaque
// section.
type Props = {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
  theme: Theme;
};

export function SettingsToggle({ label, value, onChange, theme }: Props) {
  return (
    <Pressable style={settingsStyles.toggleRow} onPress={() => onChange(!value)}>
      <View
        style={[
          settingsStyles.checkbox,
          { borderColor: theme.border },
          value && { backgroundColor: theme.accent, borderColor: theme.accent },
        ]}
      >
        {value && <Text style={settingsStyles.checkboxMark}>✓</Text>}
      </View>
      <Text style={[settingsStyles.toggleLabel, { color: theme.text }]}>{label}</Text>
    </Pressable>
  );
}
