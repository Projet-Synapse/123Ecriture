# Synchronisation local-first (feat/local-first-vault)

- Les fichiers vivent sur l'appareil ; le cloud est une copie. L'interface n'attend jamais le réseau (attente max 3 s d'un cycle avant supprimer/renommer).
- Moteur à trois états `lib/sync/threeWay.ts` : L (disque) / R (cloud) / B (base par appareil, `.123ecriture/sync-state.json`). Une absence n'est une suppression que si le chemin est dans B. Suppressions distantes uniquement via la RPC `tombstone_file` ; envois via `push_file` (verrou optimiste).
- Garde-fou : > 20 suppressions, ou ≥ 5 et > 30 % des fichiers, ou dossier local vide alors que la base ne l'est pas → toutes les suppressions sont suspendues (rien n'est effacé) et mises en revue.
- Conflits : fusion 3 voies si possible, sinon la version perdante est sauvegardée. Tombstone distante sur un fichier modifié ici ou jamais synchronisé ici → conservé, en revue (pas de résurrection silencieuse).
- Dossiers : marqueur `<dossier>/.123ecriture-dossier` (vide). Aucune migration SQL.
- Paramètres (`lib/sync/syncSettings.ts`, Paramètres → Synchronisation) : global, par coffre, par type, dossiers vides, Wi-Fi uniquement ; respectés par le moteur.
- Liaison d'un dossier existant à un coffre distant : dialogue (fusionner / local prioritaire / distant prioritaire / annuler).
- Dossiers : tous les répertoires du disque (scan, vides compris) sont des entrées 3-états ; renommer = nouveau marqueur + tombstone de l'ancien ; supprimer = tombstone du marqueur.
- Après MISE À JOUR (version installée ≠ dernière vue, `syncSettings.checkAppUpdate`) : session conservée, synchro en PAUSE (`pausedAfterUpdate`), aucun envoi (moteur desktop et file Android). Reprise : reconnexion d'un coffre distant (dialogue de fusion) ou bouton « Reprendre la synchronisation » (Paramètres → Synchronisation).
- Seed NON appliqué : `supabase/seeds_lordi_dossiers_vides.sql` (dossiers vides WORLDBUILDING de LORDI).

## Mise à jour test.3 — Android revient au coffre LOCAL, disjoncteur supprimé

- **Android = coffre local** (comme le PC) via le module natif `vault-fs` (#197) :
  dossier choisi par l'utilisateur avec permission d'arbre SAF **persistante**.
  Le cloud n'est qu'une copie synchronisée par le moteur trois états.
  `lib/storage/vaultBackend.ts` ne crée plus le coffre cloud-only de #201
  (`isAndroidCloudOnly()` renvoie `false`). Le correctif updater/versionCode de #201 est conservé.
- **Permission perdue** : l'index du coffre est mis en cache
  (`documentDirectory/vaultfs-index-*.json`) ; l'UI reste lisible, une alerte
  demande de re-sélectionner le dossier, et chaque cycle de synchro est refusé
  (`VaultPermissionLostError`) — **jamais** interprété comme « coffre vide », donc aucune suppression.
- **Après mise à jour** : même règle sur Android (pause jusqu'à reconnexion explicite + fusion).
- **Disjoncteur supprimé** : plus de `syncBlocked`, de seuil d'erreurs ni de bouton
  « Lever le disjoncteur ». Les commandes à distance `lock-sync` / `unlock-sync` /
  `clear-sync-block` pilotent maintenant l'interrupteur « Synchronisation activée ».
  Le garde-fou trois états (suppressions massives / dossier local vide) **reste**.
