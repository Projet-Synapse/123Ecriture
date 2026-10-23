# Synchronisation local-first (feat/local-first-vault)

- Les fichiers vivent sur l'appareil ; le cloud est une copie. L'interface n'attend jamais le réseau (attente max 3 s d'un cycle avant supprimer/renommer).
- Moteur à trois états `lib/sync/threeWay.ts` : L (disque) / R (cloud) / B (base par appareil, `.123ecriture/sync-state.json`). Une absence n'est une suppression que si le chemin est dans B. Suppressions distantes uniquement via la RPC `tombstone_file` ; envois via `push_file` (verrou optimiste).
- Garde-fou : > 20 suppressions, ou ≥ 5 et > 30 % des fichiers, ou dossier local vide alors que la base ne l'est pas → toutes les suppressions sont suspendues (rien n'est effacé) et mises en revue.
- Conflits : fusion 3 voies si possible, sinon la version perdante est sauvegardée. Tombstone distante sur un fichier modifié ici ou jamais synchronisé ici → conservé, en revue (pas de résurrection silencieuse).
- Dossiers : marqueur `<dossier>/.123ecriture-dossier` (vide). Aucune migration SQL.
- Paramètres (`lib/sync/syncSettings.ts`, Paramètres → Synchronisation) : global, par coffre, par type, dossiers vides, Wi-Fi uniquement ; respectés par le moteur.
- Liaison d'un dossier existant à un coffre distant : dialogue (fusionner / local prioritaire / distant prioritaire / annuler).
