import { useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View, type ViewStyle } from 'react-native';
import Slider from '@react-native-community/slider';

import { hexToHsv, hsvToHex } from '../lib/appearance';
import type { Theme } from '../theme';

// RÈGLE UI (v0.4.32, demande de l'utilisatrice) : tout réglage de COULEUR
// a sa ROUE DES COULEURS dédiée — les préréglages restent un raccourci
// apprécié, la roue donne la liberté totale. Implémentation : un disque en
// dégradé conique CSS (l'angle = teinte, la distance au centre =
// saturation), un curseur de luminosité, un aperçu live et le champ hex.
// Pur web-safe : conversions HSV dans lib/appearance.ts (testées).

const WHEEL_SIZE = 190;
const KNOB = 18;

export function ColorWheel({
  color,
  onColorChange,
  theme,
}: {
  color: string;
  onColorChange: (hex: string) => void;
  theme: Theme;
}) {
  const { h, s, v } = hexToHsv(color);
  const wheelRef = useRef<View | null>(null);
  const dragging = useRef(false);

  const applyFromPoint = (pageX: number, pageY: number) => {
    wheelRef.current?.measure((_x, _y, width, height, pageX0, pageY0) => {
      const cx = pageX0 + width / 2;
      const cy = pageY0 + height / 2;
      const dx = pageX - cx;
      const dy = pageY - cy;
      const rayon = Math.min(1, Math.hypot(dx, dy) / (width / 2));
      const hue = (Math.atan2(dy, dx) * 180) / Math.PI + 90; // 0° en haut
      onColorChange(hsvToHex(hue, rayon, v));
    });
  };

  const knobLeft = WHEEL_SIZE / 2 + Math.cos(((h - 90) * Math.PI) / 180) * s * (WHEEL_SIZE / 2 - KNOB / 2);
  const knobTop = WHEEL_SIZE / 2 + Math.sin(((h - 90) * Math.PI) / 180) * s * (WHEEL_SIZE / 2 - KNOB / 2);

  return (
    <View style={{ gap: 10 }}>
      <View
        ref={wheelRef}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={(e) => {
          dragging.current = true;
          applyFromPoint(e.nativeEvent.pageX, e.nativeEvent.pageY);
        }}
        onResponderMove={(e) => {
          if (dragging.current) applyFromPoint(e.nativeEvent.pageX, e.nativeEvent.pageY);
        }}
        onResponderRelease={() => {
          dragging.current = false;
        }}
        style={[
          styles.wheel,
          {
            // Disque HSV : dégradé conique (teinte) du centre blanc
            // (saturation 0) vers la périphérie saturée, mélangés en
            // multiply. backgroundImage n'est pas dans les types ViewStyle
            // de RN mais RNWeb (desktop/web) le rend tel quel — cast
            // volontaire : la roue est une extension web.
            backgroundImage:
              'conic-gradient(from 0deg, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000), radial-gradient(circle, #ffffff 0%, transparent 70%)',
            backgroundBlendMode: 'multiply',
          } as unknown as ViewStyle,
        ]}
      >
        <View style={[styles.knob, { left: knobLeft - KNOB / 2, top: knobTop - KNOB / 2, borderColor: theme.text }]} />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text style={{ color: theme.textMuted, fontSize: 12 }}>Luminosité</Text>
        <Slider
          minimumValue={0.15}
          maximumValue={1}
          step={0.01}
          value={v}
          onValueChange={(nv) => onColorChange(hsvToHex(h, s, nv))}
          minimumTrackTintColor={theme.accent}
          maximumTrackTintColor={theme.border}
          style={{ flex: 1 }}
        />
      </View>
    </View>
  );
}

export function ColorField({
  label,
  value,
  presets,
  onValueChange,
  theme,
}: {
  label: string;
  value: string;
  presets: string[];
  onValueChange: (hex: string) => void;
  theme: Theme;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);

  const openWheel = () => {
    setDraft(value);
    setOpen(true);
  };

  return (
    <View style={{ gap: 6 }}>
      {/* v0.4.35 (demandes de l'utilisatrice) : une ligne épurée — libellé à
          gauche, PASTILLE de la couleur courante à droite — la pastille
          ouvre la roue ; les PRÉRÉGLAGES vivent DANS la roue, plus sur la
          page. Hierarchie : fond d'écran > carte > conteneurs > boutons. */}
      <Pressable onPress={openWheel} accessibilityRole="button" style={[styles.rowButton, { borderColor: theme.border }]}>
        <Text style={{ color: theme.text, fontSize: 13, flex: 1 }}>{label}</Text>
        <View style={[styles.wheelGlyph, { backgroundColor: value }]} />
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={[styles.modalBackdrop]}>
          <View style={[styles.modalCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <Text style={{ color: theme.text, fontWeight: '600' }}>{label}</Text>
            <ColorWheel color={draft} onColorChange={setDraft} theme={theme} />
            {/* Préréglages — à l'intérieur de la roue (v0.4.35), plus sur
                la page des paramètres. */}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              {presets.map((preset) => {
                const active = preset.toLowerCase() === draft.toLowerCase();
                return (
                  <Pressable
                    key={preset}
                    onPress={() => setDraft(preset)}
                    accessibilityLabel={label + ' ' + preset}
                    style={[styles.swatch, { backgroundColor: preset }, active && styles.swatchActive]}
                  >
                    {active && <Text style={styles.swatchCheck}>✓</Text>}
                  </Pressable>
                );
              })}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View style={[styles.preview, { backgroundColor: draft, borderColor: theme.border }]} />
              <TextInput
                value={draft}
                onChangeText={setDraft}
                autoCapitalize="characters"
                style={[styles.hexInput, { color: theme.text, borderColor: theme.border }]}
              />
            </View>
            <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'flex-end' }}>
              <Pressable onPress={() => setOpen(false)} accessibilityRole="button" style={[styles.modalButton, { borderColor: theme.border }]}>
                <Text style={{ color: theme.text }}>Annuler</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  onValueChange(draft);
                  setOpen(false);
                }}
                accessibilityRole="button"
                style={[styles.modalButton, { backgroundColor: theme.accent, borderColor: theme.accent }]}
              >
                <Text style={{ color: '#ffffff' }}>Choisir</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  swatch: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.15)',
  },
  swatchActive: {
    borderWidth: 2,
    borderColor: '#ffffff',
  },
  swatchCheck: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowRadius: 2,
  },
  rowButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  wheelGlyph: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.25)',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    gap: 12,
    maxWidth: 360,
    width: '100%',
  },
  wheel: {
    width: WHEEL_SIZE,
    height: WHEEL_SIZE,
    borderRadius: WHEEL_SIZE / 2,
    alignSelf: 'center',
    borderWidth: 2,
    overflow: 'hidden',
  },
  knob: {
    position: 'absolute',
    width: KNOB,
    height: KNOB,
    borderRadius: KNOB / 2,
    borderWidth: 2,
    backgroundColor: 'transparent',
  },
  preview: {
    width: 40,
    height: 28,
    borderRadius: 6,
    borderWidth: 1,
  },
  hexInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    fontSize: 13,
  },
  modalButton: {
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
});
