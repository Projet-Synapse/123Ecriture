# Handoff — Android 123Ecriture (sessions 2026-10-01/02 : crash + auth Google + sync RÉSOLUS ✅)

## État VÉRIFIÉ SUR TÉLÉPHONE (Samsung A13, SM-A136B, Android 13)

- **APK final** : `C:\Users\catel\Desktop\123Ecriture-0.4.41-fix3-android.apk` (build 01:45)
- **Crash « undefined is not a function » : CORRIGÉ** (zéro TypeError, app vivante).
  Trois vagues de causes, TOUTES la même famille (API web appelée sur Hermes natif) :
  1. `window.addEventListener` (AppShell.tsx:104 + NotesScreen keydown/beforeunload) —
     `window` EXISTE en natif mais ces méthodes non ; le garde
     `typeof window === 'undefined'` ne protège PAS.
  2. `container.addEventListener('dragstart'…)` (NotesScreen.tsx, effet
     glisser-déposer de l'arborescence) + effet `draggable` (querySelectorAll) +
     `querySelector/scrollIntoView` (scroll vers note active) — des REFS RN ne sont
     pas des HTMLElement ; ces effets ne se déclenchent qu'avec un coffre actif
     (d'où « revenu sans raison » après le choix du coffre).
  3. MdxEditor/CodeMirror au montage d'une note (DOM) — neutralisé.
- **Correctifs** (workspace + C:\b, NON COMMITÉS — 12 modifiés + 5 nouveaux) :
  - `lib/nativeShims.ts` (NOUVEAU) : no-op addEventListener/removeEventListener sur
    globalThis quand Platform.OS !== 'web' — filet couvrant toute la classe.
  - Gardes `Platform.OS !== 'web'` sur tous les effets DOM restants de NotesScreen
    (drag-drop, draggable, scroll-into-view ; le contextmenu était déjà gardé par
    l'absence de window.contextMenu en natif).
  - NotesScreen : `effectiveViewMode = 'reading'` en natif → les notes s'ouvrent en
    aperçu NATIF (NoteRenderer) ; sélecteur de modes masqué ; canvas/chart/
    excalidraw → placeholder `NativeFileTypeUnavailable` ; AudioEmbed → placeholder.
    L'ÉDITION sur Android = chantier futur (WebView ou éditeur natif).
- **Connexion Google : FONCTIONNE** (session catelyn2332@gmail.com active et
  persistante). Architecture :
  - `lib/storage/nativeAuthBridge.ts` (NOUVEAU) : window.auth via Linking
    (openExternal/onCallback/takePendingUrl) — même interface que le pont Electron.
  - AndroidManifest.xml : intent-filter `app123ecriture://` (VIEW+BROWSABLE) —
    testé OK par callback simulé (erreur PKCE attendue = routage bon).
  - `lib/sync/nativeAuthStorage.ts` (NOUVEAU) : session Supabase persistée dans un
    fichier du stockage privé (survit aux réinstallations) ; branché dans
    supabaseClient.ts (`auth.storage`, Platform-guardé) + detectSessionInUrl
    explicité web-only.
  - NB : supabase-js retombe sur code_challenge "plain" sans WebCrypto (warning
    logcat, inoffensif — Supabase l'accepte).
- **Coffres distants/synchro : câblés côté app, BLOQUÉS par le réseau du téléphone.**
  - `lib/storage/nativeSyncAdapter.ts` (NOUVEAU) : window.sync.hashVaultTree sur
    SAF (mêmes règles que desktop : .trash inclus, cachés exclus, extensions
    .mdx/.md/.canvas/.chart/.excalidraw/.base).
  - `lib/sync/nativeSha256.ts` (NOUVEAU) : SHA-256 JS pur + UTF-8 manuel (Hermes
    n'a ni crypto.subtle ni TextEncoder) — validé bit-à-bit contre Node crypto.
  - syncEngine.ts : crypto.randomUUID → helper portable webUuid.
  - installNativeBridges.ts : pose vault/vaults/SYNC/AUTH.
  - **`lib/sync/storageKeys.ts` réécrit en JS PUR (crash synchro v0.4.41-fix3)** :
    l'ancien code utilisait TextEncoder/btoa/atob/TextDecoder (absents d'Hermes)
    pour encoder les clés Storage Supabase — appelé à chaque push/pull, dès que
    la synchro dépassait le premier appel réseau. Nouveau : base64 + UTF-8
    manuels (utf8Bytes de nativeSha256, base64/utf8Decode locaux) — clés
    IDENTIQUES à la référence Node/base64url (compatibilité cloud garantie),
    validé par batterie Node (accents, émojis/surrogates, toutes tailles) +
    248 tests unitaires OK.
  - ⚠️ Reste bloqué par le TÉLÉPHONE : Wi-Fi connecté à la box mais PAS
    d'Internet (DNS mort : UnknownHostException vers *.supabase.co). Le PC a
    Internet sur la même box → blocage propre au téléphone (contrôle parental
    horaire ? filtrage box ? VPN ?). Quand Internet revient, la synchro doit
    fonctionner telle quelle (le coffre WORLDBUILDING a été relié au cloud).
    NB : l'échec réseau s'affiche proprement dans la carte « Coffres distants »
    (pas de crash) — vérifié.
- `[vaults-web] indexedDB` au démarrage : bruit inoffensif (webVaultRegistry
  construit à l'import d'installWebBridges) — à rendre paresseux un jour.

## Environnement de build

- `export JAVA_HOME="C:\Users\catel\android-build\jdk-17.0.20.1+1"` puis
  `cd C:\b\123Ecriture\apps\mobile\android && gradlew assembleRelease`.
- `local.properties` créé (sdk.dir, git-ignoré). Ne PAS écraser l'app.json du
  clone C:\b (contient `newArchEnabled: false` local).
- Synchroniser workspace → C:\b par copie des fichiers sources.
- ADB : `C:\Users\catel\android-build\android-sdk\platform-tools\adb.exe`.
  **L'USB du téléphone décroche en cours d'install** (câble/mode suspect) et le
  Wi-Fi ADB se coupe hors écran — l'install fiable : boucle qui retente sur
  toute connexion vivante (USB `RFCW1120J1V` OU mDNS `192.168.1.26:<port>` via
  `adb connect`). Résoudre l'offset minifié : `node C:\Users\catel\android-build\resolve2.mjs <offset>`
  (sourcemap : `C:\b\...\build\generated\sourcemaps\react\release\index.android.bundle.map`).
- ⚠️ Ne JAMAIS croire un fix « corrigé depuis » sans l'avoir vu dans `git diff` :
  la fausse piste de la session 2026-10-01 (fix AppShell jamais appliqué) a fait
  tourner en rond une session entière.

## Session 2026-10-03 (soir) — 3 correctifs VÉRIFIÉS SUR TÉLÉPHONE (A13, install 22:51)

1. **Mode Intermédiaire — marqueurs `*`/`_` restés visibles : CORRIGÉ + VÉRIFIÉ**
   (`##### **2•** 🧮 **_Système du mode_**` et `**3•** 🦾 **_Procédure_**`
   s'affichent désormais sans aucun marqueur). Trois causes distinctes :
   - `lib/mdxLivePreview.ts` : la segmentation des titres comparait une
     position RELATIVE (`segment.from`, 0-based dans le contenu) à une
     ABSOLUE (`cursor = contentFrom ≥ 2`) → le PREMIER segment gras/italique
     de chaque titre était toujours sauté. Remplacée par `addMarkedRange`,
     découpage RÉCURSIF (titre → gras → italique) qui masque aussi les
     marqueurs IMBRIQUÉS (`**_texte_**`) — auparavant l'italique dans le
     gras était abandonné par le dédoublonnage de findLiveMatches (`_`
     visibles).
   - `lib/liveDecorations.ts` : l'italique-étoile `*…*` n'existait pas
     (cut v1) — ajouté (`/\*(?!\s)([^*\n]*\S)\*/g`, lookahead seulement :
     Hermes parse ce fichier et ne supporte pas le lookbehind ; bords non
     espace pour ne pas manger `2 * 3 * 4`).
   - ⚠️ Pour TOUTE modif de ces libs : regénérer le bundle WebView
     (`pnpm --filter @123ecriture/mobile build:editor-web` — esbuild est
     maintenant devDependency du mobile) ET resynchroniser C:\b AVANT le
     build, sinon le téléphone tourne sur l'ancien code (piège de la
     session 2026-10-01).
   Cas FAIBLESSE restante (assumé, = texte fidèle) : les lignes au
   balisage mal apparié du coffre (`**_Présentation **_du mode_**_**`,
   `**### Chap 1 •**`) gardent quelques marqueurs visibles — il faudrait
   un vrai parseur pour faire mieux ; Obsidian affiche des artefacts
   similaires.
2. **Vue graphique « ne charge pas » : CORRIGÉ + VÉRIFIÉ** (211 fichiers ·
   **160 liens**, chargement ~20 s contre >90 s). Deux causes :
   - `nativeVaultAdapter.ts` livrait `name` AVEC extension (« Note.md »)
     là où le desktop la retire → les `[[liens]]` (sans extension) ne
     matchaient plus : graphe à 0 liens, wikilinks non résolus (écran :
     titres avec « .md », ouverture de lien = recréation d'une note).
     Convention desktop rétablie (`baseNameOf`) sur l'arbre + retours de
     createNote/rename/move/ensureDailyNote ; rename préserve maintenant
     l'extension réelle (le champ de renommage n'en contient plus) ;
     setPath compare des noms sans extension.
   - `GraphView.tsx` lisait 208 notes en SÉQUENTIEL via SAF (~0,4 s/ch)
     avant d'afficher quoi que ce soit → pool de 12 lectures parallèles ;
     le garde `window.vault` est passé dans le try (avant, il court-
     circuitait le finally : « Construction du graphe… » infinie possible).
     `buildGraph` indexe les noms avec ET sans extension (liens
     `[[Note.md]]` compris).
3. **Barre latérale (en-tête explorateur) cassée : CORRIGÉ + VÉRIFIÉ** —
   sur ~162 dp de panneau (téléphone), le bouton flex « + Nouvelle note »
   et les 3 icônes fixes (34 dp) ne tenaient pas sur une ligne : libellé
   empilé une lettre par ligne. Sous 280 dp, l'en-tête passe sur deux
   rangées (bouton pleine largeur, puis icônes en flex) —
   `NotesScreen.tsx`, `explorerHeaderStacked` ; desktop inchangé.
4. Au passage : erreurs ESLint bloquantes de la session précédente
   corrigées (MdxEditorWeb refs pendant le rendu, apostrophes JSX,
   deps de hooks Preferences/SyncStatus, webview exclu du lint) ;
   `pnpm lint`/`typecheck`/`test` verts (251 tests) — turbo lui-même
   ne démarre pas depuis cette session (EPERM spawn, lancer eslint/tsc/
   vitest par package).

## Session 2026-10-03 (nuit) — 4 demandes VÉRIFIÉES SUR TÉLÉPHONE (install 00:0x)

1. **Soulignement des titres retiré (desktop + mobile)** — `defaultHighlightStyle`
   de @codemirror/language (fallback de basicSetup) souligne `tags.heading`.
   Nouveau `lib/codemirrorHighlight.ts` : re-déclare le style par défaut en
   non-fallback + un override heading (`text-decoration:none`) monté
   APRÈS — à spécificité égale la dernière feuille gagne. Posé dans
   MdxEditor.tsx ET webview/editor-entry.tsx (bundle regénéré).
   ⚠️ Ne pas poser UN autre style non-fallback sans re-déclarer le style
   par défaut : le fallback s'effacerait et tous les tags perdraient leur
   couleur. Le soulignement reviendra plus tard comme vraie mise en forme
   (demande explicite), pas comme effet automatique.
2. **Préférences persistées sur Android** (`nativePreferencesAdapter.ts`,
   câblé dans installNativeBridges → `window.preferences`) — avant, AUCUN
   pont sur mobile : thème/accent/polices/largeurs de panneaux se
   réinitialisaient à chaque relance. JSON dans documentDirectory
   (123ecriture-preferences.json), même interface que le web
   (get/set/reset/getConfigPath/revealConfigFolder), fusion toolbar
   (mergeToolbarOrder copié de webAppAdapter), resolve APRÈS écriture.
   VÉRIFIÉ : thème « Clair » survit à un force-stop alors que le téléphone
   est en système sombre ; largeur d'explorateur aussi.
3. **Barre de défilement de l'éditeur maintenable au doigt** —
   `NativeScrollbar` (NotesScreen.tsx) accepte un `scrollTo` : bande de
   24 dp à droite, saisie = saut à la position du doigt puis suivi ; pouce
   élargi pendant la prise. Sans scrollTo (TextInput du mode Source, pas
   de scroll programmatique) : indicateur passif inchangé.
   `NativeReadingScroll` passe le sien → lecture ET Intermédiaire natif
   (le ScrollView brut de l'éditeur web a été remplacé par cette coquille)
   ont la barre interactive. VÉRIFIÉ : glisser + tap sur la piste (saut
   proportionnel).
4. **Largeurs des barres latérales au doigt** :
   - `useResizablePanel` : callbacks `onHandleTouchStart/Move/End`
     (pageX) ; le drag part de la largeur EFFECTIVE affichée (partir de
     `stored.width` mangeait le parcours dans le plafond 45 % → aucun
     changement visible, vécu). `document.addEventListener` GUARDÉ
     Platform web — sinon crash « Property 'document' doesn't exist » au
     premier drag natif (même famille v0.4.41).
   - `ResizeHandle` : zone de prise RÉELLE 24 dp en natif (barre visible
     collée au bord servi) — un hitSlop ne suffit PAS : sur sa zone
     ajoutée par-dessus le panneau voisin, les vues plus profondes captent
     le toucher avant la poignée (un swipe sur deux échouait, vécu).
     Chevron toujours prioritaire.
   - NotesScreen : plafond explorateur 45 % → 60 % (le 45 % interdisait
     tout élargissement au doigt) ; RightSidebar/côté droit a les mêmes
     callbacks. VÉRIFIÉ : élargi + rétréci au doigt, largeur conservée
     après relance.
   - GraphView : poignée du panneau ⚙ en glissement ABSOLU (l'ancien
     ±8 px par évènement était imprévisible), zone 24 dp réelle, plafond
     moitié d'écran. VÉRIFIÉ (panneau élargi au doigt).
   La largeur du panneau graphique reste un état de session (non
   persistée) — à persistant si demandé un jour.
5. Au passage : `@lezer/highlight` et `esbuild` ajoutés aux devDeps/
   deps du mobile (imports directs désormais) ; Tests 251 OK,
   lint 0 erreur, typecheck OK.

## Session 2026-10-04 (nuit, 2e vague) — retour utilisatrice

1. **Apparence « réinitialisée » à chaque relance : RACINE TROUVÉE** —
   Android SAF ne sait pas ÉCRASER : `createFileAsync` sur un nom existant
   crée un DOUBLON numéroté (« appearance (1..3).json » vécus dans le
   coffre). L'écriture passait par la branche « fichier absent de
   l'index » (index persisté antérieur au fichier) → les réglages
   atterrissaient dans le doublon, la relecture au démarrage prenait
   l'ANCIEN appearance.json. CORRIGÉ dans writeNote : lister le parent
   (readDirectoryAsync) et réutiliser l'URI existante avant de créer.
   ⚠️ MÊME RISQUE pour le pull de synchro (fichier présent sur disque,
   absent de l'index) — le fix couvre les deux.
2. **Bouton « 💾 Sauvegarder l'apparence »** en tête de la carte
   Personnalisation (demande explicite) + `saveVaultAppearance()` awaitée
   dans PreferencesContext (flush le regroupement 800 ms, resolve après
   disque, succès « ✓ Apparence enregistrée » / échec affiché). L'écriture
   automatique journalise maintenant ses échecs (avant : catch silencieux).
   Le fichier de l'utilisatrice a été restauré depuis « appearance (3).json »
   (son vrai dernier état) et les doublons supprimés à la main.
3. **Mode Source natif = WebView** — l'ancien TextInput ne peut pas être
   fait défiler par programme (barre décorative : « le glisser ne répond
   pas », vécu). Le mode Source passe par le même éditeur web que
   l'Intermédiaire avec `livePreview: false` (MdxEditorWeb + config
   editor-entry). NativeSourceEditor supprimé. TOUS les modes ont la
   barre maintenable.
4. **Barre de défilement stabilisée** — pendant la prise, le pouce suit le
   doigt via un état local (dragThumbTop) au lieu du scrollOffset asynchrone
   qui arrivait en retard (« assez instable », vécu).
5. **Poignée du panneau graphique** : Pressable → View + responders (le
   pattern ResizeHandle) ; glissement ABSOLU ; borne basse jamais >
   plafond ; plafond calculé sur onLayout du conteneur et NON sur
   useWindowDimensions — sur le A13 (zoom d'affichage Samsung), l'échelle
   des métriques et celle du layout divergent, le panneau restait figé au
   plafond quel que soit le glisser. ScrollView panneau : flexGrow/Shrink 0
   (sinon la largeur du CONTENU l'emportait sur la largeur fixe).
6. Rappels : densité réelle A13 = 1,875 (300 dpi, 384 dp de large) ;
   l'utilisatrice peut utiliser l'app pendant mes tests adb — coordonner
   avant d'installer ; les captures de l'écran sont en px physiques (÷1,875
   pour des dp).



## Reste à faire (Android)

1. **Internet sur le téléphone** → débloque la synchro (déjà liée au cloud).
2. Édition des notes sur mobile (WebView/éditeur natif) — lecture seule OK.
3. Commits ! 12 fichiers modifiés + 5 nouveaux, plus le manifest — ET les
   correctifs de la session du soir (voir ci-dessus). Version NON bumpée,
   rien n'est commité ni taggué (la CI publie la release au tag : décision
   à prendre en connaissance de cause).
4. CI Android : `.github/workflows/build-android-apk.yml` ligne 58 :
   `android-actions/setup-android@v3` → `@v4` (token sans scope workflow).
5. Bruit [vaults-web] : rendre webVaultRegistry paresseux (cosmétique).
6. Graphe : à très forte densité (211 nœuds), les étiquettes se
   superposent au zoom par défaut — réglable au curseur « Seuil
   d'affichage du texte » du panneau ⚙ ; un défaut adapté au mobile
   resterait à trouver (réglage partagé avec le desktop).

## État général du projet (hors Android)

- **Sync multi-PC** : coffres = `Documents\Obsidian\` (source de vérité) ;
  en attente : confirmation agent LORDI (app fermée sur
  `app_123ecriture.agent_coordination`) → re-nettoyage des 5 coffres distants
  depuis Obsidian → étape (d) sur LORDI → test croisé.
- Branche `diag/crash-fichiers` à fusionner dans main.
