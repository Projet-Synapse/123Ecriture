import { Text, View } from 'react-native';
import Slider from '@react-native-community/slider';

import type { Theme } from '../theme';

// RÈGLE UI (v0.4.32, demande de l'utilisatrice) : tout réglage NUMÉRIQUE
// (échelle de l'interface, arrondi des boutons, voile de lisibilité,
// translucidité des panneaux…) est un CURSEUR — jamais une rangée de
// boutons. Affiche la valeur courante formatée à droite de l'étiquette.

export function SliderField({
  label,
  value,
  minimumValue,
  maximumValue,
  step,
  format,
  onValueChange,
  theme,
}: {
  label: string;
  value: number;
  minimumValue: number;
  maximumValue: number;
  step: number;
  format: (value: number) => string;
  onValueChange: (value: number) => void;
  theme: Theme;
}) {
  return (
    <View style={{ gap: 2 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={{ color: theme.textMuted, fontSize: 12 }}>{label}</Text>
        <Text style={{ color: theme.text, fontSize: 12, fontWeight: '600' }}>{format(value)}</Text>
      </View>
      <Slider
        minimumValue={minimumValue}
        maximumValue={maximumValue}
        step={step}
        value={value}
        onValueChange={onValueChange}
        minimumTrackTintColor={theme.accent}
        maximumTrackTintColor={theme.border}
        thumbTintColor={theme.accent}
      />
    </View>
  );
}
