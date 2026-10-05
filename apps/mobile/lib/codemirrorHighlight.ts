import { defaultHighlightStyle, HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

// Style de coloration de l'éditeur (MdxEditor.tsx desktop ET webview/
// editor-entry.tsx mobile — même composition d'extensions).
//
// Le `basicSetup` de CodeMirror inclut `defaultHighlightStyle` en
// `fallback`, qui SOULIGE les titres markdown (text-decoration: underline)
// — effet retiré à la demande (2026-10-03 : « enlever les effets de
// soulignement pour les en-têtes ; on aura besoin du soulignement pour
// plus tard, mais pas de cette façon » — ce sera une vraie mise en forme,
// pas un effet de style automatique).
//
// Le soulignement ne peut PAS se surcharger par un simple theme
// EditorView (les classes générées par HighlightStyle sont minifiées, pas
// ciblables par nom), et poser UN autre style non-fallback effacerait tout
// le fallback de basicSetup (il ne s'applique que si aucun autre style
// n'existe) : tous les autres tags perdraient leur couleur. D'où ces deux
// extensions à poser APRÈS basicSetup :
// 1. `defaultHighlightStyle` redéclaré tel quel, non-fallback — re-fournit
//    toutes les couleurs ;
// 2. l'override heading — ses règles sont montées APRÈS les siennes, à
//    spécificité égale c'est donc la dernière feuille qui gagne :
//    `text-decoration: none` l'emporte, `font-weight: 700` est conservé
//    (redéclaré ici pour ne jamais dépendre de l'ordre de cascade).
export const editorHighlightExtensions = [
  syntaxHighlighting(defaultHighlightStyle),
  syntaxHighlighting(
    HighlightStyle.define([
      { tag: t.heading, textDecoration: 'none', fontWeight: 'bold' },
    ]),
  ),
];
