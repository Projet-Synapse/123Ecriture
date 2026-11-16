// ✒️ 123ECRITURE — lib/ui/iconBox.ts — boîte de taille FIXE pour les icônes
//////////////////////////////////////////////////////////////////////////////
//
// Style d'un conteneur d'icône qui ne change JAMAIS de taille, quel que soit
// le contexte flex (ligne d'explorateur, onglet, carte d'aperçu de dossier).
//
// Invariants du fichier :
//   • width = height = minWidth = minHeight = maxWidth = maxHeight = taille,
//     et flexShrink 0 / flexGrow 0 / flexBasis auto : un nom de fichier long
//     ne peut plus comprimer l'icône (sur le web, un <svg> enfant direct
//     d'une ligne flex hérite du `flex-shrink: 1` CSS par défaut — c'est ce
//     qui donnait des icônes plus petites sur les lignes au nom long).
//   • TREE_ICON_SIZE est la taille UNIQUE des icônes de l'explorateur
//     (dossiers et fichiers, tous types confondus).
//
//////////////////////////////////////////////////////////////////////////////

export const TREE_ICON_SIZE = 16;

export type FixedIconBoxStyle = {
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
  maxWidth: number;
  maxHeight: number;
  flexShrink: 0;
  flexGrow: 0;
  flexBasis: 'auto';
  alignItems: 'center';
  justifyContent: 'center';
};

export function fixedIconBoxStyle(size: number): FixedIconBoxStyle {
  const safe = Number.isFinite(size) && size > 0 ? Math.round(size) : TREE_ICON_SIZE;
  return {
    width: safe,
    height: safe,
    minWidth: safe,
    minHeight: safe,
    maxWidth: safe,
    maxHeight: safe,
    flexShrink: 0,
    flexGrow: 0,
    flexBasis: 'auto',
    alignItems: 'center',
    justifyContent: 'center',
  };
}
