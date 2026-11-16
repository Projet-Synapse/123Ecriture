import { useRef, useState } from 'react';
import { TextInput, View, type NativeSyntheticEvent, type StyleProp, type TextInputKeyPressEventData, type TextStyle } from 'react-native';

import { ensurePropertyValueIndex } from '../../lib/properties/propertyValueIndex';
import type { ValueSuggestion } from '../../lib/properties/propertyValueSuggestions';
import type { Theme } from '../../theme';
import { SuggestionList } from './SuggestionList';

// ✒️ 123ECRITURE — components/properties/SuggestTextInput.tsx — champ de valeur avec suggestions
//////////////////////////////////////////////////////////////////////////////
//
// Champ texte CONTRÔLÉ + liste de suggestions (valeurs du coffre, options
// du schéma, notes en [[…]]) — voir lib/properties/propertyValueSuggestions.ts.
// Clavier (desktop/web) : ↓/↑ parcourent, Entrée choisit la suggestion
// surlignée (sinon valide le texte tapé), Échap ferme la liste. Mobile :
// tap sur une suggestion. Le premier focus lance la construction de
// l'index des valeurs (lib/properties/propertyValueIndex.ts).
//
//////////////////////////////////////////////////////////////////////////////

type Props = {
  value: string;
  onChangeText: (text: string) => void;
  // Suggestions pour le texte courant (calcul pur, appelé à chaque rendu).
  suggestions: ValueSuggestion[];
  onPick: (suggestion: ValueSuggestion) => void;
  onSubmit?: () => void;
  onBlur?: () => void;
  placeholder?: string;
  theme: Theme;
  style?: StyleProp<TextStyle>;
  wrapStyle?: object;
};

export function SuggestTextInput({ value, onChangeText, suggestions, onPick, onSubmit, onBlur, placeholder, theme, style, wrapStyle }: Props) {
  const anchorRef = useRef<View>(null);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const open = focused && !dismissed && suggestions.length > 0;
  const current = highlighted < suggestions.length ? highlighted : -1;

  const pick = (suggestion: ValueSuggestion) => {
    setHighlighted(-1);
    onPick(suggestion);
  };

  const onKeyPress = (event: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
    const key = event.nativeEvent.key;
    if (!open) {
      if (key === 'ArrowDown' && suggestions.length > 0 && dismissed) {
        setDismissed(false);
        event.preventDefault();
      }
      return;
    }
    if (key === 'ArrowDown') {
      event.preventDefault();
      setHighlighted((current + 1) % suggestions.length);
    } else if (key === 'ArrowUp') {
      event.preventDefault();
      setHighlighted(current <= 0 ? suggestions.length - 1 : current - 1);
    } else if (key === 'Enter' && current >= 0) {
      // preventDefault : react-native-web n'appelle alors ni onSubmitEditing
      // ni le blur de validation — seule la suggestion est appliquée.
      event.preventDefault();
      const suggestion = suggestions[current];
      if (suggestion) pick(suggestion);
    } else if (key === 'Escape') {
      event.preventDefault();
      setDismissed(true);
      setHighlighted(-1);
    }
  };

  return (
    <View ref={anchorRef} style={wrapStyle}>
      <TextInput
        value={value}
        onChangeText={(text) => {
          setDismissed(false);
          setHighlighted(-1);
          onChangeText(text);
        }}
        onFocus={() => {
          setFocused(true);
          ensurePropertyValueIndex();
        }}
        onBlur={() => {
          setFocused(false);
          setHighlighted(-1);
          onBlur?.();
        }}
        onSubmitEditing={onSubmit}
        onKeyPress={onKeyPress}
        placeholder={placeholder}
        placeholderTextColor={theme.textMuted}
        style={style}
        autoCorrect={false}
      />
      <SuggestionList
        anchorRef={anchorRef}
        open={open}
        suggestions={suggestions}
        highlighted={current}
        onPick={pick}
        onHover={setHighlighted}
        theme={theme}
      />
    </View>
  );
}
