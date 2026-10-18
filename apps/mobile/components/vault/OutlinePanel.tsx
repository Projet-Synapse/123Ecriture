import { useMemo } from 'react';
import { Pressable, Text, View } from 'react-native';

import { extractOutline } from '../../lib/editor/outline';
import type { Theme } from '../../theme';

// ✒️ 123ECRITURE — components/vault/OutlinePanel.tsx — le panneau « Plan »
//////////////////////////////////////////////////////////////////////////////
//
// Panneau « Plan » de la barre latérale : les titres H1–H6 de la note
// ouverte, en retrait par niveau ; un appui positionne le curseur sur le
// titre dans l'éditeur.
//
// Invariants du fichier :
//   • Le saut nécessite l'EditorView, donc les modes Source/Intermédiaire :
//     en Aperçu la liste reste consultable mais l'appui est sans effet
//     (canJump=false), faute d'EditorView.
//   • L'extraction du plan vit en logique pure dans lib/editor/outline.ts
//     (titres dans un bloc de code ignorés) — ce fichier ne fait
//     qu'afficher.
//
//////////////////////////////////////////////////////////////////////////////

type Props = {
  body: string;
  theme: Theme;
  onJump: (offset: number) => void;
  canJump: boolean;
};

export function OutlinePanel({ body, theme, onJump, canJump }: Props) {
  const outline = useMemo(() => extractOutline(body), [body]);

  if (outline.length === 0) {
    return (
      <View style={{ padding: 8, gap: 2 }}>
        <Text style={{ color: theme.textMuted, fontSize: 13 }}>
          Aucun titre dans cette note — ajoute des lignes « # … » à « ###### … » pour construire le plan.
        </Text>
      </View>
    );
  }

  return (
    <View style={{ padding: 8, gap: 2 }}>
      {outline.map((entry, index) => (
        <Pressable
          key={`${entry.offset}-${index}`}
          onPress={() => canJump && onJump(entry.offset)}
          accessibilityLabel={`Aller à ${entry.title}`}
          style={[styles.outlineRow, { borderLeftColor: theme.accent }]}
        >
          <Text
            numberOfLines={2}
            style={{
              color: theme.text,
              fontSize: Math.max(13, 18 - (entry.level - 1) * 2),
              fontWeight: entry.level <= 2 ? '700' : '400',
              paddingLeft: (entry.level - 1) * 12,
            }}
          >
            {entry.title}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = {
  outlineRow: { borderLeftWidth: 3, paddingVertical: 4, paddingRight: 4 } as const,
};
