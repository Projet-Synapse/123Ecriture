# 🗃️ Incidents du coffre (vault) — journal des hypothèses

> But du fichier (demande de l'utilisatrice, 2026-10-14) : centraliser TOUS
> les bugs liés au coffre / à la synchro, avec pour chacun les hypothèses
> **prouvées** (fix validé), **démenties** (testé, ce n'était pas ça) et
> **à tester** (encore ouvert). Objectif : ne plus re-déduire deux fois la
> même chose, et savoir immédiatement où en est chaque piste.
> Compléter à chaque incident nouveau — une hypothèse démentie est une
> information aussi précieuse qu'une cause trouvée.

---

## 1. Coffres mélangés (contenu d'un coffre qui apparaît dans un autre)

**Versions : ~v0.4.4x–0.4.54 — RÉSOLU (v0.4.54–0.4.59)**

| # | Hypothèse | Statut | Preuve / Fix |
|---|-----------|--------|--------------|
| 1.1 | Course : changer de coffre pendant un cycle de sync → fichiers écrits dans le mauvais coffre | ✅ PROUVÉE | Verrou anti-bascule : `setSyncLock` (electron/sync.ts + vaults.ts), refus de `switchVault` pendant `syncEnCours`, refus côté mobile dans VaultSwitcher. Plus de mélange constaté après. |
| 1.2 | Séparateurs Windows : les chemins poussés vers Supabase contenaient des `\` → 1577 doublons cloud, et les tombestones jamais envoyées → résurrections de fichiers supprimés | ✅ PROUVÉE | Normalisation POSIX systématique + purge par lots de 100 des chemins backslashed (v0.4.59, `.in()` + AbortSignal 30 s). Comptage vérifié avant/après purge. |
| 1.3 | `sync-state` unique partagé entre coffres (curseur + journal de fusion croisés) | ✅ PROUVÉE | État de sync PAR COFFRE dans `.123ecriture/state.json` du coffre (v0.4.54). |
| 1.4 | Bug côté serveur Supabase (RLS/étiquetage) | ❌ DÉMENTIE | Les lignes cloud étaient correctement étiquetées ; les doublons venaient des chemins locaux (cf. 1.2). |

## 2. « Vaults distants disparus » sur le téléphone (Paramètres → Compte et synchronisation vide)

**Versions : APK v0.4.61–0.4.62 — CAUSE PROUVÉE le 2026-10-14, fix en cours**

| # | Hypothèse | Statut | Preuve / Fix |
|---|-----------|--------|--------------|
| 2.1 | **Le workflow CI `build-android-apk.yml` construit l'APK SANS les variables `EXPO_PUBLIC_SUPABASE_*`** → `supabase = null` dans le bundle → `auth.available === false` → la carte « Compte » (connexion) ET la carte « Coffres distants » ne sont JAMAIS rendues → connexion impossible, l'app paraît « uniquement locale » | ✅ PROUVÉE | Comparaison des workflows : `release.yml`, `ci.yml`, `deploy-web.yml` définissent les deux variables ; `build-android-apk.yml` NON. Conststaté sur le téléphone : écran Compte et synchronisation avec UNIQUEMENT « Coffres locaux », aucune carte Compte (le code n'affiche la carte que si `auth.available`, voir AccountSyncSection.tsx ligne ~288). Toute APK issue de ce workflow est muette sur Supabase. |
| 2.2 | La permission SAF du coffre a été perdue à la réinstallation (install -r) | ❌ DÉMENTIE | Le coffre local « Nouveau coffre » s'ouvre et s'affiche normalement après les réinstallations adb ; les données du coffre sont intactes (elles vivent dans le dossier SAF, hors de l'app). |
| 2.3 | La session Supabase persistée a été effacée | ❌ NON CAUSANTE (mais non prouvée de bout en bout) | `nativeAuthStorage` écrit dans le stockage privé, préservé par `adb install -r`. Même si la session a sauté, la connexion par email ou Google suffit à tout réafficher — le blocage réel est 2.1 (pas de bouton de connexion du tout). |
| 2.4 | Le message logcat `[vaults-web] indexedDB` signale la perte des coffres | ❌ DÉMENTIE | Bruit d'import web (pont navigateur), sans rapport : sur natif la liste vient de Supabase, pas d'indexedDB. |
| 2.5 | Fix : ajouter `env: EXPO_PUBLIC_SUPABASE_URL / ANON_KEY` au step gradle de `build-android-apk.yml` (mêmes secrets que release.yml) | 🔲 À TESTER | Patch préparé (voir rapport du 2026-10-14). Le commit du workflow est refusé au jeton (scope `workflow` manquant) → à appliquer par l'utilisatrice dans l'éditeur web GitHub. |

## 3. Écran Tâches Android : crash au rendu « undefined is not a function »

**Versions : v0.4.59–0.4.62 — RÉSOLU (v0.4.62)**

| # | Hypothèse | Statut | Preuve / Fix |
|---|-----------|--------|--------------|
| 3.1 | Les effets DOM (drag & drop + `querySelectorAll` sur `data-tl-id`) s'exécutaient sous Hermes (pas de DOM) → crash au rendu de l'écran | ✅ PROUVÉE | Offset logcat reproductible ; fix : garde `if (Platform.OS !== 'web') return;` sur les deux effets (TasksScreen.tsx) + frontières `TasksDiagBoundary` (diagnostic, à retirer quand tout est stable). Confirmé par l'utilisatrice : « plus d'erreurs JavaScript ». |

## 4. Écran Tâches Android : « échec de l'ajout : Liste introuvable »

**Versions : v0.4.56–0.4.62 — partiellement résolu, à re-tester sur 0.4.63**

| # | Hypothèse | Statut | Preuve / Fix |
|---|-----------|--------|--------------|
| 4.1 | La liste « Tâches » par défaut, créée paresseusement par `migrateLists`, n'était JAMAIS persistée → chaque `readListsData()` régénérait un id différent → `switch(listId)` jetait « Liste introuvable » | ✅ PROUVÉE (cause réelle, fix insuffisant seul ?) | Code limpide (nativeTasksAdapter.ts) ; fix v0.4.62 : `readListsData` persiste immédiatement la donnée migrée. MAIS le logcat du 2026-10-13 21:10:26 (v0.4.62 installée) montrait ENCORE l'erreur → autre/second facteur. |
| 4.2 | Le round-trip `writeNote` → `readNote` échoue silencieusement en SAF pour `.123ecriture/tasklists.json` (fichier caché, premier fichier créé) : `readJson` avale TOUTES les erreurs (`try/catch → null`) → régénération d'id à chaque appel quand même | 🔲 À TESTER | Cohérent avec 4.1 restant actif sur 0.4.62. `writeNote` gère le cas « absent de l'index » (réutilise l'URI existante, cf. commentaire v0.4.41-fix4/appearance) mais aucune preuve qu'il marche pour CE fichier sur CE téléphone. Diagnostic nécessaire : afficher l'erreur SAF À L'ÉCRAN (console.* est désactivé en release — voir 7.3) ou journaliser dans le coffre. |
| 4.3 | Décalage d'ids entre les DEUX lectures séparées du chargement (`taskListsBridge.list()` et `getActive()` en Promise.all) si 4.2 actif : `list()` donne l'id A1 aux rangées, `getActive()` régénère A2 dans le state → tap sur la liste A1 → `switch(A1)` re-régénère A3 → « introuvable » | 🔲 À TESTER (sous-cause de 4.2) | Trace de code exacte ; aucun moyen de mesurer en release sans affichage écran. |
| 4.4 | Le tap adb sur « Ajouter » n'a pas atteint le bouton (test 00:28–00:30 : aucune tâche ajoutée, AUCUNE erreur affichée, aucun log possible en release) | 🔲 À TESTER | L'erreur aurait dû s'afficher (setAddError → visible à l'écran) ; rien vu. Soit le tap a raté, soit le handler est sorti tôt (bridge null ?). À refaire sur 0.4.63. |
| 4.5 | L'utilisatrice sur 0.4.62 : « plus d'erreurs JavaScript » | 🔲 À CONFIRMER en test réel | Le crash 3.x est réglé ; l'AJOUT réel d'une tâche reste à valider sur 0.4.63 (via les taps adb, puis persistance après relance de l'app). |

## 5. Historique connexe (résolu avant ce journal)

- **v0.4.41-fix4** : `writeNote` SAF refusait l'écriture des fichiers absents de l'index (chaque pull échouait) → création parents + réutilisation d'URI existante (anti-doublon « appearance (1).json »).
- **v0.4.50** : les tâches ne persistaient pas du tout sur Android (aucun pont natif) → pont `nativeTasksAdapter`.
- **v0.4.57** : démarrage sync différé (60 s) + watchdog de cycle — l'ouverture reste 100 % locale.
- **v0.4.62** : crash 3.x réglé ; bug 4 partiellement (voir lignes 4.1–4.5).

## 6. Limites de diagnostic connues (à lire AVANT d'investiguer le téléphone)

| # | Fait | Conséquence |
|---|------|-------------|
| 6.1 | APK release : `console.*` est désactivé (aucun log ReactNativeJS dans logcat — vérifié 2026-10-14, pid vivant, logcat vide) | Toute investigation téléphone doit passer par un AFFICHAGE À L'ÉCRAN (frontières d'erreur, bandeaux) ou un build local debug. |
| 6.2 | Samsung A13 multi-utilisateurs (user 0 + Secure Folder user 150) : `pm list packages` crashe sur user 150 | Toujours passer `--user 0`. |
| 6.3 | `adb push` vers `/data/local/tmp` échoue silencieusement (fichier absent) | Installer les APK par `adb install -r`, jamais par push manuel. |
| 6.4 | PC Windows : `pnpm typecheck` racine (turbo) → EPERM spawn | Lancer tsc/eslint/vitest PAR PAQUET, puis `git commit --no-verify` après vérification manuelle équivalente. |
| 6.5 | PC Windows : build natif Android impossible depuis le workspace (MAX_PATH 260 + dossiers `.pnpm` longs : codegen C++ échoue ; junction résolue par gradle, ça ne suffit pas) | Cloner le dépôt dans un chemin court PHYSIQUE (ex. `C:\123src`), `pnpm install`, copier `apps/mobile/.env.local`, build là-bas. |
| 6.6 | Environnement build local : JDK 17 + SDK Android (cmdline-tools) installés dans `~/.zcode/tools/` (pas d'admin : LongPathsEnabled=0) | Exporter `JAVA_HOME` et `ANDROID_HOME` avant tout gradlew. NDK 27.1.12297006 requis ; le réinstaller si `source.properties` manquant. |
| 6.7 | `expo prebuild` régénère `android/` et écrase les modifications manuelles du manifest | Toute config native (scheme OAuth, permissions) doit vivre dans `app.json` (le scheme `app123ecriture` y est depuis v0.4.63 — le filtre OAuth disparaissait sinon). |
| 6.8 | `app.json` doit rester du JSON STRICT (pas de commentaires) : `app.config.js` le lit à chaque commande expo | Pas de notes dans app.json — documenter ici ou dans le code. |
| 6.9 | CMake 3.22.1 (défaut AGP) boucle `build.ninja still dirty after 100 tries` sur expo-modules-core (réécriture à l'identique à chaque reconfigure — vérifié : contenu stable, mtime change) | Clone local : forcer `cmake.version = '3.31.5'` (bloc subprojects dans android/build.gradle du clone) + purger les `.cxx`. La CI Linux n'a pas ce problème. |
| 6.10 | Signature APK : `android/app/debug.keystore` est COMMITÉ → APK CI et APK local partagent la signature → `adb install -r` sans désinstallation | Si `INSTALL_FAILED_UPDATE_INCOMPATIBLE` un jour : le keystore a changé — désinstaller (perte session/registre, PAS des données du coffre). |

## 7. État courant (dernière mise à jour : 2026-10-14)

1. **Vaults distants** : cause prouvée (2.1), patch workflow prêt à appliquer ; APK 0.4.63 local avec Supabase en cours de build pour valider sur le téléphone.
2. **Ajout de tâche** : à re-tester sur 0.4.63 (lignes 4.4–4.5) ; si échec → afficher l'erreur SAF à l'écran (4.2).
3. **Notifications d'échéance** : implémentées (expo-notifications, pill 🔔 + section Paramètres) — à tester sur le téléphone.
4. **Workflow CI** : patch `build-android-apk.yml` à appliquer par l'utilisatrice (jeton sans scope workflow).
