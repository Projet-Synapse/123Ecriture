// Linter markdown conservateur (v0.4.44, demande : « Linter » façon
// Obsidian) — NE touche JAMAIS au contenu des lignes de prose : seulement
// des normalisations sans risque de sens :
// 1. espaces/fins de ligne en fin de ligne supprimés ;
// 2. 3+ lignes vides consécutives réduites à une seule ligne vide ;
// 3. le fichier se termine par exactement une nouvelle ligne.
// Les blocs de code clôturés (``` … ```) sont préservés tels quels (les
// espaces de fin y sont parfois significatifs, ex. ASCII art).

export function lintMarkdown(text: string): string {
  const lines = text.split('\n');
  const out: string[] = [];
  let inFence = false;
  for (const line of lines) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    // Dans un bloc de code : ligne conservée TELLE QUELLE (les espaces de
    // fin peuvent y être significatifs) ; ailleurs, nettoyage standard.
    out.push(inFence ? line : line.replace(/[ \t]+$/, ''));
  }
  let result = out.join('\n');
  result = result.replace(/\n{3,}/g, '\n\n');
  result = result.replace(/\s+$/, '');
  return result + '\n';
}
