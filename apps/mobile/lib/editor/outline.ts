// Extraction du PLAN d'une note (v0.4.44 — panneau « Plan » de la barre
// latérale, demande : « Plan de la note (barre latérale) ») : les titres
// H1–H6 avec leur position dans le texte, pour navigation clic = saut.
// Les titres DANS un bloc de code clôturé sont ignorés (faux positifs
// récurrents dans les notes d'exemples).

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
