-- ✒️ 123ECRITURE — Filet de sécurité serveur : historique des versions de vault_files
-- Chaque UPDATE qui change le contenu (hash, objet, deleted) et chaque DELETE
-- de app_123ecriture.vault_files copie d'abord l'ANCIENNE ligne dans
-- app_123ecriture.vault_file_versions. Aucune perte de métadonnée n'est
-- plus définitive. Le contenu lui-même est archivé côté client (pushFile)
-- sous archive_storage_path. Idempotente. Voir docs/vault-safety-net.md.

create table if not exists app_123ecriture.vault_file_versions (
  id uuid primary key default gen_random_uuid(),
  file_id uuid not null,
  vault_id uuid not null references app_123ecriture.vaults(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  rel_path text not null,
  content_hash text not null,
  size_bytes integer,
  storage_path text not null,
  archive_storage_path text not null,
  deleted boolean not null,
  op text not null check (op in ('update', 'delete')),
  old_row jsonb not null,
  archived_at timestamptz not null default now()
);
comment on table app_123ecriture.vault_file_versions is
  '123Ecriture : historique (filet de sécurité) des lignes vault_files avant modification/suppression. Alimentée uniquement par trigger.';

create index if not exists vault_file_versions_path_idx
  on app_123ecriture.vault_file_versions (vault_id, rel_path, archived_at desc);

alter table app_123ecriture.vault_file_versions enable row level security;

drop policy if exists "vault_file_versions: owner select" on app_123ecriture.vault_file_versions;
create policy "vault_file_versions: owner select" on app_123ecriture.vault_file_versions
  for select to authenticated using (user_id = auth.uid());

-- Lecture seule côté client : aucune policy insert/update/delete, et aucun
-- privilège d'écriture pour authenticated/anon.
revoke all on app_123ecriture.vault_file_versions from anon, authenticated;
grant select on app_123ecriture.vault_file_versions to authenticated;

create or replace function app_123ecriture.archive_vault_file_version()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'UPDATE'
     and old.content_hash is not distinct from new.content_hash
     and old.storage_object_path is not distinct from new.storage_object_path
     and old.deleted is not distinct from new.deleted then
    return new;
  end if;

  insert into app_123ecriture.vault_file_versions (
    file_id, vault_id, user_id, rel_path, content_hash, size_bytes,
    storage_path, archive_storage_path, deleted, op, old_row
  ) values (
    old.id, old.vault_id, old.owner_id, old.rel_path, old.content_hash, old.size_bytes,
    old.storage_object_path,
    -- Même calcul que vaultVersionObjectPath (apps/mobile/lib/sync/storageKeys.ts)
    old.vault_id::text || '/.versions/'
      || regexp_replace(old.storage_object_path, '^.*/', '')
      || '@' || regexp_replace(old.content_hash, '[^A-Za-z0-9_-]', '', 'g'),
    old.deleted,
    lower(tg_op),
    to_jsonb(old)
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function app_123ecriture.archive_vault_file_version() from public, anon, authenticated;

drop trigger if exists vault_files_archive_version on app_123ecriture.vault_files;
create trigger vault_files_archive_version
  before update or delete on app_123ecriture.vault_files
  for each row execute function app_123ecriture.archive_vault_file_version();
