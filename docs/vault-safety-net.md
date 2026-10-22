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
