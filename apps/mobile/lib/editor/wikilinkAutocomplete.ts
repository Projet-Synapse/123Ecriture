import { type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';

// Autocomplétion des [[liens internes]] dans MdxEditor.tsx — se déclenche
// dès `[[`, propose les NOMS des notes du coffre (résolution par nom, comme
// handleOpenWikilink dans NotesScreen.tsx — le lien n'a jamais porté de
// chemin complet). Valider (clic ou Entrée) referme le lien (`]]`) et
// avance le curseur juste après, comme l'autocomplétion des {{occurrences}}
// (lib/occurrenceAutocomplete.ts, même idiome).
//
// `getNoteNames` est une fonction (pas une valeur figée) : l'extension est
// construite UNE FOIS et relit l'arborescence à jour à chaque frappe —
// une note créée/renommée pendant la session apparaît à la suggestion
// suivante sans reconstruire l'extension (qui perturberait le popup en
// cours d'utilisation).
//
// Cas de l'alias `[[Nom|alias]]` : la complétion porte sur la partie NOM
// (avant `|`), et la partie alias déjà tapée est conservée telle quelle —
// `[[Rap|brouillon` complété en `[[Rapport mars|brouillon]]`.

export type WikilinkCandidate = {
  name: string;
  // Texte à insérer en remplacement de tout le fragment tapé depuis `[[`
  // (nom complété + alias éventuel + fermeture `]]`).
  applyText: string;
};

// Partie pure (testée) : quelles notes proposer pour un fragment tapé
// après `[[` — filtre par sous-chaîne insensible à la casse, exclut le
// nom déjà tapé EXACTEMENT (rien à compléter), dédoublonne (deux notes de
// dossiers différents peuvent porter le même nom — le wikilink ne les
// distingue de toute façon pas), préfixe d'abord puis ordre alphabétique
// (le plus "proche" en tête, ce que le tri alphabétique seul ne donne pas).
export function buildWikilinkCandidates(noteNames: string[], typed: string): WikilinkCandidate[] {
  const pipeIndex = typed.indexOf('|');
  const nameQuery = (pipeIndex === -1 ? typed : typed.slice(0, pipeIndex)).trim().toLowerCase();
  const aliasSuffix = pipeIndex === -1 ? '' : `|${typed.slice(pipeIndex + 1)}`;

  const seen = new Set<string>();
  const unique = noteNames.filter((name) => {
    const key = name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const matching = unique.filter(
    (name) => name.toLowerCase().includes(nameQuery) && name.toLowerCase() !== nameQuery,
  );
  matching.sort((a, b) => {
    const aPrefix = a.toLowerCase().startsWith(nameQuery) ? 0 : 1;
    const bPrefix = b.toLowerCase().startsWith(nameQuery) ? 0 : 1;
    if (aPrefix !== bPrefix) return aPrefix - bPrefix;
    return a.localeCompare(b, 'fr');
  });

  return matching.map((name) => ({ name, applyText: `${name}${aliasSuffix}]]` }));
}

// Source CodeMirror proprement dite — retournée à MdxEditor.tsx, qui la
// combine avec celle des occurrences dans un SEUL `autocompletion()`
// (extension singleton côté CodeMirror : jamais deux instances).
export function wikilinkCompletionSource(getNoteNames: () => string[]) {
  return (context: CompletionContext): CompletionResult | null => {
    // `[[` ouvrant, puis tout sauf `]]`/saut de ligne — un wikilink déjà
    // fermé ne doit plus déclencher la complétion.
    const match = context.matchBefore(/\[\[[^\]\n]*/);
    if (!match) return null;

    const candidates = buildWikilinkCandidates(getNoteNames(), match.text.slice(2));
    if (candidates.length === 0) return null;

    return {
      from: match.from + 2,
      options: candidates.map(
        (candidate): Completion => ({
          label: candidate.name,
          apply: (view, _completion, applyFrom, applyTo) => {
            view.dispatch({
              changes: { from: applyFrom, to: applyTo, insert: candidate.applyText },
              selection: { anchor: applyFrom + candidate.applyText.length },
            });
          },
        }),
      ),
      // La liste est déjà filtrée/triée par buildWikilinkCandidates —
      // laisser CodeMirror re-filtrer la retrierait alphabétiquement.
      filter: false,
    };
  };
}
