// ✒️ 123ECRITURE — lib/storage/webUuid.ts — randomUUID portable (web)
//////////////////////////////////////////////////////////////////////////////
//
// Un identifiant d'une ligne, partagé par tous les ponts web.
//
// Invariants du fichier :
//   • crypto.randomUUID exige un contexte sécurisé (HTTPS/localhost) —
//     le cas en production et sous Vitest ; repli déterministe-en-dernier-
//     recours (UUID v4 formellement valide) pour tout autre environnement.
//
// SOMMAIRE :
//   1. randomUUID (crypto natif, repli Math.random)
//
//////////////////////////////////////////////////////////////////////////////

//////// 1. randomUUID (crypto natif, repli Math.random) ////////////////////////////////

export function randomUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = (Math.random() * 16) | 0;
    return (char === 'x' ? random : (random & 0x3) | 0x8).toString(16);
  });
}
