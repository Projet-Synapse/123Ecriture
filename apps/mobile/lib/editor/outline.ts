// ✒️ 123ECRITURE — lib/editor/outline.ts — extraction du plan d'une note
//////////////////////////////////////////////////////////////////////////////
//
// Extraction du PLAN d'une note (panneau « Plan » de la barre latérale) :
// les titres H1–H6 avec leur position dans le texte, pour une navigation
// clic = saut.
//
// Invariants du fichier :
//   • Les titres DANS un bloc de code clôturé sont ignorés (faux positifs
//     récurrents dans les notes d'exemples).
//
//////////////////////////////////////////////////////////////////////////////

export type OutlineEntry = { level: number; title: string; offset: number };

export function extractOutline(text: string): OutlineEntry[] {
  const entries: OutlineEntry[] = [];
  const re = /^(#{1,6})[ \t]+(.+)$/gm;
  let inFence = false;
  let offset = 0;
  for (const line of text.split('\n')) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    if (!inFence) {
      const match = re.exec(line);
      if (match) {
        entries.push({ level: match[1].length, title: match[2].trim(), offset });
      }
      re.lastIndex = 0;
    }
    offset += line.length + 1;
  }
  return entries;
}
