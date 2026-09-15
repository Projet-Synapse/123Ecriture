// randomUUID portable — crypto.randomUUID exige un contexte sécurisé
// (HTTPS/localhost), ce qui est le cas en production et sous Vitest ;
// repli déterministe-en-dernier-recours pour tout autre environnement.
export function randomUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = (Math.random() * 16) | 0;
    return (char === 'x' ? random : (random & 0x3) | 0x8).toString(16);
  });
}
