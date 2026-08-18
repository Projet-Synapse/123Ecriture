import { useState } from 'react';
import { TextInput } from 'react-native';

import type { Theme } from '../theme';

// Champ texte "à commit différé" — un brouillon local (state contrôlé, pas
// `defaultValue`) mis à jour à chaque frappe, mais qui ne remonte au parent
// (`onCommit`) qu'au blur/à la validation. Évite de resérialiser toute la
// donnée parente à chaque caractère tapé, et évite surtout d'aller lire la
// valeur courante d'un `<input>` DOM sous-jacent via l'évènement natif RN
// (fragile côté react-native-web) — le brouillon EST la source de vérité
// entre deux commits. Extrait de PropertiesPanel.tsx (où il est né) pour
// être réutilisé tel quel par TasksScreen.tsx (texte de tâche, description,
// sous-étapes) — même besoin, pas de raison d'avoir un 3e exemplaire.
export function DraftTextField({
  initialValue,
  onCommit,
  placeholder,
  theme,
  style,
  multiline,
}: {
  initialValue: string;
  onCommit: (value: string) => void;
  placeholder?: string;
  theme: Theme;
  style: object;
  multiline?: boolean;
}) {
  // Resynchronise le brouillon quand `initialValue` change VRAIMENT (autre
  // élément sélectionné, valeur changée ailleurs) — ajustement pendant le
  // rendu plutôt que dans un effet (évite un flash "ancienne valeur" d'une
  // frame ET la règle react-hooks/set-state-in-effect : c'est le correctif
  // documenté par React pour "réinitialiser un état dérivé d'une prop qui
  // change").
  const [prevInitialValue, setPrevInitialValue] = useState(initialValue);
  const [draft, setDraft] = useState(initialValue);
  if (initialValue !== prevInitialValue) {
    setPrevInitialValue(initialValue);
    setDraft(initialValue);
  }

  const commit = () => {
    if (draft !== initialValue) onCommit(draft);
  };

  return (
    <TextInput
      value={draft}
      onChangeText={setDraft}
      onBlur={commit}
      onSubmitEditing={multiline ? undefined : commit}
      multiline={multiline}
      placeholder={placeholder}
      placeholderTextColor={theme.textMuted}
      style={style}
    />
  );
}
