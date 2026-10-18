// Langages de code de l'éditeur (v0.4.46, demande utilisateur : « lire
// n'importe quels fichiers code comme VS Code ») — la liste des extensions
// reconnues est ICI et SEULEMENT ICI : les trois adaptateurs (desktop
// vault.ts, web webVaultAdapter.ts, natif nativeVaultAdapter.ts) l'importent
// au lieu de maintenir trois copies divergentes (même modèle de partage que
// frontmatterMigration.ts — esbuild bundle l'import cross-package).
//
// Deux niveaux de support :
// - langages « dédiés » (@codemirror/lang-*) : parseur Lezer complet →
//   COLORATION + SOULIGNEMENTS ROUGES des erreurs de syntaxe via le linter
//   générique (lib/codeLint.ts, qui lit l'arbre d'erreur du parseur actif) ;
// - langages « legacy » (@codemirror/legacy-modes, StreamLanguage) :
//   COLORATION seulement — pas d'arbre, donc pas de soulignements.
import { StreamLanguage, type LanguageSupport } from '@codemirror/language';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { json } from '@codemirror/lang-json';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { xml } from '@codemirror/lang-xml';
import { sql } from '@codemirror/lang-sql';
import { php } from '@codemirror/lang-php';
// Modes legacy (coloration seule, pas de parseur Lezer) — chaque mode vit
// dans son module du paquet ; kotlin/c/cpp/java/csharp partagent clike.
import { c, cpp, java, csharp, kotlin } from '@codemirror/legacy-modes/mode/clike';
import { go } from '@codemirror/legacy-modes/mode/go';
import { rust } from '@codemirror/legacy-modes/mode/rust';
import { ruby } from '@codemirror/legacy-modes/mode/ruby';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { lua } from '@codemirror/legacy-modes/mode/lua';
import { swift } from '@codemirror/legacy-modes/mode/swift';
import { toml } from '@codemirror/legacy-modes/mode/toml';
import { yaml } from '@codemirror/legacy-modes/mode/yaml';
import { dockerFile } from '@codemirror/legacy-modes/mode/dockerfile';
import { powerShell } from '@codemirror/legacy-modes/mode/powershell';

export type CodeLanguageSupport = {
  language: LanguageSupport | StreamLanguage<unknown>;
  // true si un parseur Lezer complet est derrière (soulignements d'erreurs
  // possibles) — StreamLanguage legacy n'en a pas.
  parseable: boolean;
};

// Ensemble des extensions de fichiers reconnues comme CODE (partout :
// explorateur, création, sync, éditeurs). Tout en minuscules, AVEC le point.
// `source` de vérité unique : les trois adaptateurs importent cette liste.
export const CODE_FILE_EXTENSIONS: string[] = [
  // JavaScript / TypeScript (langage dédié, parseur Lezer)
  '.js',
  '.mjs',
  '.cjs',
  '.jsx',
  '.ts',
  '.mts',
  '.cts',
  '.tsx',
  // Python (langage dédié, parseur Lezer)
  '.py',
  '.pyw',
  // Web (langages dédiés, parseurs Lezer)
  '.json',
  '.html',
  '.htm',
  '.css',
  '.scss',
  '.less',
  '.xml',
  '.svg',
  // SQL (langage dédié, parseur Lezer)
  '.sql',
  // Legacy (coloration seule) — C/C++/Java/C#/Go/Rust/PHP/Ruby…
  '.c',
  '.h',
  '.cpp',
  '.hpp',
  '.cc',
  '.hh',
  '.java',
  '.cs',
  '.go',
  '.rs',
  '.php',
  '.rb',
  '.lua',
  '.swift',
  '.kt',
  '.kts',
  '.sh',
  '.bash',
  '.zsh',
  '.bat',
  '.cmd',
  '.ps1',
  '.yaml',
  '.yml',
  '.toml',
  '.ini',
  '.cfg',
  '.env',
  '.dockerfile',
];

const CODE_EXTENSION_SET = new Set(CODE_FILE_EXTENSIONS);

export function isCodeFile(fileName: string): boolean {
  const dot = fileName.lastIndexOf('.');
  if (dot === -1) return fileName.toLowerCase() === 'dockerfile';
  return CODE_EXTENSION_SET.has(fileName.slice(dot).toLowerCase());
}

export function extensionKindFor(fileName: string): 'code' | null {
  return isCodeFile(fileName) ? 'code' : null;
}

// Modes legacy (@codemirror/legacy-modes) — StreamLanguage, coloration seule.
// ⚠️ Les .d.ts des modes référencent le type StreamParser de
// @codemirror/streamparser, tandis que StreamLanguage.define attend celui de
// @codemirror/language : DEUX déclarations structurellement identiques sauf
// un champ privé (StringStream.tabSize), jugées incompatibles par
// TypeScript. D'où le paramètre `unknown` + cast localisé ICI UNIQUEMENT —
// au runtime c'est exactement la même forme, les modes fonctionnent.
type LegacyMode = Parameters<typeof StreamLanguage.define>[0];
function legacy(parser: unknown): StreamLanguage<unknown> {
  return StreamLanguage.define(parser as LegacyMode);
}

// Renvoie le support de langage CodeMirror pour une extension de fichier
// (AVEC le point, casse ignorée), ou null si ce n'est pas du code reconnu.
// Les langages dédiés passent leur dialecte exact (TypeScript/JSX pour les
// .ts/.tsx, etc.) — la coloration suit les vraies règles du langage.
export function languageForExtension(extensionWithDot: string): CodeLanguageSupport | null {
  switch (extensionWithDot.toLowerCase()) {
    // JavaScript / TypeScript — dialectes exacts (TypeScript=true pour les
    // .ts/.mts/.cts, jsx pour .jsx, les deux pour .tsx).
    case '.js':
    case '.mjs':
    case '.cjs':
      return { language: javascript(), parseable: true };
    case '.jsx':
      return { language: javascript({ jsx: true }), parseable: true };
    case '.ts':
    case '.mts':
    case '.cts':
      return { language: javascript({ typescript: true }), parseable: true };
    case '.tsx':
      return { language: javascript({ typescript: true, jsx: true }), parseable: true };
    // Python — parseur Lezer complet (soulignements d'erreurs possibles).
    case '.py':
    case '.pyw':
      return { language: python(), parseable: true };
    // Web.
    case '.json':
      return { language: json(), parseable: true };
    case '.html':
    case '.htm':
      return { language: html(), parseable: true };
    case '.css':
    case '.scss':
    case '.less':
      return { language: css(), parseable: true };
    case '.xml':
    case '.svg':
      return { language: xml(), parseable: true };
    case '.sql':
      return { language: sql(), parseable: true };
    case '.php':
      return { language: php(), parseable: true };
    // Legacy — coloration seule.
    case '.c':
    case '.h':
      return { language: legacy(c), parseable: false };
    case '.cpp':
    case '.hpp':
    case '.cc':
    case '.hh':
      return { language: legacy(cpp), parseable: false };
    case '.java':
      return { language: legacy(java), parseable: false };
    case '.cs':
      return { language: legacy(csharp), parseable: false };
    case '.go':
      return { language: legacy(go), parseable: false };
    case '.rs':
      return { language: legacy(rust), parseable: false };
    case '.rb':
      return { language: legacy(ruby), parseable: false };
    case '.lua':
      return { language: legacy(lua), parseable: false };
    case '.swift':
      return { language: legacy(swift), parseable: false };
    case '.kt':
    case '.kts':
      return { language: legacy(kotlin), parseable: false };
    case '.sh':
    case '.bash':
    case '.zsh':
      return { language: legacy(shell), parseable: false };
    case '.yaml':
    case '.yml':
      return { language: legacy(yaml), parseable: false };
    case '.toml':
      return { language: legacy(toml), parseable: false };
    case '.ini':
    case '.cfg':
      return { language: legacy(toml), parseable: false }; // clé = valeur, proche parent
    case '.env':
      return { language: legacy(shell), parseable: false };
    case '.ps1':
      return { language: legacy(powerShell), parseable: false };
    case '.dockerfile':
      return { language: legacy(dockerFile), parseable: false };
    default:
      return isCodeFile(`x${extensionWithDot}`) ? { language: legacy(shell), parseable: false } : null;
  }
}

export function languageForFile(fileName: string): CodeLanguageSupport | null {
  const dot = fileName.lastIndexOf('.');
  const extension = dot === -1 ? (fileName.toLowerCase() === 'dockerfile' ? '.dockerfile' : '') : fileName.slice(dot);
  return languageForExtension(extension);
}
