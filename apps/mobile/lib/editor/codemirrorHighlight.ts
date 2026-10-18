import { defaultHighlightStyle, HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

// ✒️ 123ECRITURE — lib/editor/codemirrorHighlight.ts — style de coloration syntaxique de l'éditeur
//////////////////////////////////////////////////////////////////////////////
//
// Style de coloration de l'éditeur (MdxEditor.tsx desktop ET webview/
// editor-entry.tsx mobile — même composition d'extensions).
//
// Invariants du fichier :
//   • Le `basicSetup` de CodeMirror inclut `defaultHighlightStyle` en
//     `fallback`, qui SOULIGNE les titres markdown — effet retiré : le
//     soulignement est réservé à une vraie mise en forme à venir, pas à
//     un effet de style automatique.
//   • Ce soulignement ne peut PAS se surcharger par un simple theme
//     EditorView (les classes générées par HighlightStyle sont minifiées,
//     pas ciblables par nom), et poser UN autre style non-fallback
//     effacerait tout le fallback de basicSetup (il ne s'applique que si
//     aucun autre style n'existe) : tous les autres tags perdraient leur
//     couleur. D'où ces deux extensions à poser APRÈS basicSetup :
//     1. `defaultHighlightStyle` redéclaré tel quel, non-fallback —
//        re-fournit toutes les couleurs ;
//     2. l'override heading — ses règles sont montées APRÈS les siennes,
//        à spécificité égale c'est donc la dernière feuille qui gagne :
//        `text-decoration: none` l'emporte, `font-weight: 700` est
//        conservé (redéclaré ici pour ne jamais dépendre de l'ordre de
//        cascade).
//
//////////////////////////////////////////////////////////////////////////////
export const editorHighlightExtensions = [
  syntaxHighlighting(defaultHighlightStyle),
  syntaxHighlighting(
    HighlightStyle.define([
      { tag: t.heading, textDecoration: 'none', fontWeight: 'bold' },
    ]),
  ),
];
