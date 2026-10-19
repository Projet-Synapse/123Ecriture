# 🗺️ La carte du coffre et de la synchronisation

> La bibliothèque : un dossier = une fonction. Pour trouver, lire la ligne
> qui correspond à ta question.

| Ta question | Où chercher |
|---|---|
| Ce que fait UN cycle de synchro (la recette linéaire) | `syncEngine.ts` (runSync) |
| Pourquoi une modification n'est pas un conflit | `diff.ts` (le diff à trois voies) |
| Comment on supprime (tombestones, revue) | `deletions.ts` |
| Comment on fusionne deux versions | `merge.ts` + `attemptConflictMerge` (syncEngine) |
| Le silence de 60 s pendant l'édition | `editQuiet.ts` |
| Le journal du cycle | `journal.ts` (+ `.123ecriture/sync-journal.json` dans le coffre) |
| La revue de sécurité et le disjoncteur | `pendingReview.ts` |
| Tout ce qui parle au cloud (push, pull, catalogue, appareils) | `cloud.ts` |
| Les règles « qu'est-ce qui se synchronise » | `syncRules.ts` (source unique, partagée) |
| Les ponts Android / web (SAF, File System Access) | `../storage/` |
| Les ponts du desktop (hachage, watcher, IO fichiers, OAuth) | `apps/desktop/electron/ponts-desktop/` |
| L'authentification | `AuthContext.tsx` (mobile) / `ponts-desktop/auth.ts` (desktop) |
| La spécification officielle du cycle | `docs/sync-cycle-spec.md` |
| L'historique des incidents | `docs/vault-incidents.md` |
