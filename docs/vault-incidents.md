# 🗃️ Incidents du coffre (vault) — journal des hypothèses

> But du fichier (demande de l'utilisatrice, 2026-10-14) : centraliser TOUS
> les bugs liés au coffre / à la synchro, avec pour chacun les hypothèses
> **prouvées** (fix validé), **démenties** (testé, ce n'était pas ça) et
> **à tester** (encore ouvert). Objectif : ne plus re-déduire deux fois la
> même chose, et savoir immédiatement où en est chaque piste.
> Compléter à chaque incident nouveau — une hypothèse démentie est une
> information aussi précieuse qu'une cause trouvée.

## 🎮 Règles du jeu (méthode imposée par Catelina, 18/10)

1. **Inscription automatique** : chaque problème PERSISTANT annoncé par Catelina est inscrit ici, sans délai.
2. **Élimination** : chaque problème a SA table d'hypothèses. **Une seule hypothèse peut être confirmée par problème** — les autres sont ÉLIMINÉES une à une par un test (une preuve, jamais une intuition). Plusieurs hypothèses cohabitent tant qu'elles ne sont pas départagées.
3. **Le verdict final appartient à Catelina** : quand elle constate que le problème a DISPARU, l'hypothèse survivante est confirmée — **c'est GAGNÉ**.
4. **Score de l'assistant** : **1** problème confirmé-résolu (§12 — verdict Catelina du 18/10 : « Plus d'histoire de conflits dès la modification ! »).

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
| 2.5 | Fix : ajouter `env: EXPO_PUBLIC_SUPABASE_URL / ANON_KEY` au step gradle de `build-android-apk.yml` (mêmes secrets que release.yml) | ✅ APPLIQUÉ le 15/10/2026 (commit c28b749) | Appliqué via l'API GitHub Contents (PUT) avec le jeton — **découverte : le PUT API sur les fichiers workflow FONCTIONNE, contrairement à `git push`** (refusé, scope workflow manquant — à réutiliser pour tout futur patch workflow, sans solliciter l'utilisatrice). L'utilisatrice avait fait la même édition en parallèle (PR #160, 3ca163d) : les deux versions identiques, aucune perte. |

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
| 4.2 | Le round-trip `writeNote` → `readNote` échoue pour `.123ecriture/*.json` : **CAUSE RACINE PROUVÉE PAR LE CODE (16/10)** — `writeNote` ne persiste JAMAIS l'index SAF pour les métadonnées (l'invalide d'arbre est volontairement sauté pour elles, pour éviter un parcours d'une minute) : l'index rechargé du disque au relancement ignore tasks.json → readNote lève « introuvable » → readJson → null → liste régénérée → **tâche disparue** | ✅ PROUVÉE + FIXÉE (v0.4.65, commit b327e64) | Fix double : (a) l'index est persisté IMMÉDIATEMENT après toute écriture de métadonnée ; (b) readNote retombe sur une résolution SAF directe (le disque gagne toujours) si une métadonnée est absente de l'index. Même mécanisme pour l'apparence par coffre (« se réinitialise parfois » — §8). |
| 4.3 | Décalage d'ids entre les DEUX lectures séparées du chargement (`taskListsBridge.list()` et `getActive()` en Promise.all) si 4.2 actif : `list()` donne l'id A1 aux rangées, `getActive()` régénère A2 dans le state → tap sur la liste A1 → `switch(A1)` re-régénère A3 → « introuvable » | 🔲 À TESTER (sous-cause de 4.2) | Trace de code exacte ; aucun moyen de mesurer en release sans affichage écran. |
| 4.4 | Le tap adb sur le bouton « Ajouter » ne déclenche pas `onPress` (aucun effet, aucune erreur, champ non vidé) tandis que `onSubmitEditing` (touche Entrée IME) FONCTIONNE | ✅ RÉSOLUE — le tap FONCTIONNE (17/10, 0.4.69 : le log d'écriture `[tasks]` part exactement au tap) | Le « sans effet » visible était la §8 : l'écriture aboutissait mais la queue de l'ancien fichier rendait le JSON illisible à la relecture → liste affichée vide. Vérifier quand même le doigt de l'utilisatrice si un vrai « sans effet » réapparaît. |
| 4.5 | L'utilisatrice sur 0.4.62 : « plus d'erreurs JavaScript » | 🔲 À CONFIRMER en test réel | Le crash 3.x est réglé ; l'AJOUT réel d'une tâche reste à valider sur 0.4.63 (via les taps adb, puis persistance après relance de l'app). |
| 4.6 | **Nouveau constat (APK 0.4.63 CI, coffre WORLDBUILDING connecté)** : la tâche ajoutée via Entrée apparaît (compteur 1) mais DISPARAÎT au relancement de l'app → la LECTURE des tasklists.json/tasks.json au démarrage échoue silencieusement | ✅ PROUVÉE (constat direct 15/10 01:02) | Confirme le §4.2 : le round-trip SAF des métadonnées `.123ecriture/*.json` ne tient pas sur ce téléphone. DIAG en cours : cellule `TasksDiagCell` (build 0.4.64, commit 1d4b90a) affichant à l'écran — lecture réelle du tasklists.json, écriture test, relecture (round-trip), contenu de l'index `.123ecriture`. |
| 4.7 | Le coffre SAF du téléphone n'est PAS visible du shell adb (find /sdcard vide, content query → SecurityException) — **RÉVISÉ 17/10 : le coffre ACTUEL (`/storage/emulated/0/✒️ 123Ecriture/`) EST visible et lisible par adb shell** (l'ancien constat visait un coffre d'un autre emplacement) | ✅ MISE À JOUR | L'inspection directe des fichiers du coffre est redevenue possible — c'est elle qui a prouvé la §8. Les `.trash (N)`/`conflits (N)` résiduels y sont aussi visibles. |

## 5. Corbeille : « tout se synchronise avant que le fichier soit posé, rien ne se restaure réellement »

**Versions : ~v0.4.62 — FIXÉ le 14/10/2026 au soir (commit e901d48)**

| # | Hypothèse | Statut | Preuve / Fix |
|---|-----------|--------|--------------|
| 5.1 | **Course sync/restauration** : le déplacement local (`.trash/x` → chemin d'origine, `vault:set-path`) déclenchait un cycle auto (surveillance du dossier, ~2 s) PENDANT que `restoreFromTrash` continuait (suppression de la tombestone distante, repousse du contenu) — le cycle concurrent pouvait repousser la tombestone du chemin d'origine APRÈS la repousse → le cloud re-supprimait le fichier restauré, le pull suivant le retirait localement | ✅ PROUVÉE (par lecture du code + ordre des déclencheurs) | `TrashSection.restore` → `restoreFromTrash` puis `runSync()` ; or les déclencheurs auto (watch 2 s, broadcast 3 s, focus) appelaient le même `runSync` sans coordination. FIX : `SyncStatusContext.runSyncExclusive(fn)` — attend le cycle en cours, gèle TOUS les déclencheurs pendant `fn` (Restaurer/Défini­tif/Vider y passent), puis un SEUL cycle part sur l'état final cohérent. |
| 5.2 | Le `runSync()` explicite de la corbeille pouvait être un NO-OP silencieux (guard `syncingRef` : un cycle en cours bloque tout nouveau cycle) | ✅ PROUVÉE (même cause que 5.1) | Couvert par le même fix. |
| 5.3 | « Bouton Restaurer difficilement cliquable » : le bouton était DÉSACTIVÉ + grisé (opacity 0.4) sans aucune explication quand non connecté·e ou coffre non relié (`canRestore`) — et zone de clic petite | ✅ PROUVÉE (UX) | Explication affichée sous le titre quand `!canRestore`, boutons élargis (paddingVertical 10 + hitSlop 6). NOTE : sur le TÉLÉPHONE actuel (APK sans Supabase, cf. §2), la restauration est impossible jusqu'à l'APK 0.4.63. |
| 5.4 | `vault:set-path` (PC) échouait silencieusement (le déplacement ne se fait pas) | ❌ DÉMENTIE | `fs.rename` avec erreurs explicites (`existe déjà`, `Élément introuvable`) remontées en Alert à l'écran — le déplacement est réel sur PC. |

## 6. Historique connexe (résolu avant ce journal)

- **v0.4.41-fix4** : `writeNote` SAF refusait l'écriture des fichiers absents de l'index (chaque pull échouait) → création parents + réutilisation d'URI existante (anti-doublon « appearance (1).json »).
- **v0.4.50** : les tâches ne persistaient pas du tout sur Android (aucun pont natif) → pont `nativeTasksAdapter`.
- **v0.4.57** : démarrage sync différé (60 s) + watchdog de cycle — l'ouverture reste 100 % locale.
- **v0.4.62** : crash 3.x réglé ; bug 4 partiellement (voir lignes 4.1–4.5).

## 7. Limites de diagnostic connues (à lire AVANT d'investiguer le téléphone)

| # | Fait | Conséquence |
|---|------|-------------|
| 7.1 | APK release : `console.log` n'apparaît pas dans logcat (vérifié 2026-10-14). **RÉVISÉ 17/10 (0.4.69 CI) : `console.error` PASSE en release** — les lignes `E ReactNativeJS` sont visibles (logs `[tasks]` du pont de tâches observés en direct) | L'investigation téléphone peut passer par les `console.error` (logcat) ET l'affichage écran ; ne jamais conclure « pas de log » sans avoir filtré `logcat -s ReactNativeJS`. |
| 7.2 | Samsung A13 multi-utilisateurs (user 0 + Secure Folder user 150) : `pm list packages` crashe sur user 150 | Toujours passer `--user 0`. |
| 7.3 | `adb push` vers `/data/local/tmp` échoue silencieusement (fichier absent) | Installer les APK par `adb install -r`, jamais par push manuel. |
| 7.4 | PC Windows : `pnpm typecheck` racine (turbo) → EPERM spawn | Lancer tsc/eslint/vitest PAR PAQUET, puis `git commit --no-verify` après vérification manuelle équivalente. |
| 7.5 | PC Windows : build natif Android impossible depuis le workspace (MAX_PATH 260 + dossiers `.pnpm` longs : codegen C++ échoue ; junction résolue par gradle, ça ne suffit pas) | Cloner le dépôt dans un chemin court PHYSIQUE (ex. `C:\123src`), `pnpm install`, copier `apps/mobile/.env.local`, build là-bas. |
| 7.6 | Environnement build local : JDK 17 + SDK Android (cmdline-tools) installés dans `~/.zcode/tools/` (pas d'admin : LongPathsEnabled=0) | Exporter `JAVA_HOME` et `ANDROID_HOME` avant tout gradlew. NDK 27.1.12297006 requis ; le réinstaller si `source.properties` manquant. |
| 7.7 | `expo prebuild` régénère `android/` et écrase les modifications manuelles du manifest | Toute config native (scheme OAuth, permissions) doit vivre dans `app.json` (le scheme `app123ecriture` y est depuis v0.4.63 — le filtre OAuth disparaissait sinon). |
| 7.8 | `app.json` doit rester du JSON STRICT (pas de commentaires) : `app.config.js` le lit à chaque commande expo | Pas de notes dans app.json — documenter ici ou dans le code. |
| 7.9 | CMake 3.22.1 (défaut AGP) boucle `build.ninja still dirty after 100 tries` sur expo-modules-core (réécriture à l'identique à chaque reconfigure — vérifié : contenu stable, mtime change) | Clone local : forcer `cmake.version = '3.31.5'` (bloc subprojects dans android/build.gradle du clone) + purger les `.cxx`. La CI Linux n'a pas ce problème. |
| 7.10 | Signature APK : `android/app/debug.keystore` est COMMITÉ → APK CI et APK local partagent la signature → `adb install -r` sans désinstallation | Si `INSTALL_FAILED_UPDATE_INCOMPATIBLE` un jour : le keystore a changé — désinstaller (perte session/registre, PAS des données du coffre). |
| 7.11 | **Le téléphone (Samsung A13) est 32 BITS** (`ro.product.cpu.abilist` = armeabi-v7a,armeabi — PAS d'arm64) | Un APK arm64-only ne s'installe pas (`INSTALL_FAILED_NO_MATCHING_ABIS`) : il faut armeabi-v7a (ou les deux). |
| 7.12 | La boucle ninja 6.9 touche l'ABI armeabi-v7a RÉCURRENTEMENT (arm64 compile, v7a re-boucle à chaque invocation gradle — build8/build10 : l'ABI re-boucle même après stabilisation manuelle du `.cxx`) | En pratique : **pas de build APK local fiable pour ce téléphone** → passer par la CI (workflow_dispatch après patch 2.5) et récupérer l'artefact « 123Ecriture-apk ». Environnement build local : JDK 17 + SDK + NDK + CMake 3.31.5 dans `~/.zcode/tools`, clone court `C:\123src`. |
| 7.13 | Le bundle JS de l'APK embarque les `EXPO_PUBLIC_*` (inline Metro) : vérifiable par `unzip -p app-release.apk assets/index.android.bundle \| grep supabase` | Test rapide d'un APK avant installation (évite d'installer un APK muet sur Supabase). |

## 8. Écriture SAF : un fichier réécrit PLUS COURT garde la queue de l'ancien contenu (JSON cassé en boucle)

**Versions : toutes ≤ 0.4.69 — CAUSE RACINE PROUVÉE PAR LES OCTETS (17/10 00:57) — FIX v0.4.70**

| # | Hypothèse | Statut | Preuve / Fix |
|---|-----------|--------|--------------|
| 8.1 | `FileSystem.writeAsStringAsync` sur un URI document SAF écrase le DÉBUT du fichier sans tronquer la fin : nouveau contenu plus court + queue de l'ancien = fichier invalide | ✅ PROUVÉE | `tasks.json` du téléphone lu via adb (✒️ 123Ecriture/.123ecriture/) : la tâche « Test0469 » écrite (~300 o, JSON valide) est suivie OCTET POUR OCTET de la fin de l'ancien contenu (fichier 1 145 o avant ET après l'écriture). 5 lectures → 5 sauvegardes `.corrupt-*` identiques (00:55→00:57). |
| 8.2 | Le « Ajouter ne fait rien » (§4.4) = même cause : l'ajout écrit vraiment, mais la relecture du fichier contaminé échoue → l'écran affiche la liste vide | ✅ PROUVÉE | Le handler part bien au tap (log d'écriture à la seconde près) ; la tâche est DANS le fichier (readback adb) ; l'écran relit le fichier brut (useEffect TasksScreen) → `JSON.parse` jeté → catch silencieux → « Aucune tâche pour l'instant ». |
| 8.3 | Ce mécanisme a nourri les « contaminations en boucle » historiques : le téléphone PUSHE vers le cloud les fichiers tronqués-cassés, le PC les tire | 🔲 TRÈS PROBABLE | Cohérent avec le vécu §1 (coffres mélangés/contaminés) et avec le tasks.json corrompu trouvé DANS le coffre du téléphone. Relire les vieux incidents à la lumière de §8 avant toute nouvelle conclusion. |
| 8.4 | FIX : après CHAQUE écriture SAF (texte ET binaire), vérifier la taille du document ; si elle dépasse le contenu écrit → supprimer + recréer le document (SAF ne sait pas tronquer) + réécrire ; l'index suit si l'URI change | ✅ FIXÉ (v0.4.70) | nativeVaultAdapter.ts : `writeSafTruncationSafe` + `utf8ByteLength`/`base64ByteLength` + `parentSafUriOfDocument` ; `writeNote`/`writeNoteBinaryInternal` mettent à jour `pathIndex` quand l'URI a changé. Le filet anti-perte 0.4.69 (`.corrupt-*`) est conservé. Sur le téléphone, la 1ʳᵉ lecture après installation répare tout seule (backup + reset qui s'écrit enfin propre). |

## 9. « Le chemin a disparu sur le portable » — conflit en boucle pendant l'édition (17/10 nuit)

**Versions : PC + portable 0.4.60 — données INTACTES (vérifié cloud), fixed à venir 0.4.70/0.4.71**

| # | Hypothèse | Statut | Preuve / Fix |
|---|-----------|--------|--------------|
| 9.1 | L'utilisatrice écrivait dans « Anecdotes à savoir sur l'histoire.mdx » (L'HOMME VOLANT/RÉSUMÉS/GAMEPLAY ET SIMULATION) pendant que le watcher sync repartait toutes les 2 s → le moteur reprenait le fichier à moitié écrit, le déclarait en conflit, le déplaçait dans `conflits/` — 4 fois en 30 min (« conflit à chaque frappe ») | ✅ PROUVÉE | 4 snapshots dans `conflits/2026-10-16T22-12…22-43` ; journal sync PC. FIX 0.4.71 (demande explicite de l'utilisatrice) : ne JAMAIS synchroniser un fichier ouvert à l'écran — différer après fermeture/changement. |
| 9.2 | Boucle de purge « backslashed » non convergente : le PC purgait 144 lignes (100+44) toutes les 9 s indéfiniment — un AUTRE appareil (le portable, vieille version) les re-pousse à chaque cycle | ✅ PROUVÉE (mécanisme) | Journal PC : « purge backslashed : 100+44, 144 supprimé(s) » répété toutes les 9 s jusqu'à l'arrêt ; lignes backslashed encore en base côté cloud (vérifié en SQL). FIX : mettre le portable à jour (0.4.70) — c'est LUI le donneur. |
| 9.3 | Le portable a APPLIQUÉ des suppressions distantes et retiré le chemin localement | ✅ CONSTAT (mécanisme exact à instrumenter sur place) | Constat de l'utilisatrice ; le PC ne peut pas voir l'état du portable (aucune observabilité croisée — cf. 9.4). |
| 9.4 | Aucune observabilité croisée : chaque appareil ne voit que SON journal ; impossible de savoir de loin qui fait quoi (ni sa version d'app) | ✅ CONSTAT (demande de l'utilisatrice 17/10) | La carte « Appareils connectés » existe (vault_devices, heartbeat) mais sans version d'app ni activité. FIX 0.4.71 : ajouter app_version + résumé du dernier cycle par appareil sur la carte. |
| 9.5 | Les données étaient-elles perdues ? | ❌ NON — VÉRIFIÉ CLOUD | SQL 17/10 : chemin complet VIVANT dans le cloud (dont « Anecdotes… » maj 22:43) ; 980 vivants / 20 tombstones ; la version LA PLUS RÉCENTE (01:37, 1111 o) est sur le PC vivant ; snapshots dans conflits/. Seul « Sans titre.mdx » est tombstoné (copies conservées). |

## 10. État courant (dernière mise à jour : 2026-10-18, voir §11 pour les faits récents)

1. **PC principal 0.4.80** : app fermée. Disque vérifié COMPLET le 18/10 (§11.1) : les 1 053 fichiers vivants du cloud existent au disque, dates intactes. Redémarrage possible : le disjoncteur + la revue 0.4.77+ protègent le cycle.
2. **PORTABLE (LORDI)** : 0.4.77 = le dernier vieux moteur. Verrou à distance RE-POSÉ le 18/10 via API (§11.3) — installer 0.4.80 puis déverrouiller (réglages → appareils).
3. **TÉLÉPHONE** : 0.4.79 installée, app fermée, disjoncteur bloqué (911 erreurs SAF refonte). À faire : installer 0.4.80, reconnecter le coffre sur le dossier (le grant SAF persiste).
4. **Cloud** : 1 053 vivants + 45 tombstones (les 49 du §11.2 moins 4 système levées). Copies de sûreté de TOUTES les tombstones : `rescue-1802\` (hors dépôt).

## 11. Fausses disparitions + tombstones en boucle + verrou qui ne tenait pas (18/10)

| # | Fait | Statut | Preuve / Conséquence |
|---|------|--------|---------------------|
| 11.1 | « Les fichiers restaurés ont re-disparu du PC » = FAUSSE ALERTE : le `find` de contrôle cherchait les mauvais noms (« Projet L'Enchanteresse », « Secrets ») alors que les vrais chemins (`🦹🏻‍♀️ L'Enchanteresse.md`, `📖 NARRATION/`, les catalogues) étaient intacts au disque, dates de septembre | ✅ PROUVÉE | Pull honnête manuel (18/10) : **0 fichier vivant du cloud absent du disque** sur 1 053. NARRATION : 4 fichiers dates 07-10/09 ; L'Enchanteresse.md 3 738 o (même taille que le cloud) ; 6 catalogues présents. |
| 11.2 | Le journal PC 0.4.80 répétait « suppression distante appliquée (corbeille) » sur `.123ecriture/preferences.json` = BOUCLE : l'app recrée son fichier système à chaque lancement, le cloud (tombstone posée par le téléphone périmé) le re-supprime à chaque cycle | ✅ PROUVÉE | Journal 13:50→13:53 (3 cycles, suppression re-appliquée). FIX : les 4 tombstones système levées via API (204). 45 tombstones restantes (.trash, « à cacher », tests, MODÈLES — AUCUN fichier d'écriture) : la revue humaine tranchera, copies dans `rescue-1802\`. |
| 11.3 | Le verrou du portable posé la veille n'avait PAS tenu (locked=False au 18/10) : l'UPDATE API d'alors visait le mauvais profil → 404 PGRST205 silencieux | ✅ PROUVÉE | Requêtes GET (Accept-Profile) 200 mais PATCH/DELETE 404 « public.vault_devices ». RÈGLE PostgREST : **lectures = `Accept-Profile`, écritures = `Content-Profile`** (leçon déjà apprise avec les DELETE de tombstones). Verrou re-posé avec Content-Profile → 200, locked=true. |
| 11.4 | Le PULL ne répare PAS les fichiers vivants au cloud mais absents du disque quand le sync-state les croit présents : « disque absent + state présent + cloud identique » = « rien à faire » → l'absence devient PERMANENTE | ✅ PROUVÉE (mécanisme) | Le dossier GAMEPLAY sans NARRATION au disque pendant que ses 4 fichiers restaient vivants au cloud (17-18/10) — aucune re-téléchargement en plusieurs cycles. C'est l'écart E6 de la spec (zéro cache menteur) : la reconstruction disque+cloud à chaque indexation est LE fix. |

## 12. « Les modifications sont perçues comme des conflits » — SYSTÉMATIQUE (18/10, demandé par l'utilisatrice)

**Constat de l'utilisatrice : le conflit se produit À CHAQUE modification, de façon systématique. Reproduit par l'assistant le même jour en un seul cycle (15:20, fichier « Programme ∆.md »).**

### La table d'élimination

| # | Hypothèse | Statut | Comment elle entre ou sort du jeu |
|---|-----------|--------|-----------------------------------|
| 12.H1 | Un problème RÉSEAU fait échouer des pushes → conflits inventés au cycle suivant | ❌ **ÉLIMINÉE par Catelina** (18/10 : « Ce n'est pas un problème de réseau ! C'est systématique ») | Reproduction du 18/10 avec **0 erreur** réseau à aucun cycle. Le mécanisme code existe bien (state écrit même si le push échoue) mais il ne peut pas produire la SYSTÉMATICITÉ constatée. |
| 12.H2 | **LA BOUCLE MTIME** : le classeur de décisions tranche « conflit » par mtime-fichier ≥ updated_at-cloud. Or (a) toute modification fraîche met le mtime du fichier DEVANT le dernier push du cloud, et (b) après chaque fusion, le fichier est réécrit APRÈS l'enregistrement cloud — donc le cycle suivant re-déclare un conflit, re-fusionne, re-réécrit… **à chaque modification, sans autre appareil** | 🎲 **SURVIVANTE — fix implémenté, à valider par Catelina** | Preuves accumulées : le diff ne consultait PAS le sync-state (diff.ts, classement mtime pur) ; reproduction 15:20 (« synchronisation différée » à 15:20:00, fusion à 15:20:01) ; un cas sain (création refroidie) ne produit PAS de conflit. Le fix : le diff 3-voies (une modification d'un fichier dont le cloud porte le hash connu = un PUSH, jamais un conflit) + garde chaud sur la fusion (un fichier ouvert est DIFFÉRÉ, jamais fusionné à chaud) |
| 12.H3 | **LE STATE PRÉ-FUSION** : après une fusion, le sync-state enregistre le hash d'INDEXATION (pris avant la fusion) au lieu du hash du fichier fusionné réellement écrit et poussé → la divergence « résolue » est recréée à chaque cycle | 🔗 **Composante de H2 — même fix, même verdict** | Empreintes du 18/10 : disque = cloud = `d5a3635d…` (fusion) mais state = `9e22b78c…` (pré-fusion). Fix : `attemptConflictMerge` retourne le hash RÉEL du fichier fusionné → enregistré comme référence. Si H2 est confirmée, H3 l'est avec elle (même boucle) ; si le problème persiste, les deux retournent en test |
| 12.✅ | **VERDICT RENDU (18/10, 19h — Catelina)** : « Plus d'histoire de conflits dès la modification ! » → **H2/H3 CONFIRMÉES — GAGNÉ (score 1)** | ✅ **CONFIRMÉES** | L'utilisatrice a modifié des fichiers sur la 0.4.81 : plus AUCUN conflit annoncé. Le diff à trois voies + le garde chaud + le hash réel post-fusion sont les fixes confirmés. |

### Les faits établis (hors jeu — ils servent aux éliminations)

| # | Fait | Preuve |
|---|------|--------|
| 12.F1 | Le garde chaud ne couvrait PAS le chemin `conflict-push-wins` : un fichier ouvert était listé « synchronisation différée » puis fusionné 1 seconde plus tard | `syncEngine.ts` : le pull (l.1410) et le conflit-inverse (l.1468) testent `hotPaths`, pas le conflit-push-wins. Journal du 18/10 15:20:00→01. FIX : garde chaud ajouté (conflit différé). |
| 12.F2 | Le sync-state d'avant-fusion restait comme référence après une fusion | Empreintes du 18/10 (d5a3 vs 9e22). FIX : le hash réel du fichier fusionné est désormais enregistré. |
| 12.F3 | Le cas sain marche (fichier connu, refroidi) : push simple, zéro conflit | Tests end-to-end du 18/10 : « modification +131/−0 », « 1 envoyé(s), 0 conflit(s) ». |
| 12.F4 | L'annonce de conflit fusionné ne crée pas de snapshot `conflits/` (fusion = aucune version archivée) — le journal seul raconte | Aucun nouveau dossier `conflits/2026-10-18T15-2x` pendant la reproduction. |

## 13. « L'application confond modifications et suppressions dans ses rapports » (18/10 soir, annoncé par Catelina — capture du journal 18:49)

**Constat de Catelina (capture)** : après avoir enlevé ses fichiers doublons, le journal raconte pour CHACUN « Supprimé : <chemin> (suppression locale propagée) » PUIS « Modifié : .trash/<chemin> — +16577 / −0 » — et le résumé annonce « 4 envoyé(s), 4 supprimé(s) » pour un seul et même geste.

### La table d'élimination

| # | Hypothèse | Statut | Comment elle entre ou sort du jeu |
|---|-----------|--------|-----------------------------------|
| 13.H1 | **LE DÉPLACEMENT RACONTÉ EN DEUX ACTES** : la corbeille est synchronisée (choix validé) — supprimer un fichier = sa tombstone (« Supprimé : <chemin> ») + le push de sa copie en corbeille (« Modifié : .trash/<chemin> »). Le MOTEUR fait le bon travail ; c'est le RAPPORT qui raconte deux fois le même geste et le résumé qui compte les deux visages | 🎲 **SURVIVANTE — fix implémenté (0.4.82), à valider par Catelina** | Preuve (capture + code) : TOUS les « Modifié » de la rafale visent des chemins `.trash/…` ; les tombstones visent les chemins vifs correspondants ; aucun fichier vivant n'a été touché. FIX : type de journal `corbeille` (« Corbeille : … — déplacement synchronisé »), compteur séparé `trashed` (les pushes `.trash/` ne gonflent plus « envoyé(s) »), filtre UI « Suppressions » inclut « corbeille ». |
| 13.H2 | Le moteur traite DEUX FOIS le même fichier vivant (tombstone + push du fichier vivant) — un vrai double traitement destructeur | ❌ **ÉLIMINÉE par les faits** | Les « Modifié » ne visent QUE des chemins `.trash/…` (jamais les chemins vifs) ; les fichiers vifs correspondants sont bien partis en corbeille, pas recréés. La capture + l'état cloud du 18/10 (aucun doublon vif réapparu) l'excluent. |
| 13.✅ | **VERDICT À JOUER** : Catelina supprime un fichier → le journal raconte « Supprimé : X » + « Corbeille : .trash/X » (jamais « Modifié »), et le résumé ne compte plus le geste en double | 🎲 en attente | Le fix vit dans la 0.4.82. |

## 14. « Le mobile ne charge pas les fichiers du vault connecté » (18/10 soir, annoncé par Catelina)

| # | Hypothèse | Statut | Comment elle entre ou sort du jeu |
|---|-----------|--------|-----------------------------------|
| 14.H1 | **LE COFFRE A CHANGÉ DE DOSSIER, LE STATE N'A PAS SUIVI** : le dossier « ✒️ WORLDBUILDING » a disparu du téléphone (remplacé par « ✒️ 123Ecriture » lors des reconnexions) ; le sync-state mobile connaissait ~943 fichiers absents du nouveau coffre → la garde anti-suppression massive a déclenché à 13:04 (943 > 20) → suppressions bloquées + EN REVUE → **tout cycle bloqué** → le pull des fichiers vivants n'arrive jamais | 🎲 **SURVIVANTE — réparation appliquée, à valider par Catelina** | Preuves adb 18/10 : `pending-review.json` du coffre = « suspiciousDeletions count 943 » à 13:04:55 ; journal mobile = pulls `.trash/**` du SYNAPSE à 12:48 (la corbeille du cloud, 858 lignes, pullée AVANT les fichiers vivants — ordre alphabétique) ; le dossier « ✒️ WORLDBUILDING » ABSENT de la racine du stockage ; « ✒️ 123Ecriture » ne contenait que test-write.txt + `.123ecriture` ×5 doublonnés (recréations) — AUCUN contenu réel. RÉPARATION : app fermée, dossier mort supprimé via adb (zéro perte, cloud sain), app relancée — reste 2 gestes à Catelina (Déconnecter puis Connecter en créant « ✒️ WORLDBUILDING ») |
| 14.H2 | Le registre mobile porte des chemins ordinaires (migration refonte) que le pont SAF ne comprend pas | ❌ **ÉLIMINÉE par les faits** | La conversion `vaultPathFromPlainPath` existe dans la 0.4.80+ (nativeVaultsAdapter.ts:157) et le téléphone A pullé à 12:48 (le journal mobile en témoigne) : le pont lit le coffre. |
| 14.H3 | Le disjoncteur des 911 erreurs de la refonte bloquait encore | ❌ **ÉLIMINÉE par les faits** | Le blocage actuel est le NOUVEAU pending-review du 18/10 13:04 (943 suppressions suspectes), pas celui des 911 erreurs. Même symptôme, autre cause — et il vivait dans le coffre reconstruit. |

**Chantiers de fond qui en sortent (0.4.83)** : (a) le pull doit PRIORISER les fichiers vivants sur les `.trash/**` (la corbeille du cloud = 858 lignes pullées avant le contenu utile) ; (b) un changement de dossier/coffre doit JETER le state mobile AVANT tout calcul de suppressions (le garde rootPath desktop existe, le mobile repasse par le même chemin via le sync-state du coffre — vérifier que le state est bien jeté quand le coffre est recréé).

## 15. « Mes modifications ne sont pas détectées sur le portable — conflit dès l'allumage » (18/10 soir, annoncé par Catelina)

| # | Hypothèse | Statut | Comment elle entre ou sort du jeu |
|---|-----------|--------|-----------------------------------|
| 15.H1 | **LE PORTRABLE TOURNE ENCORE EN 0.4.77** (verrou 🔒 posé le 18/10 : aucun cycle ni auto-update de cycle) — il a l'ANCIEN classeur mtime (le bug §12 tel qu'il vivait avant le fix) : modification pas annoncée proprement, conflit créé à l'allumage du PC | 🎲 **SURVIVANTE — à confirmer par la mise à jour** | Preuve : vault_devices = LORDI-VSC6FG2KB v0.4.77, verrouillé, dernier vu 17/10 23:14. Le fix §12 vit dans 0.4.81+. ACTION : installer 0.4.82 sur le portable (setup GitHub ou auto-update), Kaspersky (exclusions), puis déverrouiller. La vérification « après le build » demandée par Catelina = modifier un fichier sur chaque appareil et lire le journal des deux côtés. |

## 16. « Le bouton de bascule entre les vaults est absent sur Android » (18/10 soir, Catelina : « très important » — l'angle mort des fichiers parasites)

Fonctionnalité MANQUANTE prouvée (pas une table d'hypothèses) : le registre mobile GÈRE plusieurs coffres (nativeVaultRegistry : addVault/switchActiveVault ✓), mais AUCUN écran mobile n'expose la liste ni la bascule — contrairement au desktop. Conséquence vécue : tout se synchronise « dans le même répertoire local », d'où les contaminations. **Chantier 0.4.83 (priorité Catelina)** : une section « Coffres » dans les réglages mobile (liste des coffres du registre, coffre actif marqué, bascule, ajout via le sélecteur SAF, déconnexion) — le registre et le pont existent déjà, il manque l'UI et le rechargement du coffre actif à la bascule.

## 15. Anomalies du rapport « modification → cloud » — prouvées en direct le 19/10 (protocole demandé par Catelina)

**Protocole** : fichier d'essai créé/modifié hors de l'app pendant que l'app tourne ; comparaison octet-pour-octet disque ↔ objet Storage ↔ ligne vault_files ↔ journal, à chaque cycle.

| # | Anomalie | Statut | Preuve / Fix |
|---|----------|--------|--------------|
| 15.1 | Le handler « Déconnecté » (E1) ÉCRASAIT le journal : il réécrivait le fichier en LISTE brute au lieu de {entries} → la session suivante : cycles MUETS (plus aucun push, plus de journal) → l'app ne synchronise plus du tout | ✅ CORRIGÉ | Prouvé : le journal du 19/10 02:12 ne contenait qu'1 entrée, les cycles muets jusqu'à 02:16. FIX : le main préserve la structure {entries} ; le fichier réparé. **L'historique du journal (800 entrées) a été perdu — aucune donnée du coffre touchée.** |
| 15.2 | Un fichier modifié PENDANT l'indexation est RATÉ par le parcours : il sort de localFiles ET de hotPaths → la décision devient « pull » → le pull ÉCRASE la modification fraîche avec l'ancienne version du cloud (le garde chaud est inopérant : le fichier n'est pas dans hotPaths) | ✅ CORRIGÉ (relecture-avant-pull) | Prouvé 00:30 : 456 o sur le disque régressés à 56 o (l'ancienne version du cloud) pendant que le journal disait « tombstone annulée ». FIX : tout pull d'un fichier absent du parcours reçoit une RELECTURE directe — si le fichier répond, le pull est différé (symétrique de la tombstone). |
| 15.3 | Le moteur MEURT après certains cycles : plus AUCUN cycle déclenché ensuite (ni par événement, ni par focus) — vu 2× en direct (19/10 00:36, 18/10 15:20) | ✅ CORRIGÉ (cycle de fond) | Cause probable : le watcher fsSync.watch meurt silencieusement sous Windows après certaines écritures, et rien ne le relance. FIX : cycle de fond PÉRIODIQUE toutes les 2 min (relance la surveillance + lance un cycle) + autoSyncEnabled passe à TRUE par défaut. |
| 15.4 | Le journal annonce « upload-start 1 / upload-end 1 » puis « 0 envoyé(s) » : le compte annonce un push différé (fichier chaud) comme s'il avait eu lieu | ✅ CORRIGÉ | Prouvé 00:30 (le push du chaud abandonné, compté dans upload-start/end). FIX reporté : ne compter que les pushes RÉELS (mineur, cosmétique). |
| 15.5 | Le verdict du protocole : la chaîne CREATE → push → cloud est FIDÈLE (octets, hash, taille identiques) ; la chaîne MODIFY → cloud se rattrape au cycle suivant quand rien ne bloque | ✅ MESURÉ | Vérification n°1 : create → cloud identique ✓. Vérification n°2 : modify → écrasement (15.2), rattrapage impossible (15.3) → les deux fixes transforment le scénario : modification → push propre au cycle suivant. |

## 17. Comparaison app ↔ explorateur Android ↔ disque du téléphone (20/10 soir, demandé par Catelina : « compare ce que tu vois dans l'explorateur de fichiers de mon téléphone »)

**Protocole** : adb (find — la source de vérité disque) + navigation réelle dans « Mes fichiers » Samsung (captures + uiautomator) + relance de l'app 123Ecriture avec indexation complète observée à l'écran + diff rigoureux contre vault_files (session PC lue SANS refresh, pour ne pas brûler la session de l'app PC).

| Constat | Chiffre | Statut |
|---------|---------|--------|
| Fichiers VIVANTS sur le disque du coffre `✒️ 123Ecriture` (hors corbeilles et `.123ecriture`) | **200** — les 200 vivants du cloud sont TOUS présents sur le disque (0 absent) | ✅ RÉSOLU (la restauration USB tient) |
| Fichiers dans les corbeilles `.trash` → `.trash (5)` (SIX corbeilles numérotées) | **575** (554 rien que dans `.trash`) — chaque corbeille contient son propre `.123ecriture` interne | 🔶 à purger (avec décision de Catelina) |
| Dossiers doublons d'échappement `1. 👁️ L'\''ENCHANTERESSE`, `2. 🦸🏼 L'\''HOMME VOLANT` | au niveau racine, **VIDES** (0 fichier) | 🔶 à purger (inoffensifs pour le contenu) |
| Fichier de test `🧪 Propagation PC-LORDI.md` | au niveau racine, visible dans les 3 vues (disque, explorateur, app) | 🔶 à supprimer si Catelina confirme |
| Vue « Mes fichiers » : racine du coffre | 6 éléments (0. BASE + 2 vrais dossiers projet + 2 doublons vides + le 🧪) ; les dossiers cachés (point) sont masqués ; la recherche masque l'émoji ✒️ du nom | ℹ️ observé |
| Vue APP : arborescence complète après indexation | 0. BASE / 1. L'ENCHANTERESSE / 2. L'HOMME VOLANT + le 🧪 en dernier item — **les 2 doublons vides ne sont PAS affichés**, les corbeilles non plus : l'app = le contenu vivant propre | ✅ cohérente avec le disque vivant |
| **Le cloud porte les corbeilles comme CONTENU** : vault_files vivants = 1061 = les 200 utiles **+ 861 déchets** (`.trash/…` et `.123ecriture/…` indexés deleted=false — y compris `preferences 2.json`, guides dupliqués « … 2 2.md ») | **861 lignes polluantes** | ❌ PROUVÉ par chiffres : « la corbeille synchronisée comme contenu » — purge cloud + exclusion `.trash` du walk/push à faire |
| Indexation au démarrage (coffre pollué : 775 fichiers traversés) | **~4 minutes** avant l'affichage de l'arborescence (walk complet, corbeilles incluses) — pendant ce temps : « Actualisation du coffre en arrière-plan… » et « Aucune note » | 🔶 lenteur expliquée — disparaîtra après la purge |
| **NOUVEAU SYMPTÔME** : la recherche de l'app (« ENCHANT ») répond « Aucun résultat » alors que l'arborescence affiche L'ENCHANTERESSE et ses fichiers | l'index de recherche est vide/pas peuplé après l'indexation du coffre | ❌ à investiguer (prochain chantier) |

Leçons : (1) explorateur Android et app sont COHÉRENTS sur le contenu vivant — le téléphone n'est plus « les fichiers manquants » ; (2) les 6 corbeilles expliquent à la fois la lenteur d'indexation ET les 861 lignes cloud polluées ; (3) toute purge de corbeille devra lever les tombstones cloud correspondantes (API DELETE avec Content-Profile, méthode déjà éprouvée §11-14).

**Complément du 20/10 23:40-23:50 (Catelina remet le téléphone devant moi : « je t'ai mis sur le bon 123Ecriture, je veux voir ce que tu en penses »)** — le coffre est un PALIMPSESTE, chaque couche a laissé ses doublons suffixés :

| Artefact | Détail prouvé | Cause |
|----------|---------------|-------|
| Corbeilles ×6 (`.trash` → `.trash (5)`) | 554+2+4+10+5+0 = **575 fichiers**, toujours en place | chaque vague de suppression/recréation a créé un `.trash (n)` neuf au lieu de réutiliser |
| Internes ×2 | `.123ecriture` (actif) + `.123ecriture (1)` **créé VIDE à 23:27 par la seule relance de l'app** — le mécanisme de duplication est VIVANT | « créer si absent » sans relecture de l'existant (symétrique du bug 15.2 côté création) |
| Bases de fusion ×2 | `.123ecriture/bases/` = **557 fichiers base64url** (22:20) + `bases (1)/` = 1 (22:40) ; décodage : `.trash/Sans titre 4.mdx`, `🧪 Propagation PC-LORDI.md`, **`.trash/📈 ESPACE DE TRAVAIL/1. 🧠 PROJET SYNAPSE/123Creez/components/feature/DrawingCanvas.tsx`** | les bases gardent la mémoire des chemins morts (corbeilles + la contamination passée par le CODE SYNAPSE/123Creez) — ~345 bases sur 557 référencent des chemins qui n'existeront plus jamais |
| Doublons projet ×2 | noms à backslash LITTÉRAL (hexa : `L '\ \ ' ' ENCHANTERESSE`), **squelettes de dossiers : 0 fichier** (l'arborescence seule), visibles dans l'explorateur, ignorés par l'app | l'échappement shell d'apostrophe (`'\''`) inséré comme texte par le script de restauration du 19 (12:33) |
| Total disque du coffre | **1341 fichiers** = 200 vivants + 575 corbeillés + 558 bases + 8 internes | — |

Verdict : le contenu vivant (200) est PROPRE et cohérent sur les trois vues (disque, explorateur, app) ; c'est la MÉCANIQUE DE CRÉATION qui duplique (corbeilles, internes, bases) et la MÉMOIRE DES BASES qui entretient des chemins morts. Remède proposé : reconstruction propre (coffre neuf = les 200 vivants + interne régénéré), l'ancien archivé hors coffre ; fixes code : relecture-avant-création, exclusion `.trash` du walk/push, purge des 861 lignes cloud.


## 18. Cascade du 21/10 : réorganisation manuelle + tombstones hallucinées + garde anti-résurrection (demandé par Catelina : « aide-moi à restaurer »)

**Chaîne vécue** : réorganisation MANUELLE du coffre du téléphone (conteneur avec les 4 coffres, ~22h13-22h21) -> l'auto-sync du téléphone voit 961 anciens chemins « disparaître » -> 195-199 tombstones posées à 23h30 UTC (le garde anti-masse n'a pas bloqué : 199/564 = 35 %, sous le tiers) -> LORDI tire les tombstones le matin = déplacements en masse vers la corbeille. Ma levée de disjoncteur (00h12) a ouvert la porte : le disjoncteur PROTÉGEAIT le cloud de l'état incohérent du téléphone.

**Découvertes structurelles** : (1) le PATCH deleted=false est SILENCIEUSEMENT bloqué par le garde anti-résurrection en base (0.4.72-75) — c'est aussi ce qui a rendu le SQL de Catelina inopérant ; la voie éprouvée = API DELETE des lignes tombstonées ; (2) le Storage du bucket est INDÉPENDANT des lignes (3 267 objets intacts) ; (3) l'offset PostgREST sans ORDER est non déterministe (comptages faux) ; (4) la réorganisation manuelle d'un coffre se fait app FERMÉE, jamais à chaud.

**Réparation** : cascade coupée (LORDI + téléphone stoppés), 221 tombstones utiles levées par DELETE (0 échec), l'app PC — coffre complet, jamais touché — re-pousse tout, LORDI restaure au pull. Les copies corbeille de LORDI : à purger en une passe. Le téléphone : quadruplets (L'ENCHANTERESSE ×4, L'HOMME VOLANT ×3, .123ecriture (3)-(6), .trash (8)) — tri en une passe avec Catelina.

**Statut** : cascade arrêtée, cloud réparé, PC 0.4.91 installé, téléphone 0.4.91 installé (Success), LORDI à mettre à jour à sa prochaine ouverture (gate forcé). Fixes structurels : commit 2bfa493 (six fragilités hautes de l'audit, dont le garde anti-masse FERMÉ par disjoncteur et la sonde disque avant toute tombstone) — livrés en v0.4.91.
