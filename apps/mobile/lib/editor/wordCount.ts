// ✒️ 123ECRITURE — lib/editor/wordCount.ts — compteur de mots et caractères
//////////////////////////////////////////////////////////////////////////////
//
// Compteur de mots/caractères de la barre de statut de l'éditeur (voir
// NotesScreen.tsx) — logique pure, testée comme lib/taskDueDates.ts.
//
// Invariants du fichier :
//   • Un "mot" = une suite non vide de caractères séparés par des espaces
//     — suffisant pour un compteur informatif (pas une analyse
//     linguistique) : césures et ponctuations collées restent dans leur
//     mot hôte, comme dans la plupart des éditeurs de texte.
//   • Le markdown de mise en forme (**gras**, # titres...) est compté tel
//     quel : compter "le texte rendu" exigerait un parseur complet pour
//     un gain dérisoire.
//   • Caractères TOUT COMPRIS (espaces et sauts de ligne inclus) — c'est
//     la convention des éditeurs ("caractères" sans qualification) et la
//     seule non-ambiguë : la note réellement écrite a cette longueur-là.
//
//////////////////////////////////////////////////////////////////////////////

export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

export function countCharacters(text: string): number {
  return text.length;
}
