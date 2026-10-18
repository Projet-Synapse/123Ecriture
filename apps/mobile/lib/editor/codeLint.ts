// Soulignements d'erreurs et d'avertissements de l'éditeur de code (v0.4.46,
// demande utilisateur : « les soulignements rouges et jaunes concernant les
// erreurs et les avertissements », comme VS Code) — branché sur le framework
// @codemirror/lint (underline rouge = error, jaune = warning, panneau à côté
// de la barre de défilement).
//
// Deux sources, sans serveur de langage (trop lourd pour cette app, en
// particulier sur la machine de l'utilisatrice) :
// - ROUGE (error) : nœuds d'erreur du parseur Lezer du langage ACTIF
//   (syntaxTree, voir buildCodeLinter) — disponible pour tous les langages
//   « dédiés » de lib/codeLanguages.ts (JS/TS/JSX/TSX, Python, JSON, HTML,
//   CSS, XML, SQL, PHP) ; les langages legacy (coloration seule) n'ont pas
//   d'arbre, donc pas de soulignement ;
// - JAUNE (warning) : marqueurs TODO/FIXME/XXX/HACK en début de commentaire
//   (findTodoWarnings, fonction pure testée) — heuristic simple mais
//   universelle, tous langages.
import { syntaxTree } from '@codemirror/language';
import { linter, type Diagnostic } from '@codemirror/lint';
import type { EditorView } from '@codemirror/view';

// Au-delà de cette taille, pas de lint : le parseur travaillerait sur tout
// le document au premier lancement (même philosophie que le garde-fou du
// Live Preview, lib/mdxLivePreview.ts).
export const MAX_LINT_CHARS = 500_000;

// Marqueurs d'intention reconnus en commentaire — jaunes (avertissements).
// Capture le PREMIER marqueur d'une ligne de commentaire (tous styles
// confondus : // # /* * -- ; % et HTML).
const TODO_PATTERN = /^\s*(?:\/\/+|#+|\/\*+|\*+|--+|;+|<!--|%+)\s*(TODO|FIXME|XXX|HACK)\b/i;

export type TodoWarning = { line: number; from: number; to: number; marker: string };

// Fonction PURE : repère les marqueurs TODO/FIXME/XXX/HACK dans un texte,
// avec leurs positions ABSOLUES (from/to) prêtes pour un Diagnostic
// CodeMirror. Limite raisonnable au nombre de résultats pour ne pas noyer
// le panneau de lint sur un gros fichier.
export function findTodoWarnings(text: string, limit = 100): TodoWarning[] {
  const warnings: TodoWarning[] = [];
  let offset = 0;
  for (const line of text.split('\n')) {
    if (warnings.length >= limit) break;
    const match = TODO_PATTERN.exec(line);
    if (match) {
      const markerStart = offset + match.index + match[0].indexOf(match[1]);
      warnings.push({
        line: warnings.length + 1,
        from: markerStart,
        to: markerStart + match[1].length,
        marker: match[1].toUpperCase(),
      });
    }
    offset += line.length + 1;
  }
  return warnings;
}

// Linter générique branché sur l'arbre du langage ACTIF : pas besoin de
// connaître le langage — `syntaxTree` rend l'arbre du parseur monté (Lezer
// pour les langages dédiés) et expose les erreurs via node.type.isError.
// Les nœuds d'erreur du parseur avec recovery sont souvent des PLAGE larges
// (tout ce qui suit un token inattendu) : on borne chaque diagnostic à la
// ligne du nœud pour ne pas souligner un demi-fichier en rouge.
export function buildCodeLinter() {
  return linter((view: EditorView) => {
    const doc = view.state.doc;
    if (doc.length > MAX_LINT_CHARS) return [];

    const diagnostics: Diagnostic[] = [];

    // 1) Erreurs de syntaxe (rouge) — nœuds `⚠` du parseur actif.
    syntaxTree(view.state).iterate({
      enter: (node) => {
        if (!node.type.isError) return;
        // Nœuds d'erreur imbriqués : garder le plus EXTERNE seulement (un
        // ⚠ peut en contenir d'autres — itérer tout et filtrer les parents
        // doublerait les soulignements). On souligne au plus la ligne de
        // fin du nœud : un recovery mal embarré s'étend sinon à tout le
        // reste du fichier.
        const from = node.from;
        const lineEnd = doc.lineAt(Math.min(node.to, doc.length)).to;
        const to = Math.min(node.to, lineEnd);
        diagnostics.push({
          from,
          to: Math.max(to, from + 1),
          severity: 'error',
          message: 'Erreur de syntaxe',
        });
        return false; // ne descend pas dans les enfants du nœud d'erreur
      },
    });

    // 2) Marqueurs d'intention (jaune).
    for (const todo of findTodoWarnings(doc.toString())) {
      diagnostics.push({
        from: todo.from,
        to: todo.to,
        severity: 'warning',
        message: `${todo.marker} : à faire / à surveiller`,
      });
    }

    return diagnostics;
  });
}
