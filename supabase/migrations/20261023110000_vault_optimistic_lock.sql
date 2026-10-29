-- ✒️ 123ECRITURE — Verrou optimiste sur app_123ecriture.vault_files
-- Dépend de 20261023100000_vault_file_versions.sql (#191). Idempotente.
-- • version bigint : incrémentée à CHAQUE changement de contenu/état, y
--   compris par les anciens clients (upsert direct) grâce au trigger.
-- • updated_at posé par le serveur (plus d'horloge d'appareil).
-- • RPC push_file / tombstone_file / restore_file : écriture conditionnelle
--   « WHERE version = attendue » ; refus structuré sinon. push_file ne
--   ressuscite JAMAIS une pierre tombale (seul restore_file le fait).
-- Voir docs/vault-safety-net.md §Verrou optimiste.

alter table app_123ecriture.vault_files
  add column if not exists version bigint not null default 1;

alter table app_123ecriture.vault_file_versions
  add column if not exists version bigint;

-- 1. Horodatage + version posés par le serveur -----------------------------
create or replace function app_123ecriture.vault_files_server_stamp()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.version := 1;
    return new;
  end if;
  -- Ancien client (upsert direct, version non touchée) : la version suit
  -- quand même tout changement réel. Les RPC posent old.version + 1.
  if new.version is not distinct from old.version
     and (new.content_hash is distinct from old.content_hash
          or new.storage_object_path is distinct from old.storage_object_path
          or new.deleted is distinct from old.deleted
          or new.rel_path is distinct from old.rel_path) then
    new.version := old.version + 1;
  elsif new.version < old.version then
    -- jamais de retour en arrière
    new.version := old.version + 1;
  end if;
  return new;
end;
$$;

drop trigger if exists vault_files_server_stamp on app_123ecriture.vault_files;
create trigger vault_files_server_stamp
  before insert or update on app_123ecriture.vault_files
  for each row execute function app_123ecriture.vault_files_server_stamp();

-- 2. Filet #191 : version archivée ; clé `@hash` = déjà immuable ----------
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
    storage_path, archive_storage_path, deleted, op, old_row, version
  ) values (
    old.id, old.vault_id, old.owner_id, old.rel_path, old.content_hash, old.size_bytes,
    old.storage_object_path,
    case
      -- Clé versionnée (`<clé>@<hash>`, verrou optimiste) : jamais réécrite,
      -- l'objet EST l'archive.
      when old.storage_object_path like '%@%' then old.storage_object_path
      -- Même calcul que vaultVersionObjectPath (storageKeys.ts)
      else old.vault_id::text || '/.versions/'
        || regexp_replace(old.storage_object_path, '^.*/', '')
        || '@' || regexp_replace(old.content_hash, '[^A-Za-z0-9_-]', '', 'g')
    end,
    old.deleted,
    lower(tg_op),
    to_jsonb(old),
    old.version
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function app_123ecriture.archive_vault_file_version() from public, anon, authenticated;

-- 3. RPC -------------------------------------------------------------------
-- SECURITY INVOKER : la RLS « owner » de vault_files s'applique ; le contrôle
-- explicite de propriété du coffre rend l'erreur lisible.
create or replace function app_123ecriture.lock_result(
  p_ok boolean, p_vault_id uuid, p_rel_path text
)
returns jsonb
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'ok', p_ok,
    'conflict', not p_ok,
    'current_version', f.version,
    'current_hash', f.content_hash,
    'deleted', coalesce(f.deleted, false)
  )
  from (select 1) dummy
  left join app_123ecriture.vault_files f
    on f.vault_id = p_vault_id and f.rel_path = p_rel_path;
$$;

create or replace function app_123ecriture.assert_vault_owner(p_vault_id uuid)
returns uuid
language plpgsql
stable
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not exists (
    select 1 from app_123ecriture.vaults v where v.id = p_vault_id and v.owner_id = v_uid
  ) then
    raise exception 'vault not found or not owned' using errcode = '42501';
  end if;
  return v_uid;
end;
$$;

create or replace function app_123ecriture.push_file(
  p_vault_id uuid,
  p_rel_path text,
  p_expected_version bigint,
  p_content_hash text,
  p_size_bytes integer,
  p_storage_path text
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := app_123ecriture.assert_vault_owner(p_vault_id);
  v_cur app_123ecriture.vault_files%rowtype;
begin
  if p_storage_path is null or left(p_storage_path, length(p_vault_id::text) + 1) <> p_vault_id::text || '/' then
    raise exception 'storage path outside vault' using errcode = '22023';
  end if;

  if p_expected_version is null then
    insert into app_123ecriture.vault_files (
      vault_id, owner_id, rel_path, content_hash, size_bytes, storage_object_path, deleted
    ) values (
      p_vault_id, v_uid, p_rel_path, p_content_hash, p_size_bytes, p_storage_path, false
    )
    on conflict (vault_id, rel_path) do nothing;
  else
    -- Jamais sur une pierre tombale : restore_file est le seul chemin.
    update app_123ecriture.vault_files
       set content_hash = p_content_hash,
           size_bytes = p_size_bytes,
           storage_object_path = p_storage_path,
           version = version + 1
     where vault_id = p_vault_id
       and rel_path = p_rel_path
       and version = p_expected_version
       and deleted = false;
  end if;
  if found then
    return app_123ecriture.lock_result(true, p_vault_id, p_rel_path);
  end if;

  -- Idempotence : même contenu déjà en place (retry après coupure réseau).
  select * into v_cur from app_123ecriture.vault_files
   where vault_id = p_vault_id and rel_path = p_rel_path;
  return app_123ecriture.lock_result(
    found and not v_cur.deleted and v_cur.content_hash = p_content_hash,
    p_vault_id, p_rel_path
  );
end;
$$;

create or replace function app_123ecriture.tombstone_file(
  p_vault_id uuid,
  p_rel_path text,
  p_expected_version bigint
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := app_123ecriture.assert_vault_owner(p_vault_id);
  v_cur app_123ecriture.vault_files%rowtype;
begin
  update app_123ecriture.vault_files
     set deleted = true,
         version = version + 1
   where vault_id = p_vault_id
     and rel_path = p_rel_path
     and deleted = false
     and (p_expected_version is null or version = p_expected_version);
  if found then
    return app_123ecriture.lock_result(true, p_vault_id, p_rel_path);
  end if;
  select * into v_cur from app_123ecriture.vault_files
   where vault_id = p_vault_id and rel_path = p_rel_path;
  -- Absent ou déjà supprimé : objectif atteint.
  return app_123ecriture.lock_result(not found or v_cur.deleted, p_vault_id, p_rel_path);
end;
$$;

create or replace function app_123ecriture.restore_file(
  p_vault_id uuid,
  p_rel_path text
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := app_123ecriture.assert_vault_owner(p_vault_id);
begin
  update app_123ecriture.vault_files
     set deleted = false,
         version = version + 1
   where vault_id = p_vault_id
     and rel_path = p_rel_path
     and deleted = true;
  if found then
    return app_123ecriture.lock_result(true, p_vault_id, p_rel_path);
  end if;
  if not exists (
    select 1 from app_123ecriture.vault_files where vault_id = p_vault_id and rel_path = p_rel_path
  ) then
    -- Aucune ligne : rien à lever, le push suivant créera (version attendue null).
    return jsonb_build_object('ok', true, 'conflict', false, 'current_version', null, 'current_hash', null, 'deleted', false);
  end if;
  -- Ligne vivante : quelqu'un a déjà recréé ce chemin → conflit.
  return app_123ecriture.lock_result(false, p_vault_id, p_rel_path);
end;
$$;

revoke all on function app_123ecriture.vault_files_server_stamp() from public, anon, authenticated;
revoke all on function app_123ecriture.lock_result(boolean, uuid, text) from public, anon;
revoke all on function app_123ecriture.assert_vault_owner(uuid) from public, anon;
revoke all on function app_123ecriture.push_file(uuid, text, bigint, text, integer, text) from public, anon;
revoke all on function app_123ecriture.tombstone_file(uuid, text, bigint) from public, anon;
revoke all on function app_123ecriture.restore_file(uuid, text) from public, anon;
grant execute on function app_123ecriture.lock_result(boolean, uuid, text) to authenticated;
grant execute on function app_123ecriture.assert_vault_owner(uuid) to authenticated;
grant execute on function app_123ecriture.push_file(uuid, text, bigint, text, integer, text) to authenticated;
grant execute on function app_123ecriture.tombstone_file(uuid, text, bigint) to authenticated;
grant execute on function app_123ecriture.restore_file(uuid, text) to authenticated;
