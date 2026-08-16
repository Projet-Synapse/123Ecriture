import { autocompletion, type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';

// Autocomplétion des {{occurrences}} dans MdxEditor.tsx — se déclenche dès
// `{{`, ne propose QUE les mots déjà dans le dictionnaire personnel (voir
// OccurrencesPanel.tsx) plus une option "Créer" en dernier si le texte tapé
// ne correspond à aucun mot connu. Valider (clic ou Entrée) ferme le token
// (`}}`) et avance le curseur juste après — comportement demandé
// explicitement, voir le plan.
//
// `getKnownWords`/`onCreateWord` sont des fonctions (pas des valeurs
// figées) : l'extension CodeMirror est construite UNE FOIS (voir
// MdxEditor.tsx) et doit lire les données les plus récentes à chaque
// frappe — passer des refs mutables plutôt que reconstruire l'extension à
// chaque changement du dictionnaire, qui perturberait l'état interne du
// popup d'autocomplétion en cours d'utilisation.

export type OccurrenceAutocompleteOptions = {
  getKnownWords: () => string[];
  onCreateWord: (word: string) => Promise<void>;
};

function closeToken(word: string) {
  return `${word}}}`;
}

function occurrenceCompletionSource(options: OccurrenceAutocompleteOptions) {
  return (context: CompletionContext): CompletionResult | null => {
    const match = context.matchBefore(/\{\{[^}]*/);
    if (!match) return null;

    const typed = match.text.slice(2).trim();
    const from = match.from + 2;
    const words = options.getKnownWords();
    const lowerTyped = typed.toLowerCase();

    const existing = words.filter((word) => word.toLowerCase().includes(lowerTyped));
    const completions: Completion[] = existing.map((word) => ({
      label: word,
      apply: (view, _completion, applyFrom, applyTo) => {
        const insert = closeToken(word);
        view.dispatch({
          changes: { from: applyFrom, to: applyTo, insert },
          selection: { anchor: applyFrom + insert.length },
        });
      },
    }));

    const hasExactMatch = words.some((word) => word.toLowerCase() === lowerTyped);
    if (typed && !hasExactMatch) {
      completions.push({
        label: `➕ Créer « ${typed} »`,
        apply: (view, _completion, applyFrom, applyTo) => {
          void options.onCreateWord(typed).then(() => {
            const insert = closeToken(typed);
            view.dispatch({
              changes: { from: applyFrom, to: applyTo, insert },
              selection: { anchor: applyFrom + insert.length },
            });
          });
        },
      });
    }

    if (completions.length === 0) return null;
    return { from, options: completions, filter: false };
  };
}

export function createOccurrenceAutocomplete(options: OccurrenceAutocompleteOptions) {
  return autocompletion({ override: [occurrenceCompletionSource(options)] });
}
