// ARCHITECTURE.md
//////////////////////////////////////////////////////////////////////////
//                     🏗️ ARCHITECTURE — 123Ecriture                     //
//////////////////////////////////////////////////////////////////////////

// SOMMAIRE
// 1. 🎯 Vue d'ensemble
// 2. 🧱 Stack technique
// 3. 🗂️ Structure du monorepo
// 4. 📄 Modèle de données & format des fichiers
// 5. 💾 Stockage local & abstraction multiplateforme
// 6. ☁️ Synchronisation par compte (Supabase)
// 7. 🎨 Personnalisation de l'interface
// 8. 🧩 Architecture en modules (outils de productivité)
// 9. ✅ Qualité, tests, CI
// 10. 🗺️ Feuille de route (phases)
// 11. ❓ Décisions ouvertes

Statut : premier brouillon (v0.1) — à valider et faire évoluer au fil du projet.
Ce document décrit les fondations techniques de 123Ecriture, la première brique
du 🧠 Projet Synapse. Il précède tout code : chaque phase de la feuille de
route (§10) doit s'appuyer dessus, et toute déviation doit être actée ici
(section 11) avant d'être codée.

//////////////////////////////////////////////////////////////////////////
// 1. 🎯 VUE D'ENSEMBLE
//////////////////////////////////////////////////////////////////////////

123Ecriture est une application d'écriture et de productivité "local-first" :
les notes vivent d'abord sous forme de fichiers MDX sur l'appareil de
l'utilisateur·rice, et un compte optionnel permet de les synchroniser entre
plateformes. L'application doit tourner sur PC, Mac, Linux, Android, iOS et
web, avec une interface entièrement personnalisable (couleurs, disposition
des panneaux, raccourcis...).

Principes directeurs :
- **Local-first** : le fichier MDX sur disque est la source de vérité. Le
  cloud (Supabase) est un mécanisme de sauvegarde/synchronisation, jamais un
  passage obligé pour lire ou écrire une note.
- **Un seul cœur logique, plusieurs coquilles** : la logique métier (modèle
  de vault, parsing MDX, moteur de sync, moteur de thèmes...) est écrite une
  fois, indépendante de la plateforme, et consommée par des "shells"
  spécifiques (mobile, desktop, web).
- **Extensible dès le départ** : todo lists, calendrier, graphes, canvas,
  Excalidraw, automatisations sont des *modules*, pas des fonctionnalités
  codées en dur dans le cœur de l'app (§8).

//////////////////////////////////////////////////////////////////////////
// 2. 🧱 STACK TECHNIQUE
//////////////////////////////////////////////////////////////////////////

| Besoin                          | Choix                                   |
|----------------------------------|------------------------------------------|
| Langage                          | TypeScript partout                       |
| UI mobile + web                  | Expo (React Native + React Native Web)   |
| UI desktop                       | Electron, qui embarque le build web Expo |
| Backend / auth / sync            | Supabase (Auth, Postgres, Storage, Edge Functions) |
| Format des notes                 | MDX (Markdown + composants JSX)          |
| Monorepo                         | pnpm workspaces + Turborepo              |
| Lint / format                    | ESLint (déjà amorcé) + Prettier          |
| Tests                            | Vitest (logique pure) + Playwright (bout en bout, au moins sur web/desktop) |

Pourquoi ce choix (déjà amorcé dans [eslint.config.js](../eslint.config.js)) :
- **Expo** couvre iOS/Android/web avec une seule base de code React, et son
  écosystème de modules natifs (fichiers, notifications...) évite de
  réinventer les intégrations plateforme.
- **Electron** reste le choix le plus fiable aujourd'hui pour un vrai accès
  au système de fichiers natif sur PC/Mac/Linux (nécessaire pour un vault
  façon Obsidian) — Expo seul ne le permet pas sur desktop.
- **Supabase** donne auth + base de données + stockage de fichiers "managés"
  sans avoir à opérer un backend soi-même, tout en restant du Postgres
  standard si on veut un jour migrer.

//////////////////////////////////////////////////////////////////////////
// 3. 🗂️ STRUCTURE DU MONOREPO
//////////////////////////////////////////////////////////////////////////

```
123Ecriture/
├── apps/
│   ├── mobile/         # Expo app — cible iOS/Android (+ build web réutilisable)
│   └── desktop/         # Electron — main process (fs natif, menu, fenêtres)
│                         # + charge le build web d'Expo comme renderer
├── packages/
│   ├── core/            # Modèle de vault/note, parsing MDX+frontmatter,
│   │                     # recherche, logique pure sans dépendance UI
│   ├── ui/               # Composants partagés (RN + RN Web), design tokens
│   ├── editor/            # Éditeur MDX (composant central de l'app)
│   ├── storage/            # Interface VaultAdapter + implémentations
│   │                        # (fs Node, Expo FileSystem, File System Access API)
│   ├── sync/                 # Client Supabase, moteur de synchro, résolution
│   │                          # de conflits
│   └── config/                 # tsconfig, eslint, prettier partagés
├── supabase/
│   ├── migrations/               # schéma Postgres versionné
│   └── functions/                  # Edge Functions (Deno)
└── docs/
    ├── ARCHITECTURE.md               # ce document
    └── adr/                             # Architecture Decision Records
```

Chaque `app` est une coquille fine : elle assemble les `packages` et gère le
cycle de vie propre à sa plateforme (permissions, fenêtres, notifications
natives). Toute la logique testable vit dans `packages/`.

//////////////////////////////////////////////////////////////////////////
// 4. 📄 MODÈLE DE DONNÉES & FORMAT DES FICHIERS
//////////////////////////////////////////////////////////////////////////

- Une **note** = un fichier `.mdx` + un bloc **frontmatter YAML** en tête
  pour les propriétés (titre, tags, dates, propriétés personnalisées —
  équivalent des "properties" Obsidian).
- **Le `.mdx` est la surface d'écriture elle-même**, pas qu'un format de
  sauvegarde en arrière-plan : ce que l'utilisateur·rice tape dans l'éditeur
  est directement le contenu du fichier. Ça écarte un éditeur par blocs
  propriétaire (façon Notion) qui sérialiserait vers MDX à l'export, et ça
  oriente vers un éditeur **MDX-natif** — édition du texte source avec rendu
  enrichi à la volée (façon "live preview" d'Obsidian). Impact direct sur le
  choix de lib d'éditeur en Phase 1 (§10).
- Un **vault** = un dossier racine local contenant les notes, éventuellement
  en sous-dossiers libres, plus un dossier caché `.123ecriture/` pour la
  config du vault (thème actif, disposition des panneaux, index de
  recherche, cache).
- Les **liens entre notes** (`[[note]]`) et le **graphe** (§8) sont dérivés
  du contenu, pas stockés séparément — recalculés/mis en cache à l'ouverture
  du vault.

//////////////////////////////////////////////////////////////////////////
// 5. 💾 STOCKAGE LOCAL & ABSTRACTION MULTIPLATEFORME
//////////////////////////////////////////////////////////////////////////

`packages/storage` expose une interface unique, par ex. :

```ts
interface VaultAdapter {
  list(path: string): Promise<VaultEntry[]>;
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
  watch(path: string, onChange: (event) => void): Unsubscribe;
  // ...
}
```

Implémentations prévues :
- **Electron (desktop)** : `fs`/`fs.watch` Node natif — accès disque complet.
- **Expo (mobile)** : `expo-file-system` + `expo-document-picker` pour choisir
  le dossier vault (sandboxing iOS/Android oblige, contrairement au desktop).
- **Web (navigateur seul, hors coquille Expo/Electron)** : File System Access
  API si disponible, sinon repli sur OPFS/IndexedDB avec export/import manuel.

C'est cette abstraction qui permet au `core` et à l'`editor` d'ignorer
totalement la plateforme sur laquelle ils tournent.

> **Écart pragmatique (Phase 1, v0.1.3)** : l'implémentation Electron du
> VaultAdapter vit pour l'instant directement dans
> `apps/desktop/electron/vault.js` (exposé au renderer via IPC/preload), pas
> encore dans un `packages/storage` séparé — on a évité de créer un paquet
> partagé tant qu'il n'a qu'un seul consommateur réel (les adaptateurs
> Expo/web de la Phase 2 n'existent pas encore), pour ne pas complexifier
> prématurément la résolution de dépendances du monorepo pnpm (source de
> plusieurs galères déjà rencontrées côté packaging desktop). À extraire
> en `packages/storage` quand un deuxième consommateur apparaîtra.

//////////////////////////////////////////////////////////////////////////
// 6. ☁️ SYNCHRONISATION PAR COMPTE (SUPABASE)
//////////////////////////////////////////////////////////////////////////

- **Auth** : Supabase Auth (email/mot de passe + OAuth au besoin).
- **Stockage des fichiers** : Supabase Storage, un objet par note (ou par
  vault compressé en v0, à trancher — voir §11).
- **Métadonnées** : table Postgres (chemin, hash de contenu, date de
  modification, taille) pour détecter rapidement ce qui a changé sans
  retélécharger tout le vault.
- **Stratégie de conflit v0** : "dernier écrit gagne" avec horodatage +
  conservation d'une copie de sauvegarde du côté perdant (jamais de perte
  silencieuse de données — cf. CLAUDE.md, "sauvegarde et gestion des
  données" est une fonctionnalité critique). Une résolution plus fine
  (fusion, CRDT) est une évolution possible, pas un prérequis v0.
- La sync est **opt-in et best-effort** : l'app doit rester 100 %
  fonctionnelle hors ligne / sans compte.

//////////////////////////////////////////////////////////////////////////
// 7. 🎨 PERSONNALISATION DE L'INTERFACE
//////////////////////////////////////////////////////////////////////////

- **Design tokens** centralisés dans `packages/ui` (couleurs, espacements,
  typographies) exposés comme un objet de thème modifiable à l'exécution
  (pas de couleurs codées en dur dans les composants).
- **Thème utilisateur** stocké comme JSON dans `.123ecriture/theme.json` du
  vault (donc versionné/synchronisé comme le reste), avec un éditeur visuel
  à construire une fois le socle stable.
- **Disposition des panneaux/boutons** : modèle de layout déclaratif
  (grille de panneaux réorganisables), stocké de la même façon.
- Cette couche est volontairement conçue pour être réutilisée par les
  futures applications du Projet Synapse (même moteur de thèmes/layout).

//////////////////////////////////////////////////////////////////////////
// 8. 🧩 ARCHITECTURE EN MODULES (OUTILS DE PRODUCTIVITÉ)
//////////////////////////////////////////////////////////////////////////

Todo lists, calendrier, graphe de notes, canvas, Excalidraw, automatisations
sont chacun un **module** enregistré auprès d'un registre central plutôt que
codés en dur dans l'éditeur :

```ts
interface Module {
  id: string;
  registerPanel?(): PanelDefinition;      // ajoute un panneau dans l'UI
  registerCommand?(): CommandDefinition[]; // ajoute des actions/raccourcis
  onVaultEvent?(event): void;               // réagit aux changements de notes
}
```

Ce découplage permet d'ajouter/désactiver des outils sans toucher au cœur,
et prépare le terrain pour qu'un jour ces modules soient développés/partagés
indépendamment (esprit Projet Synapse). **Cette architecture est prévue dès
le départ mais implémentée progressivement** : l'éditeur MDX de base n'a pas
besoin du registre complet pour exister (voir feuille de route §10).

//////////////////////////////////////////////////////////////////////////
// 9. ✅ QUALITÉ, TESTS, CI
//////////////////////////////////////////////////////////////////////////

Conformément à CLAUDE.md :
- **ESLint bloquant** : aucune erreur de lint ne doit passer en CI ni en
  pré-commit.
- **Tests obligatoires sur les fonctionnalités critiques** :
  1. Stabilité des interfaces sur chaque plateforme (au minimum : l'app
     démarre et affiche le vault sans crash).
  2. Connexion au compte (auth Supabase).
  3. Sauvegarde et gestion des données (écriture/lecture de fichiers,
     sync, résolution de conflit) — zone à plus haute exigence de tests
     puisqu'une régression y est silencieuse par nature.
- `packages/core`, `packages/storage`, `packages/sync` visent une couverture
  de tests unitaires élevée (logique pure, facile à tester). Les `apps/`
  sont couvertes par des tests bout-en-bout plus légers.

//////////////////////////////////////////////////////////////////////////
// 10. 🗺️ FEUILLE DE ROUTE (PHASES)
//////////////////////////////////////////////////////////////////////////

**Phase 0 — Scaffold** : monorepo pnpm/Turborepo, `apps/mobile` (Expo) et
`apps/desktop` (Electron) qui démarrent tous les deux et affichent un écran
minimal. Corrige au passage l'erreur de syntaxe dans
[eslint.config.js](../eslint.config.js).

**Phase 1 — Vault local & éditeur MDX** : `packages/storage` (adaptateur
Electron d'abord, le plus simple), `packages/core` (modèle de note/vault),
`packages/editor` (ouvrir/éditer/sauvegarder un `.mdx` avec frontmatter).
Cible : ouvrir un dossier, éditer une note, la retrouver après redémarrage.

**Phase 2 — Multiplateforme réel** : adaptateurs storage Expo (mobile) et
web, parité de l'éditeur sur les trois cibles.

**Phase 3 — Compte & synchronisation** : intégration Supabase (auth,
sync des fichiers, résolution de conflit v0).

**Phase 4 — Personnalisation** : moteur de thèmes/layout (§7) + UI de
réglages.

**Phase 5 — Modules productivité** : registre de modules (§8), puis premiers
modules (todo list, calendrier...), un par un.

Chaque phase doit rester livrable et testée avant de passer à la suivante —
pas de big-bang.

//////////////////////////////////////////////////////////////////////////
// 11. ❓ DÉCISIONS OUVERTES
//////////////////////////////////////////////////////////////////////////

À trancher avant/pendant les phases concernées :
- Stockage Supabase : un objet Storage par note vs. vault packagé — impacte
  la granularité de la sync (Phase 3).
- Bibliothèque de parsing/rendu MDX précise (`@mdx-js/mdx` + `remark`/`rehype`
  plugins) — à choisir en Phase 1.
- Canvas/Excalidraw : lib dédiée vs. intégration d'`excalidraw` en composant
  — à trancher en Phase 5 selon maturité du support React Native Web.
- Chiffrement des notes synchronisées (au repos côté Supabase) — non prévu
  v0, à évaluer si des notes sensibles sont attendues.
