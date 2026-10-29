# Android : coffres 100 % cloud (0.4.96-test.2)

- Source de vérité : Supabase (`vault_files`, bucket `123ecriture-vaults`, RPC `push_file` / `tombstone_file` / `restore_file` à verrou optimiste). Objets Storage adressés par contenu : `<vaultId>/c/<sha256>`.
- Cache hors-ligne privé : `documentDirectory/cloud-vaults/`. Le cache ne crée JAMAIS de suppression distante ; les écritures hors-ligne sont mises en file et rejouées.
- Suppression = corbeille récupérable (tombstone). Suppression définitive : desktop uniquement.
- Conflit de version : la version distante est conservée, la version locale est poussée en copie « nom (conflit <appareil> <date>).md » et le conflit est listé (la feuille #199 n'est pas encore intégrée).
- Coffres déjà liés : basculent seuls en cloud. Coffres non liés : « 📦 à importer » → bouton « Importer dans le cloud… » : lecture SEULE de l'ancien dossier SAF (permission redemandée si besoin), aucune écriture ni suppression dedans.
- Limites : 50 Mo par fichier à l'import ; hors-ligne, seuls les fichiers déjà en cache s'ouvrent ; dossiers vides non importés ; fichiers cachés/.trash ignorés.
- Desktop : inchangé.
