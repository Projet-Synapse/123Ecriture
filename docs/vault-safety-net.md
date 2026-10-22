# 🛟 Filet de sécurité du coffre (versions côté serveur)

Objectif : plus aucune modification ni suppression dans le cloud n'est définitive.

## Ce qui est archivé

| Quoi | Où | Par qui |
|------|----|---------|
| Ancienne **ligne** `vault_files` (hash, chemin, deleted, ligne complète en JSON) | table `app_123ecriture.vault_file_versions` | trigger `vault_files_archive_version` (BEFORE UPDATE OR DELETE) |
| Ancien **contenu** (objet Storage) | `123ecriture-vaults/<vault_id>/.versions/<clé>@<ancien hash>` | client, `archivePreviousObject` dans `pushFile`, juste avant l'upload |

- Sur UPDATE, le trigger n'archive que si `content_hash`, `storage_object_path` ou `deleted` changent (pas de bruit sur les heartbeats ou les updated_at seuls).
- Pose d'une pierre tombale (`deleted = true`) et DELETE en dur (restauration de corbeille) sont archivés.
- La table est **en lecture seule** pour les clients (RLS propriétaire, select uniquement). Seul le trigger `SECURITY DEFINER` (search_path fixé) y écrit.
- L'archivage Storage n'est **jamais bloquant** : en cas d'échec, une entrée `info` « version précédente non archivée » est ajoutée au journal et le push continue comme avant.
- `archive_storage_path` (SQL) et `vaultVersionObjectPath` (TS) calculent la même clé.

Limites : un fichier poussé par un appareil sur une version antérieure de l'app (sans `archivePreviousObject`) aura sa ligne archivée mais pas son contenu ; l'objet `archive_storage_path` n'existera alors pas.

## Retrouver et restaurer une version

1. Lister l'historique d'une note (SQL editor Supabase) :

```sql
select archived_at, op, content_hash, deleted, archive_storage_path
from app_123ecriture.vault_file_versions
where vault_id = '<VAULT_ID>' and rel_path = 'Dossier/Ma note.md'
order by archived_at desc
limit 20;
```

2. Fichiers supprimés ces 7 derniers jours :

```sql
select rel_path, archived_at, op
from app_123ecriture.vault_file_versions
where vault_id = '<VAULT_ID>'
  and (op = 'delete' or (old_row->>'deleted')::boolean = false)
  and archived_at > now() - interval '7 days'
order by archived_at desc;
```

3. Télécharger le contenu : Storage → bucket `123ecriture-vaults` → `archive_storage_path`. Le recopier dans le coffre local à son chemin d'origine ; la synchro le repoussera normalement (et la version écrasée sera archivée à son tour).

## Rétention (proposée, NON appliquée)

Purge des versions de plus de 90 jours, à planifier (pg_cron) seulement après validation :

```sql
-- PROPOSITION — ne pas exécuter sans accord
delete from app_123ecriture.vault_file_versions where archived_at < now() - interval '90 days';
-- + suppression des objets Storage correspondants (.versions/...) via un script/Edge Function.
```

## Déploiement

Migration : `supabase/migrations/20261023100000_vault_file_versions.sql` (idempotente). **Non appliquée en production** : à appliquer après validation.

## Verrou optimiste (PR feat/vault-optimistic-lock, dépend de #191)

Migration `supabase/migrations/20261023110000_vault_optimistic_lock.sql` (idempotente) :

- `vault_files.version bigint not null default 1` ; trigger `vault_files_server_stamp` :
  `updated_at = now()` posé par le serveur, version incrémentée à chaque changement réel
  (hash, objet, `deleted`, chemin) — **y compris pour les anciens clients** qui font encore un upsert direct.
- RPC (SECURITY INVOKER, `search_path` figé, RLS propriétaire + contrôle explicite du coffre),
  réponse `{ok, conflict, current_version, current_hash, deleted}` :
  - `push_file(vault, path, expected_version, hash, size, storage_path)` : `expected = null` → création
    (refus si la ligne existe, même en pierre tombale) ; sinon `UPDATE … WHERE version = expected AND NOT deleted`.
    Même hash déjà en place → `ok` (idempotent). **Ne ressuscite jamais une pierre tombale.**
  - `tombstone_file(vault, path, expected_version)` : conditionnelle ; absent / déjà supprimé → `ok`.
  - `restore_file(vault, path)` : seul chemin qui lève une pierre tombale (remplace le `DELETE` dur de
    `restoreFromTrash`) ; ligne vivante → conflit.
- `archive_vault_file_version()` (#191) enregistre aussi la version ; pour une clé déjà versionnée
  (`…@hash`) l'archive pointe sur l'objet lui-même (immuable).

Client (`apps/mobile/lib/sync`) :

- Storage : chaque contenu est téléversé sous une clé **unique** `<vault>/<clé>@<hash>`, puis la RPC bascule
  la ligne. L'objet courant n'est jamais écrasé ; un conflit laisse au pire un objet orphelin inoffensif.
- `sync-state.json` gagne `versions` (chemin → version serveur). Ancien état sans `versions` : lu tel quel
  (`versionLock.parseSyncState`), version inconnue → comportement prudent.
- `diffVault` : « le cloud n'a pas bougé » se juge par la version (sinon par le hash de référence). Divergence ou
  référence inconnue → `conflict-pull-wins` (fusion à trois voix d'abord, sinon cloud conservé et version locale
  archivée en copie de conflit). **Plus aucun arbitrage par mtime.**
- Conflit de version (`VersionConflictError`) : rien n'est écrasé, entrée « conflit » au journal (pas une erreur,
  pas de disjoncteur), l'ancienne référence est conservée → fusion/copie de conflit au cycle suivant.
- Toute issue non confirmée (échec, conflit, fichier en cours d'édition, tombstone annulée) **conserve l'ancienne
  référence** (`buildNextReference`) — corrige un bug latent où un push raté faisait tirer le cloud par-dessus
  l'édition locale au cycle suivant.
- Suppression locale d'un fichier modifié ailleurs depuis le dernier cycle : tombstone annulée, le fichier revient.
- RPC absente (migration pas encore appliquée, `PGRST202`) : repli automatique sur l'ancien chemin.

Ordre de déploiement : migration #191 → migration verrou → clients.
