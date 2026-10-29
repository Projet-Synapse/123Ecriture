-- 123Ecriture — traçabilité des suppressions distantes (revue d'approbation).
-- Dépend de 20261023110000_vault_optimistic_lock.sql (tombstone_file).
-- IDEMPOTENTE : rejouable sans effet de bord.
--
--   • vault_files.deleted_by_device : appareil auteur de la pierre tombale
--     (renseigné par tombstone_file, p_device_id) ;
--   • vault_files.deleted_at        : horodatage serveur de la suppression ;
--   • trigger vault_files_deletion_trace : pose deleted_at au passage
--     deleted false→true (y compris anciens clients en UPDATE direct) et
--     EFFACE les deux colonnes au passage true→false (restore_file, push).

alter table app_123ecriture.vault_files
  add column if not exists deleted_by_device text,
  add column if not exists deleted_at timestamptz;

create or replace function app_123ecriture.vault_files_deletion_trace()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.deleted then
    if tg_op = 'INSERT' or not coalesce(old.deleted, false) then
      new.deleted_at := now();
    end if;
  else
    new.deleted_at := null;
    new.deleted_by_device := null;
  end if;
  return new;
end;
$$;
revoke all on function app_123ecriture.vault_files_deletion_trace() from public, anon, authenticated;

drop trigger if exists vault_files_deletion_trace on app_123ecriture.vault_files;
create trigger vault_files_deletion_trace
  before insert or update of deleted on app_123ecriture.vault_files
  for each row execute function app_123ecriture.vault_files_deletion_trace();

-- tombstone_file : + p_device_id (DEFAULT null → les clients 3 arguments
-- continuent de fonctionner). L'ancienne signature est retirée pour éviter
-- l'ambiguïté de surcharge côté PostgREST.
drop function if exists app_123ecriture.tombstone_file(uuid, text, bigint);
create or replace function app_123ecriture.tombstone_file(
  p_vault_id uuid,
  p_rel_path text,
  p_expected_version bigint,
  p_device_id text default null
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
         deleted_by_device = left(nullif(btrim(p_device_id), ''), 200),
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
  return app_123ecriture.lock_result(not found or v_cur.deleted, p_vault_id, p_rel_path);
end;
$$;
revoke all on function app_123ecriture.tombstone_file(uuid, text, bigint, text) from public, anon;
grant execute on function app_123ecriture.tombstone_file(uuid, text, bigint, text) to authenticated;
