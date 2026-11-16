import type { PropsWithChildren } from 'react';
import { View } from 'react-native';
import { Svg, Path, Rect, Text as SvgText } from 'react-native-svg';

import { CANVAS_COLOR, CHART_COLOR, MDX_COLOR, badgeFontSize, fileIconFor } from '../../lib/ui/fileIcons';
import { TREE_ICON_SIZE, fixedIconBoxStyle } from '../../lib/ui/iconBox';
import type { Theme } from '../../theme';

// ✒️ 123ECRITURE — components/vault/FileIcons.tsx — les icônes vectorielles de l'explorateur
//////////////////////////////////////////////////////////////////////////////
//
// Icônes VECTORIELLES de l'explorateur (« des icônes à part entière, pas
// des emojis ») : react-native-svg rend du vrai SVG à n'importe quelle
// taille sans pixellisation. Le dossier change de forme selon qu'il est
// replié (fermé) ou déplié (ouvert) ; chaque `kind` de note a sa couleur.
//
// Invariants du fichier :
//   • La rotation du chevron vit sur un View RN (transform tableau), PAS
//     sur le <Svg> : en natif, react-native-svg parse l'attribut transform
//     en syntaxe SVG et rejette la forme CSS — le rendu de TOUT
//     l'explorateur crashe sinon dès qu'un dossier existe.
//   • Forme, couleur et insigne d'un fichier : mapping PARTAGÉ et testé
//     lib/ui/fileIcons.ts (canvas = tableau de cartes, md clair « md »,
//     mdx bleu « mdx », code = couleur + initiales du langage).
//   • TOUTE icône est rendue dans une boîte de taille FIXE (IconBox :
//     width/height/min/max figés + flexShrink 0, lib/ui/iconBox.ts). Avant,
//     le <Svg> était un enfant flex direct de la ligne : sur web/desktop un
//     <svg> a `flex-shrink: 1` par défaut et rétrécissait sur les lignes au
//     nom long — icônes de tailles différentes l'une sous l'autre (signalé
//     2026-11-16).
//
// SOMMAIRE :
//   1. Les icônes de dossier (fermé / ouvert)
//   2. Le chevron de repli, la feuille générique, l'icône par `kind`
//
//////////////////////////////////////////////////////////////////////////////

//////// 1. Les icônes de dossier (fermé / ouvert) ////////////////////////////////////////

type IconProps = { size?: number; color?: string };

function FolderIconBase({ size = TREE_ICON_SIZE, color = '#e0a458', open = false }: IconProps & { open?: boolean }) {
  // Dossier fermé : languette + corps. Ouvert : corps abaissé dont le
  // couvercle se soulève (l'écart entre les deux dessine l'ouverture).
  return (
    <IconBox size={size}>
      <Svg width={size} height={size} viewBox="0 0 16 16" fill="none">
        {open ? (
          <>
            <Path d="M1.5 4.5 H6 L7.5 6 H14.5 V7" stroke={color} strokeWidth="1.2" fill="none" />
            <Path
              d="M1.5 6 H6.5 L7.5 7 H4 Q2 7 1.8 8.2 L1.2 12 Q1 13 2 13 H14 Q15 13 14.8 12 L13.6 8.6 Q13.4 7.8 12.6 7.8 H7.5"
              stroke={color}
              strokeWidth="1.2"
              fill={`${color}22`}
            />
          </>
        ) : (
          <>
            <Path
              d="M1.5 3.5 H6 L7.5 5 H14.5 Q15 5 15 5.5 V12 Q15 13 14 13 H2 Q1 13 1 12 V4.5 Q1 3.5 1.5 3.5 Z"
              stroke={color}
              strokeWidth="1.2"
              fill={`${color}22`}
            />
          </>
        )}
      </Svg>
    </IconBox>
  );
}

export function FolderClosedIcon(props: IconProps) {
  return <FolderIconBase {...props} open={false} />;
}

export function FolderOpenIcon(props: IconProps) {
  return <FolderIconBase {...props} open />;
}

//////// 2. Le chevron de repli, la feuille générique, l'icône par `kind` //////////////////

// Chevron de repli/dépli (flèche) — remplace le triangle Text.
// ⚠️ La rotation vit sur un View RN (transform tableau), PAS sur le <Svg> :
// en natif, react-native-svg parse l'attribut transform en syntaxe SVG et
// rejette la forme CSS (« Expected transform functions but "r" found ») —
// crash du rendu de TOUT l'explorateur dès qu'un dossier existe dans
// l'arbre.
export function ChevronIcon({ size = 12, color = '#888', expanded = false }: IconProps & { expanded?: boolean }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        transform: expanded ? [{ rotate: '90deg' }] : [],
      }}
    >
      <Svg width={size} height={size} viewBox="0 0 12 12" fill="none">
        <Path d="M3 1.5 L8 6 L3 10.5" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </Svg>
    </View>
  );
}

// Feuille/document : coin plié ; avec insigne (md, mdx, py, html…), un
// bandeau plein en bas du document porte les initiales — lisible à 16 px
// (texte gras, noir ou blanc selon la couleur, police adaptée à la longueur).
export function FileIcon({
  size = TREE_ICON_SIZE,
  color = MDX_COLOR,
  badge,
  badgeText = '#ffffff',
}: IconProps & { badge?: string; badgeText?: string }) {
  return (
    <IconBox size={size}>
      <Svg width={size} height={size} viewBox="0 0 16 16" fill="none">
        <Path
          d="M3.5 1.5 H10 L13.5 5 V13.5 Q13.5 14.5 12.5 14.5 H3.5 Q2.5 14.5 2.5 13.5 V2.5 Q2.5 1.5 3.5 1.5 Z"
          stroke={color}
          strokeWidth="1.2"
          fill={`${color}18`}
        />
        <Path d="M10 1.5 V5 H13.5" stroke={color} strokeWidth="1.2" fill="none" />
        {badge ? (
          <>
            <Path d="M5 5 H8.5" stroke={`${color}aa`} strokeWidth="1" strokeLinecap="round" />
            <Rect x="0.6" y="8.2" width="14.8" height="7" rx="1.6" fill={color} />
            <SvgText
              x="8"
              y={badge.length <= 2 ? 14 : badge.length === 3 ? 13.7 : 13.4}
              fill={badgeText}
              fontSize={badgeFontSize(badge)}
              fontWeight="700"
              textAnchor="middle"
              fontFamily="system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
            >
              {badge}
            </SvgText>
          </>
        ) : (
          <Path d="M5 7.5 H11 M5 9.5 H11 M5 11.5 H9" stroke={`${color}88`} strokeWidth="1" strokeLinecap="round" />
        )}
      </Svg>
    </IconBox>
  );
}

// Canvas : FORME DISTINCTE (tableau de cartes, façon « layout-dashboard »)
// — avant, seul le violet le distinguait d'une note.
export function CanvasFileIcon({ size = TREE_ICON_SIZE, color = CANVAS_COLOR }: IconProps) {
  return (
    <IconBox size={size}>
      <Svg width={size} height={size} viewBox="0 0 16 16" fill="none">
        <Rect x="1.5" y="1.5" width="5.5" height="7.5" rx="1.2" stroke={color} strokeWidth="1.2" fill={`${color}30`} />
        <Rect x="9" y="1.5" width="5.5" height="4.5" rx="1.2" stroke={color} strokeWidth="1.2" fill={`${color}18`} />
        <Rect x="9" y="8" width="5.5" height="6.5" rx="1.2" stroke={color} strokeWidth="1.2" fill={`${color}30`} />
        <Rect x="1.5" y="11" width="5.5" height="3.5" rx="1.2" stroke={color} strokeWidth="1.2" fill={`${color}18`} />
      </Svg>
    </IconBox>
  );
}

// Graphique : axes + barres.
export function ChartFileIcon({ size = TREE_ICON_SIZE, color = CHART_COLOR }: IconProps) {
  return (
    <IconBox size={size}>
      <Svg width={size} height={size} viewBox="0 0 16 16" fill="none">
        <Path d="M2 1.5 V14 H14.5" stroke={color} strokeWidth="1.2" strokeLinecap="round" />
        <Rect x="4.5" y="8" width="2.4" height="4.5" rx="0.6" fill={color} />
        <Rect x="8.2" y="4.5" width="2.4" height="8" rx="0.6" fill={color} />
        <Rect x="11.9" y="6.5" width="2.4" height="6" rx="0.6" fill={`${color}99`} />
      </Svg>
    </IconBox>
  );
}

// Icône d'UN FICHIER : forme, couleur et insigne viennent du mapping
// partagé lib/ui/fileIcons.ts (arbre, onglets, favoris, aperçu, recherche).
export function FileTypeIcon({ relPath, kind, size = TREE_ICON_SIZE }: { relPath?: string; kind?: VaultEntryKind; size?: number }) {
  const spec = fileIconFor(relPath, kind);
  switch (spec.shape) {
    case 'canvas':
      return <CanvasFileIcon size={size} color={spec.color} />;
    case 'chart':
      return <ChartFileIcon size={size} color={spec.color} />;
    case 'drawing':
    case 'document':
      return <FileIcon size={size} color={spec.color} badge={spec.badge} badgeText={spec.badgeText} />;
  }
}

// Compatibilité : icône par `kind` (+ chemin pour l'extension).
export function NoteIconByKind({
  kind,
  relPath,
  size = TREE_ICON_SIZE,
  theme,
}: {
  kind: VaultEntryKind;
  relPath?: string;
  size?: number;
  theme?: Theme;
}) {
  void theme;
  return <FileTypeIcon kind={kind} relPath={relPath} size={size} />;
}

// Conteneur carré de taille FIXE (voir invariants) — n'était qu'un
// fragment vide jusqu'ici, d'où des icônes compressibles.
export function IconBox({ size = TREE_ICON_SIZE, children }: PropsWithChildren<{ size?: number }>) {
  return <View style={fixedIconBoxStyle(size)}>{children}</View>;
}
