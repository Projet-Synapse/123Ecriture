import { useEffect, useState } from 'react';
import { Animated, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { dismissToast, notify, runToastAction, useToasts, type Toast } from '../lib/notify/notify';
import { solidColor } from '../lib/ui/popover';
import { usePreferences } from '../preferences/PreferencesContext';
import type { Theme } from '../theme';

// ✒️ 123ECRITURE — components/ToastHost.tsx — l'affichage des bulles de notification
//////////////////////////////////////////////////////////////////////////////
//
// Pile de bulles (lib/notify/notify.ts) posée PAR-DESSUS toute l'app :
// en bas à droite sur écran large, au-dessus de la barre d'onglets sur
// téléphone. Fond OPAQUE aux couleurs du thème, liseré coloré selon le
// type ; un clic (ou toucher) ferme la bulle.
//
// Invariants du fichier :
//   • pointerEvents « box-none » : en dehors des bulles, les clics passent
//     à l'app en dessous.
//   • Apparition/disparition en fondu (Animated, pilote natif hors web).
//   • Mise à jour du desktop disponible ou prête : annoncée ici une fois
//     (window.updater, desktop uniquement).
//
//////////////////////////////////////////////////////////////////////////////

const WIDE_BREAKPOINT = 720;
const useNativeDriver = Platform.OS !== 'web';

const TYPE_COLORS: Record<Toast['type'], string> = {
  success: '#16a34a',
  info: '#2563eb',
  warning: '#d97706',
  error: '#dc2626',
};

const TYPE_ICONS: Record<Toast['type'], string> = {
  success: '✓',
  info: 'ℹ',
  warning: '⚠',
  error: '✕',
};

function ToastBubble({ toast, theme }: { toast: Toast; theme: Theme }) {
  const [opacity] = useState(() => new Animated.Value(0));
  useEffect(() => {
    Animated.timing(opacity, { toValue: toast.leaving ? 0 : 1, duration: 200, useNativeDriver }).start();
  }, [opacity, toast.leaving]);
  const color = toast.type === 'error' ? theme.danger : TYPE_COLORS[toast.type];
  const background = solidColor(theme.surface, solidColor(theme.background, '#ffffff'));
  return (
    <Animated.View
      style={{
        opacity,
        transform: [{ translateY: opacity.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }],
      }}
    >
      <Pressable
        onPress={() => {
          if (toast.action) runToastAction(toast.action);
          dismissToast(toast.id);
        }}
        accessibilityRole="alert"
        accessibilityHint={toast.action ? 'Toucher pour ouvrir le détail' : 'Toucher pour fermer'}
        style={[styles.bubble, { backgroundColor: background, borderColor: theme.border, borderLeftColor: color }]}
      >
        <Text style={[styles.icon, { color }]}>{toast.action?.kind === 'ellie-suggestion' ? '💡' : TYPE_ICONS[toast.type]}</Text>
        <Text style={[styles.message, { color: theme.text }]} numberOfLines={6}>
          {toast.message}
          {toast.count > 1 ? <Text style={{ color: theme.textMuted }}>{`  ×${toast.count}`}</Text> : null}
        </Text>
        {toast.action || toast.type === 'error' ? (
          <Pressable
            onPress={(e) => {
              e.stopPropagation?.();
              dismissToast(toast.id);
            }}
            accessibilityRole="button"
            accessibilityLabel="Fermer la notification"
            hitSlop={8}
          >
            <Text style={[styles.close, { color: theme.textMuted }]}>✕</Text>
          </Pressable>
        ) : null}
      </Pressable>
    </Animated.View>
  );
}

export function ToastHost() {
  const toasts = useToasts();
  const { theme } = usePreferences();
  const { width } = useWindowDimensions();
  const wide = width >= WIDE_BREAKPOINT;

  // Mise à jour du desktop (electron-updater) : annoncée une fois par version.
  useEffect(() => {
    const updater = typeof window !== 'undefined' ? window.updater : undefined;
    if (!updater?.onStatusChange) return;
    const announced = new Set<string>();
    return updater.onStatusChange((status) => {
      if (status.state !== 'available' && status.state !== 'ready') return;
      const tag = `${status.state}:${status.version}`;
      if (announced.has(tag)) return;
      announced.add(tag);
      notify({
        type: 'info',
        key: 'app-update',
        duration: 10_000,
        message:
          status.state === 'ready'
            ? `Version ${status.version} prête : elle s’installera au redémarrage.`
            : `Version ${status.version} disponible (Paramètres → À propos).`,
      });
    });
  }, []);

  if (toasts.length === 0) return null;
  return (
    <View
      pointerEvents="box-none"
      style={[styles.host, wide ? styles.hostWide : styles.hostNarrow]}
    >
      {toasts.map((toast) => (
        <ToastBubble key={toast.id} toast={toast} theme={theme} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    gap: 8,
    zIndex: 1000,
    elevation: 1000,
  },
  hostWide: {
    right: 16,
    bottom: 16,
    width: 340,
    alignItems: 'stretch',
  },
  hostNarrow: {
    left: 12,
    right: 12,
    bottom: 84,
  },
  bubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderLeftWidth: 4,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 6,
  },
  icon: { fontSize: 15, fontWeight: '700' },
  message: { flex: 1, fontSize: 14, lineHeight: 19 },
  close: { fontSize: 13, paddingLeft: 4 },
});
