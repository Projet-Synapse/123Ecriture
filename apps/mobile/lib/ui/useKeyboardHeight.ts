// ✒️ 123ECRITURE — lib/ui/useKeyboardHeight.ts — hauteur et haut du clavier logiciel
// Natif uniquement (0 / null sur web). `top` = ordonnée ÉCRAN du haut du
// clavier (endCoordinates.screenY), même repère que measureInWindow en
// edge-to-edge.
import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

export type KeyboardFrame = { height: number; top: number | null };

export function useKeyboardFrame(): KeyboardFrame {
  const [frame, setFrame] = useState<KeyboardFrame>({ height: 0, top: null });
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const show = Keyboard.addListener('keyboardDidShow', (event) => {
      setFrame({ height: event.endCoordinates.height, top: event.endCoordinates.screenY });
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => setFrame({ height: 0, top: null }));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return frame;
}
