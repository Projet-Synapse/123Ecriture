import { useEffect, useRef } from 'react';
import { Platform, Text, View } from 'react-native';

// Lecteur audio minimal pour les pièces jointes audio des notes (voir
// NoteRenderer.tsx, `![[fichier.mp3]]`) — RN n'a pas de composant <audio>
// natif. Même échappatoire que SvgOverlay.tsx/ChartView.tsx : un vrai
// élément HTML <audio controls> injecté dans le DOM via une ref, plutôt
// qu'une dépendance (ex. expo-av) pour ce seul besoin — cet écran est de
// toute façon desktop/web uniquement pour l'instant.
type Props = {
  dataUrl: string;
};

export function AudioEmbed({ dataUrl }: Props) {
  const containerRef = useRef<View>(null);

  useEffect(() => {
    const container = containerRef.current as unknown as HTMLElement | null;
    if (!container) return;
    container.innerHTML = '';

    const audio = document.createElement('audio');
    audio.controls = true;
    audio.src = dataUrl;
    audio.style.width = '100%';
    container.appendChild(audio);

    return () => {
      container.innerHTML = '';
    };
  }, [dataUrl]);

  if (Platform.OS !== 'web') {
    return (
      <View style={{ marginVertical: 4 }}>
        <Text style={{ fontSize: 12, opacity: 0.7 }}>{"🎧 Audio non lisible sur mobile pour l'instant."}</Text>
      </View>
    );
  }
  return <View ref={containerRef} style={{ marginVertical: 4, minHeight: 32 }} />;
}
