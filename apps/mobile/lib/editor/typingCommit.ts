// ✒️ 123ECRITURE — lib/editor/typingCommit.ts — regroupement des frappes avant le rendu de l'écran
//////////////////////////////////////////////////////////////////////////////
//
// Desktop (Electron) : CodeMirror et React partagent le MÊME fil
// d'exécution. Chaque frappe faisait `setContent` → re-rendu COMPLET de
// NotesScreen (≈ 4 000 lignes : explorateur, onglets, propriétés, plan,
// barre d'outils…) AVANT que la lettre suivante puisse s'afficher — sur un
// portable modeste, la frappe « traîne ». Android n'a pas ce coût : son
// éditeur vit dans une WebView (fil séparé), RN rend à côté.
//
// Ici : la frappe met à jour une ref (lue par la sauvegarde) TOUT DE SUITE,
// et l'état React n'est publié qu'après une courte pause (`delayMs`), au
// plus tard après `maxWaitMs` de frappe continue (compteur, plan,
// propriétés restent à jour à ~1 s près).
//
//////////////////////////////////////////////////////////////////////////////

export type TypingCommitter = {
  // Une frappe vient d'arriver : publier plus tard.
  schedule: () => void;
  // Publier maintenant ce qui est en attente (rien si rien n'attend).
  flush: () => void;
  // Abandonner la publication en attente (le contenu a été remplacé).
  cancel: () => void;
  // Une publication est-elle en attente ?
  isPending: () => boolean;
};

export function createTypingCommitter(options: {
  delayMs: number;
  maxWaitMs: number;
  commit: () => void;
}): TypingCommitter {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let firstPendingAt: number | null = null;

  const clear = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    firstPendingAt = null;
  };
  const flush = () => {
    if (firstPendingAt === null) return;
    clear();
    options.commit();
  };

  return {
    schedule() {
      const now = Date.now();
      if (firstPendingAt === null) firstPendingAt = now;
      if (timer) clearTimeout(timer);
      const waited = now - firstPendingAt;
      const delay = Math.max(0, Math.min(options.delayMs, options.maxWaitMs - waited));
      timer = setTimeout(flush, delay);
    },
    flush,
    cancel: clear,
    isPending: () => firstPendingAt !== null,
  };
}
