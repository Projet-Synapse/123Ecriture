import type { PropsWithChildren } from 'react';
import { Svg, Path, Circle } from 'react-native-svg';

import type { Theme } from '../theme';

// Icônes VECTORIELLES de l'explorateur (v0.4.36, demande de l'utilisatrice :
// « des icônes à part entière, pas des emojis »). Réact-native-svg rend du
// vrai SVG à n'importe quelle taille sans pixellisation. Le dossier change
// de forme selon qu'il est replié (fermé) ou déplié (ouvert).

type IconProps = { size?: number; color?: string };

function FolderIconBase({ size = 16, color = '#e0a458', open = false }: IconProps & { open?: boolean }) {
  // Dossier fermé : languette + corps. Ouvert : corps abaissé dont le
  // couvercle se soulève (l'écart entre les deux dessine l'ouverture).
  return (
    <Svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      {open ? (
        <>
          <Path d="M1.5 4.5 H6 L7.5 6 H14.5 V7" stroke={color} strokeWidth="1.2" fill="none" />
          <Path d="M1.5 6 H6.5 L7.5 7 H4 Q2 7 1.8 8.2 L1.2 12 Q1 13 2 13 H14 Q15 13 14.8 12 L13.6 8.6 Q13.4 7.8 12.6 7.8 H7.5" stroke={color} strokeWidth="1.2" fill={`${color}22`} />
        </>
      ) : (
        <>
          <Path d="M1.5 3.5 H6 L7.5 5 H14.5 Q15 5 15 5.5 V12 Q15 13 14 13 H2 Q1 13 1 12 V4.5 Q1 3.5 1.5 3.5 Z" stroke={color} strokeWidth="1.2" fill={`${color}22`} />
        </>
      )}
    </Svg>
  );
}

export function FolderClosedIcon(props: IconProps) {
  return <FolderIconBase {...props} open={false} />;
}

export function FolderOpenIcon(props: IconProps) {
  return <FolderIconBase {...props} open />;
}

// Chevron de repli/dépli (flèche) — remplace le triangle Text.
export function ChevronIcon({ size = 12, color = '#888', expanded = false }: IconProps & { expanded?: boolean }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 12 12" fill="none" style={{ transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>
      <Path d="M3 1.5 L8 6 L3 10.5" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

// Feuille/document générique — la couleur varie par type de fichier.
export function FileIcon({ size = 16, color = '#7aa2f7', badge }: IconProps & { badge?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      {/* Corps : coin plié en haut à droite */}
      <Path d="M3.5 1.5 H10 L13.5 5 V13.5 Q13.5 14.5 12.5 14.5 H3.5 Q2.5 14.5 2.5 13.5 V2.5 Q2.5 1.5 3.5 1.5 Z" stroke={color} strokeWidth="1.2" fill={`${color}18`} />
      <Path d="M10 1.5 V5 H13.5" stroke={color} strokeWidth="1.2" fill="none" />
      {/* Lignes de texte stylisées */}
      <Path d="M5 7.5 H11 M5 9.5 H11 M5 11.5 H9" stroke={`${color}88`} strokeWidth="1" strokeLinecap="round" />
      {badge ? <Circle cx="12.5" cy="12.5" r="3" fill={color} /> : null}
    </Svg>
  );
}

// Icône par `kind` — couleurs différenciées, même motif de base.
export function NoteIconByKind({ kind, size = 16, theme }: { kind: VaultEntryKind; size?: number; theme?: Theme }) {
  void theme;
  switch (kind) {
    case 'markdown':
      return <FileIcon size={size} color="#7aa2f7" />;
    case 'canvas':
      return <FileIcon size={size} color="#bb9af7" />;
    case 'chart':
      return <FileIcon size={size} color="#9ece6a" />;
    case 'excalidraw':
      return <FileIcon size={size} color="#e0af68" />;
    default:
      return <FileIcon size={size} color="#7aa2f7" />;
  }
}

// Petits utilitaires React pour wrapper les icônes dans un conteneur carré.
export function IconBox({ size = 16, children }: PropsWithChildren<{ size?: number }>) {
  void size;
  return <>{children}</>;
}
