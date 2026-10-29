// ✒️ 123ECRITURE — lib/storage/vaultTreeEvents.ts — « l'index du coffre a été
// rafraîchi » : l'explorateur s'affiche d'abord depuis le cache d'index local,
// puis se relit quand le parcours natif complet est terminé.
type Listener = () => void;
const listeners = new Set<Listener>();
export function onVaultTreeRefreshed(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function emitVaultTreeRefreshed(): void {
  for (const fn of [...listeners]) {
    try {
      fn();
    } catch {
      /* un abonné défaillant ne bloque pas les autres */
    }
  }
}
