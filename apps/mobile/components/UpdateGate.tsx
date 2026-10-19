import { useCallback, useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { fetchLatestRelease, installedAppVersion, isNewerVersion } from '../lib/updaterAndroid';

// MISE À JOUR FORCÉE AU LANCEMENT (demande de l'utilisatrice, 20/10 : « dès
// que j'ouvre l'appli, les mises à jour sont forcées »). Au démarrage, on
// interroge la dernière release GitHub : si elle est plus récente que la
// version installée, TOUT l'écran est remplacé par la mise à jour — l'app
// ne démarre pas tant qu'elle n'est pas à jour. Un échec réseau ne bloque
// JAMAIS l'app (on n'a pas pu vérifier = on n'a pas pu prouver le retard).
// L'installation elle-même passe par le navigateur (l'APK joint à la
// release) — Android gère ensuite l'installation depuis les notifications ;
// le câble USB reste le circuit de secours de l'assistante.
export function UpdateGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<'vérification' | 'à-jour' | 'retard' | 'échec'>('vérification');
  const [versionDistante, setVersionDistante] = useState<string | null>(null);
  const [apkUrl, setApkUrl] = useState<string | null>(null);
  const [téléchargement, setTéléchargement] = useState(false);

  useEffect(() => {
    let vivant = true;
    void (async () => {
      try {
        const release = await fetchLatestRelease();
        if (!vivant) return;
        const installée = installedAppVersion();
        setVersionDistante(release.version);
        setApkUrl(release.apkUrl);
        if (installée && isNewerVersion(release.version, installée)) {
          setState('retard');
        } else {
          setState('à-jour');
        }
      } catch {
        if (vivant) setState('échec');
      }
    })();
    return () => {
      vivant = false;
    };
  }, []);

  const ouvrirApk = useCallback(() => {
    if (apkUrl) setTéléchargement(true);
    if (apkUrl) void Linking.openURL(apkUrl);
  }, [apkUrl]);

  if (state !== 'retard') {
    // En vérification, à jour, ou réseau indisponible : l'app démarre
    // normalement. Le bandeau discret si la vérification a échoué.
    return (
      <>
        {state === 'échec' ? (
          <View style={styles.bandeau}>
            <Text style={styles.bandeauTexte}>⚠️ Vérification de mise à jour impossible (réseau ?)</Text>
          </View>
        ) : null}
        {children}
      </>
    );
  }

  return (
    <View style={styles.ecran}>
      <Text style={styles.titre}>Mise à jour obligatoire</Text>
      <Text style={styles.texte}>
        La version {versionDistante ?? 'récente'} est disponible et corrige des problèmes de synchronisation.
        {'\n\n'}Ton coffre est en sécurité dans le cloud — installe la mise à jour pour continuer.
      </Text>
      <Pressable
        style={[styles.bouton, téléchargement && styles.boutonOccupé]}
        disabled={téléchargement}
        onPress={ouvrirApk}
      >
        <Text style={styles.boutonTexte}>{téléchargement ? 'Téléchargement en cours…' : 'Télécharger et installer'}</Text>
      </Pressable>
      <Text style={styles.hint}>
        Le téléchargement s’ouvre dans ton navigateur : ouvre le fichier téléchargé et confirme l’installation.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  ecran: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 18, backgroundColor: '#14161c' },
  titre: { fontSize: 24, fontWeight: '800', color: '#e8eaf2' },
  texte: { fontSize: 15, lineHeight: 22, textAlign: 'center', color: '#c9cdd8' },
  bouton: { borderRadius: 12, paddingHorizontal: 22, paddingVertical: 14, backgroundColor: '#4b7bec' },
  boutonOccupé: { opacity: 0.6 },
  boutonTexte: { fontSize: 16, fontWeight: '700', color: '#fff' },
  hint: { fontSize: 12, textAlign: 'center', color: '#8a8fa0' },
  bandeau: { backgroundColor: '#5a4a12', padding: 8 },
  bandeauTexte: { color: '#ffd98a', textAlign: 'center', fontSize: 12 },
});
