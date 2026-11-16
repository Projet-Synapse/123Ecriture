import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { placePopover, solidColor, type Rect } from '../../lib/ui/popover';
import { SOURCE_HINT, type SuggestionListProps } from './SuggestionList';

// ✒️ 123ECRITURE — components/properties/SuggestionList.web.tsx — liste de suggestions (desktop/web)
//////////////////////////////////////////////////////////////////////////////
//
// Version WEB (desktop Electron + navigateur) : la liste est rendue dans
// un PORTAIL sur <body>, en position fixe, AU-DESSUS DE TOUT — hors des
// contextes d'empilement des cartes (le défaut du menu de type, #223) —
// avec un fond PLEIN du thème et une ombre. Pas de Modal : il volerait le
// focus du champ (piège à focus de react-native-web) alors qu'on continue
// de taper. `mousedown` annulé : cliquer une suggestion ne fait pas perdre
// le focus au champ (pas de commit parasite du texte partiel).
// Placement : sous le champ, au-dessus s'il manque de place
// (lib/ui/popover.ts), recalculé au défilement et au redimensionnement.
//
//////////////////////////////////////////////////////////////////////////////

const ROW_HEIGHT = 30;

export function SuggestionList({ anchorRef, open, suggestions, highlighted, onPick, onHover, theme }: SuggestionListProps) {
  const [anchor, setAnchor] = useState<Rect | null>(null);
  const visible = open && suggestions.length > 0;

  useEffect(() => {
    if (!visible) return;
    const measure = () => {
      anchorRef.current?.measureInWindow((x, y, width, height) => setAnchor({ x, y, width, height }));
    };
    measure();
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
    };
  }, [visible, anchorRef, suggestions.length]);

  if (!visible || !anchor || typeof document === 'undefined') return null;
  const width = Math.max(anchor.width, 180);
  const place = placePopover(
    { ...anchor, x: anchor.x + width - anchor.width },
    { width, height: 8 + suggestions.length * ROW_HEIGHT },
    { width: window.innerWidth, height: window.innerHeight },
  );

  return createPortal(
    <div onMouseDown={(event) => event.preventDefault()}>
      <View
        accessibilityRole="menu"
        style={[
          styles.list,
          // `fixed` : accepté par react-native-web, absent des types RN.
          { position: 'fixed' as 'absolute' },
          {
            left: place.left,
            top: place.top,
            width,
            maxHeight: place.maxHeight,
            backgroundColor: solidColor(theme.surface, solidColor(theme.background, '#ffffff')),
            borderColor: theme.border,
          },
        ]}
      >
        {suggestions.map((suggestion, index) => (
          <Pressable
            key={suggestion.value}
            onPress={() => onPick(suggestion)}
            onHoverIn={() => onHover(index)}
            accessibilityRole="menuitem"
            style={[styles.row, index === highlighted && { backgroundColor: `${theme.accent}33` }]}
          >
            <Text style={{ color: theme.text, fontSize: 12, flex: 1 }} numberOfLines={1}>
              {suggestion.source === 'note' ? '📄 ' : ''}
              {suggestion.label}
            </Text>
            <Text style={{ color: theme.textMuted, fontSize: 11 }}>
              {suggestion.count > 0 ? `×${suggestion.count}` : SOURCE_HINT[suggestion.source]}
            </Text>
          </Pressable>
        ))}
      </View>
    </div>,
    document.body,
  );
}

const styles = StyleSheet.create({
  list: {
    zIndex: 10000,
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 4,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.28,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: ROW_HEIGHT,
    paddingHorizontal: 10,
  },
});
