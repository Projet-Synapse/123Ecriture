# 📋 SPÉCIFICATION OFFICIELLE — Le cycle de synchronisation de 123Ecriture

> **Cahier des charges dicté par Catelina le 18/10** — ceci est LE contrat entre
> l'utilisatrice et le moteur de synchronisation. Toute évolution du moteur
> (syncEngine.ts, les ponts, les UI) est jugée contre CE document. Les écarts
> sont listés en fin de chaque section avec leur statut d'implémentation.
>
> Principe général (paroles de Catelina) : « le vault doit savoir quel bon
> cycle réellement adopter » — chaque action a un nom, une annonce, et un
> effet défini. Rien ne se fait sans annonce, rien ne se perd en silence.

---

## Étape 1 — Connexion / Déconnexion au serveur

| # | Exigence | Conformité |
|---|----------|------------|
| 1.1 | **À l'ouverture de l'app** : le journal annonce localement « Connexion au serveur… » | ✅ `makeJournalEntry('connexion')` à chaque cycle (syncEngine) |
| 1.2 | **Une indexation se déclenche** : l'app détecte les changements du vault (modifications, etc.) | ✅ `hashVaultTree` (les deux ponts) — parcours direct du disque à chaque cycle |
| 1.3 | **À la fermeture de l'app** : le journal annonce « Déconnecté du serveur » | ❌ **ABSENT** — aucune entrée à la fermeture (chantier) |
| 1.4 | **Les données sont sauvegardées à la fermeture** (même en cas de crash) | ~ Partiel : l'état est sauvé à chaque cycle ; pas de flush forcé à la fermeture (chantier) |

## Cas 1 — Modifications (⚠ jamais un conflit)

| # | Exigence | Conformité |
|---|----------|------------|
| M.1 | **Si je modifie un fichier, la synchronisation attend que j'en sorte** | ✅ silence 60 s (`editQuiet.ts`, v0.4.79) — le cycle diffère tant que le fichier est « chaud » |
| M.2 | **Ensuite, le journal annonce « modification »** avec les stats | ✅ entrée `modification` : « +X / −Y caractères (Z au total) » (changeStats, v0.4.77) |
| M.3 | **Les autres appareils annoncent « ✅ Synchronisé — N changements »** | ~ Partiel : ils annoncent « reçu : chemin » — le compteur global existe, le détail par fichier n'est pas relayé sur les autres (chantier) |
| M.4 | **⚠ Les modifications ne doivent JAMAIS être perçues comme des conflits** | 🔴 **ÉCART ACTIF (vécu 18/10)** : la danse multi-appareils à états périmés crée des conflits/fusions à chaque modification. Correctifs en place : sync-state timbré (0.4.76), revérification directe avant tombstone + keep-copy→revue (0.4.77), dédoublonnage du cloud (18/10). La règle additionnelle à IMPLÉMENTER : un fichier « chaud » (édité récemment) ne peut JAMAIS perdre un conflit — sa version locale gagne toujours la fusion (chantier 0.4.80+) |

## Cas 2 — Suppressions (jamais silencieuses)

| # | Exigence | Conformité |
|---|----------|------------|
| S.1 | **Le bouton de synchro annonce « déplacement dans la corbeille »** | ❌ Le bouton affiche toujours « Synchronisation » (chantier : bouton contextuel) |
| S.2 | **La corbeille a le même contenu sur tous les appareils** (fichier caché du vault, distant) | ✅ `.trash/` est DANS le coffre, synchronisée (v0.4.26) — parité desktop ✓, mobile ✓ (refonte 0.4.80 : corbeille dans le coffre + listTrash) |
| S.3 | **Le déplacement en corbeille est journalisé ET synchronisé** | ✅ entrées `delete` journalisées + tombstones synchronisées |
| S.4 | **JAMAIS de suppression automatique silencieuse** — tout passe par la revue | ✅ v0.4.72-77 : revue de sécurité (disjoncteur, masses, keep-copy), revérification directe avant tombstone |

## Cas 3 — Créations

| # | Exigence | Conformité |
|---|----------|------------|
| C.1 | **Un fichier ou dossier créé est annoncé dans le journal et pris en compte dans la synchro** | ✅ push standard + entrée `modification` (« nouveau fichier · N caractères ») |

## Tâches (même contrat que les fichiers)

| # | Exigence | Conformité |
|---|----------|------------|
| T.1 | **Les tâches suivent les mêmes règles et font partie des vaults distants** | ✅ `tasks.json`/`tasklists.json` par coffre, dans SYNCED_META_FILES (synchronisées), parité desktop/mobile |

## Thème (unique par vault, annoncé)

| # | Exigence | Conformité |
|---|----------|------------|
| TH.1 | **Le thème est unique par vault** | ✅ `appearance.json` par coffre, dans SYNCED_META_FILES (synchronisé) |
| TH.2 | **Les changements de thème sont annoncés dans la synchronisation** | ~ Partiel : les métadonnées sync sont comptées dans le cycle mais pas nommées dans le journal (chantier : entrées journal pour les métadonnées) |

---

## Les écarts consolidés (le backlog du cycle)

| # | Écart | Priorité | Fichiers |
|---|-------|----------|----------|
| E1 | « Déconnecté du serveur » + flush à la fermeture de l'app | Haute | index.ts/App.tsx + syncEngine (hook beforeunload/app quit) |
| E2 | Bouton contextuel : « Upload / Téléchargement / Modification / Suppression / Déplacement en corbeille » selon le cycle en cours | Haute (demande Catelina) | SyncStatusContext + le bouton de l'UI |
| E3 | Un fichier « chaud » (édité) ne perd JAMAIS un conflit — sa version gagne la fusion | Haute (le vécu 18/10) | merge.ts (le poids local dans tryThreeWayMerge) |
| E4 | Le détail des modifications relayé sur les autres appareils (« N changements ») | Moyenne | syncEngine (les entrées modification dans les pull-confirmations distantes) |
| E5 | Les entrées journal NOMMÉES pour les métadonnées (thème, tâches, préférences) | Moyenne | syncEngine (le bloc meta-sync) |
| E6 | Le détail des modifications visible sur le bouton (le compteur « N changements ») | Moyenne | Le même chantier que E2 |

---

*Spec dictée par Catelina le 18/10 — modifiée par accord mutuel lors de la session de lecture du moteur. Toute nouvelle règle s'ajoute ICI d'abord, le code ensuite.*
