import { defaultHighlightStyle, HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

// ✒️ 123ECRITURE — lib/editor/codemirrorHighlight.ts — style de coloration syntaxique de l'éditeur
//////////////////////////////////////////////////////////////////////////////
//
// Style de coloration de l'éditeur (MdxEditor.tsx desktop ET webview/
// editor-entry.tsx mobile — même composition d'extensions).
//
// Invariants du fichier :
//   • Le `basicSetup` de CodeMirror / @uiw/react-codemirror inclut
//     `defaultHighlightStyle` en `fallback`, qui SOULIGNE les titres
//     markdown (`text-decoration: underline` sur `tags.heading`). Le
//     soulignement est réservé à une vraie mise en forme (`<u>`), pas à
//     un effet automatique des en-têtes.
//   • On ne peut PAS se contenter d'ajouter un second HighlightStyle
//     `{ tag: t.heading, textDecoration: 'none' }` après le style par
//     défaut. `syntaxHighlighting` applique l'UNION des classes : le
//     titre porte alors à la fois `.ͼ7 { text-decoration: underline }`
//     et `.ͼo { text-decoration: none }`. À spécificité égale, c'est
//     l'ordre d'injection des feuilles (non garanti) qui décide — d'où
//     des titres encore soulignés selon la session ou la plateforme.
//   • D'où UN seul style, calqué sur `defaultHighlightStyle` mais sans
//     soulignement des titres (`font-weight: 700` conservé). Les liens
//     et le `<u>` gardent leur soulignement.
//   • `basicSetup.syntaxHighlighting` doit être à `false` (MdxEditor et
//     editor-entry) : sinon le module CSS du style par défaut est
//     quand même monté, même en fallback, et la règle `underline`
//     reste dans la page.
//
//////////////////////////////////////////////////////////////////////////////
function withoutHeadingUnderline(spec: (typeof defaultHighlightStyle.specs)[number]) {
  const tags = Array.isArray(spec.tag) ? spec.tag : [spec.tag];
  if (!tags.includes(t.heading)) return spec;
  return { ...spec, textDecoration: 'none' };
}

export const editorHighlightStyle = HighlightStyle.define(
  defaultHighlightStyle.specs.map(withoutHeadingUnderline),
);

export const editorHighlightExtensions = [syntaxHighlighting(editorHighlightStyle)];
