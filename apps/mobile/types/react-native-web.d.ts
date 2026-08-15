// react-native-web transmet réellement `dataSet` au DOM sous-jacent
// (converti en attributs data-*), mais ce n'est pas modélisé dans les types
// de React Native (extension propre au web). Utilisé par
// components/VaultTreeView.tsx pour identifier une ligne lors d'un clic
// droit délégué (voir NotesScreen.tsx) sans dépendre d'une prop RN non
// officielle comme onContextMenu.
import 'react-native';

declare module 'react-native' {
  interface PressableProps {
    dataSet?: Record<string, string>;
  }
}
