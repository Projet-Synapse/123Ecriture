// ✒️ 123ECRITURE — lib/editor/osEmojiInsertion.ts — panneau emoji Windows (Win+.) dans CodeMirror
//////////////////////////////////////////////////////////////////////////////
//
// CodeMirror pose `autocorrect="off"` sur sa zone éditable. Sous Windows,
// Chromium (donc Electron) peut alors ignorer l'emoji choisi dans le
// panneau Win+. : le panneau s'ouvre, aucun événement de saisie n'arrive à
// l'éditeur (symptôme vécu sur LORDI, 19/11 ; même cas public :
// uiwjs/react-md-editor#709). Le champ titre, sans cet attribut, marchait.
//
// L'ancien contournement (ViewPlugin qui RETIRAIT l'attribut dans son
// constructeur) ne faisait rien : CodeMirror crée les plugins AVANT de
// poser ses attributs (EditorView constructor → updateAttrs), qui
// n'étaient donc jamais retirés. Ici, la voie officielle : la facette
// `contentAttributes`, réappliquée par CodeMirror à chaque mise à jour.
//
// Option PRUDENTE : seul `autocorrect` passe à "on" (le seul attribut en
// cause) — `autocapitalize` et `writingsuggestions` gardent les valeurs de
// CodeMirror, pour limiter les effets de bord.
//
// Module sans dépendance React Native : testable sous vitest/jsdom
// (osEmojiInsertion.test.ts).
//
//////////////////////////////////////////////////////////////////////////////

import { EditorView } from '@codemirror/view';

export const enableOsEmojiInsertion = EditorView.contentAttributes.of({ autocorrect: 'on' });
