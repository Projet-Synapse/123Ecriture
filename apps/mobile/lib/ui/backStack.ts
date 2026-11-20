// ✒️ 123ECRITURE — lib/ui/backStack.ts — ordre du bouton/geste retour Android
//////////////////////////////////////////////////////////////////////////////
//
// Une seule écoute du bouton retour (useBackHandler.ts) distribue l'appui
// aux gestionnaires inscrits, du plus prioritaire au moins prioritaire (à
// priorité égale : le plus récent d'abord). Le premier qui renvoie true
// consomme l'appui. Ordre voulu :
//   1. OVERLAY  — menus, panneaux, renommage en cours, sélection multiple
//                 (les Modal RN se ferment d'elles-mêmes, avant nous) ;
//   2. SECTION  — sortir des paramètres / d'un autre onglet → section
//                 précédente (Notes par défaut) ;
//   3. HISTORY  — fichier précédent ;
//   4. EXPLORER — de l'éditeur vers l'explorateur ;
//   5. SAVE     — vider une sauvegarde en attente (ne consomme jamais) ;
//   6. ROOT     — « Appuyez encore pour quitter », puis quitter.
// Module pur (aucun import RN) : testé dans backStack.test.ts.
//
//////////////////////////////////////////////////////////////////////////////

export const BACK_PRIORITY = {
  OVERLAY: 500,
  SECTION: 400,
  HISTORY: 300,
  EXPLORER: 200,
  SAVE: 100,
  ROOT: 0,
} as const;

export type BackHandlerFn = () => boolean;

export type BackStack = {
  register: (priority: number, handler: BackHandlerFn) => () => void;
  dispatch: () => boolean;
};

export function createBackStack(): BackStack {
  let seq = 0;
  const entries: { priority: number; order: number; handler: BackHandlerFn }[] = [];
  return {
    register(priority, handler) {
      const entry = { priority, order: seq++, handler };
      entries.push(entry);
      return () => {
        const index = entries.indexOf(entry);
        if (index >= 0) entries.splice(index, 1);
      };
    },
    dispatch() {
      const ordered = [...entries].sort((a, b) => b.priority - a.priority || b.order - a.order);
      for (const entry of ordered) {
        if (entry.handler()) return true;
      }
      return false;
    },
  };
}

// « Appuyez encore pour quitter » : le 1er appui à la racine prévient, un
// 2e appui dans la fenêtre quitte.
export const EXIT_CONFIRM_WINDOW_MS = 2000;
export function shouldExitOnBack(now: number, lastPressAt: number | null): boolean {
  return lastPressAt !== null && now - lastPressAt <= EXIT_CONFIRM_WINDOW_MS;
}

// Historique des fichiers ouverts (retour = fichier précédent). Pur :
// renvoie de nouveaux tableaux.
export const NOTE_HISTORY_LIMIT = 50;
export function pushNoteHistory(history: readonly string[], leftRelPath: string | null, openedRelPath: string): string[] {
  // La note ouverte sort de l'historique (pas d'aller-retour sans fin
  // a → b → a → b…), la note quittée passe au sommet.
  const next = history.filter((p) => p !== leftRelPath && p !== openedRelPath);
  if (!leftRelPath || leftRelPath === openedRelPath) return next;
  next.push(leftRelPath);
  return next.slice(-NOTE_HISTORY_LIMIT);
}
// Dépile jusqu'au premier fichier encore présent (≠ note courante).
export function popNoteHistory(
  history: readonly string[],
  currentRelPath: string | null,
  exists: (relPath: string) => boolean,
): { target: string | null; history: string[] } {
  const next = [...history];
  while (next.length > 0) {
    const candidate = next.pop() as string;
    if (candidate !== currentRelPath && exists(candidate)) return { target: candidate, history: next };
  }
  return { target: null, history: next };
}
