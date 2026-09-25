import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Theme } from '../theme';

// RÈGLE UI (v0.4.32, demande de l'utilisatrice) : tout réglage à options
// multiples NON numériques (police, style de boutons, mode de fond…) est un
// BOUTON COLLAPSIBLE VERTICAL — un en-tête compact montrant la valeur
// courante (▸/▾), qui se rétracte/déploie pour révéler les options en
// colonne. Les réglages NUMÉRIQUES, eux, sont des curseurs (SliderField).
// Un seul composant partagé pour que la règle tienne partout d'elle-même.

export type OptionItem<T extends string> = { value: T; label: string; extra?: ReactNode };

type Props<T extends string> = {
  label: string;
  value: T;
  options: OptionItem<T>[];
  onValueChange: (value: T) => void;
  theme: Theme;
  // Affichage de la valeur dans l'en-tête (« Police · Serif ») — par défaut
  // le label de l'option courante.
  valueLabel?: string;
};

export function OptionCollapse<T extends string>({ label, value, options, onValueChange, theme, valueLabel }: Props<T>) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);
  return (
    <View style={[styles.wrap, { borderColor: theme.border }]}>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
        style={[styles.header, { backgroundColor: theme.surface }]}
      >
        <Text style={{ color: theme.textMuted, fontSize: 12 }}>{label}</Text>
        <Text style={{ color: theme.text, fontSize: 13, fontWeight: '600', flex: 1 }}>
          {valueLabel ?? current?.label ?? value}
        </Text>
        <Text style={{ color: theme.textMuted }}>{open ? '▾' : '▸'}</Text>
      </Pressable>
      {open && (
        <View style={styles.list}>
          {options.map((option) => {
            const active = option.value === value;
            return (
              <Pressable
                key={option.value}
                onPress={() => {
                  onValueChange(option.value);
                  setOpen(false);
                }}
                accessibilityRole="button"
                style={[styles.item, { borderColor: active ? theme.accent : theme.border, backgroundColor: active ? theme.accent : 'transparent' }]}
              >
                <Text style={{ color: active ? '#ffffff' : theme.text, flex: 1 }}>{option.label}</Text>
                {option.extra}
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderWidth: 1,
    borderRadius: 10,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 9,
    paddingHorizontal: 12,
  },
  list: {
    padding: 6,
    gap: 6,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
});
