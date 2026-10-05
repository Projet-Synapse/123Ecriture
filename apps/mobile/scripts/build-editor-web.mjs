// Construit le bundle WEB de l'éditeur embarqué (voir
// webview/editor-entry.tsx) en un fichier HTML unique auto-suffisant, puis
// l'écrit en constante TS : components/generated/editorWebBundle.ts, importé
// par MdxEditorWeb.tsx pour sa WebView (aucun réseau, tout est embarqué).
//
// Usage : pnpm --filter @123ecriture/mobile build:editor-web
// (à relancer après toute modification de webview/editor-entry.tsx ou des
// libs CodeMirror partagées — le fichier généré est commité).
import { build } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const mobileRoot = path.resolve(here, '..');

const result = await build({
  entryPoints: [path.join(mobileRoot, 'webview', 'editor-entry.tsx')],
  bundle: true,
  minify: true,
  write: false,
  format: 'iife',
  jsx: 'automatic',
  outdir: 'out',
  charset: 'utf8',
  logLevel: 'info',
});

const js = result.outputFiles.find((file) => file.path.endsWith('.js'));
const css = result.outputFiles.find((file) => file.path.endsWith('.css'));
if (!js) throw new Error('Bundle JS manquant');

const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<style>
  /* ⚠️ PAS de height:100% ici : la WebView est en HAUTEUR AUTO dans le
     ScrollView natif (le scroll est côté React Native) — la page doit
     pouvoir GRANDIR avec le contenu, sinon CodeMirror défile en interne
     et l'auto-hauteur ne peut jamais se calculer. */
  html, body, #root { margin: 0; padding: 0; }
  * { -webkit-tap-highlight-color: transparent; }
</style>
<style>${css ? css.text : ''}</style>
</head>
<body>
<div id="root"></div>
<script>${js.text}</script>
</body>
</html>`;

const outDir = path.join(mobileRoot, 'components', 'generated');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, 'editorWebBundle.ts');
const banner =
  '// ⚠️ GÉNÉRÉ par scripts/build-editor-web.mjs — NE PAS ÉDITER À LA MAIN.\n' +
  '// Source : webview/editor-entry.tsx (bundle esbuild du CodeMirror web).\n' +
  '// Relancer : pnpm --filter @123ecriture/mobile build:editor-web\n';
fs.writeFileSync(outFile, `${banner}export const EDITOR_WEB_BUNDLE: string = ${JSON.stringify(html)};\n`);
console.log(`editorWebBundle.ts écrit (${Math.round(html.length / 1024)} Ko)`);
