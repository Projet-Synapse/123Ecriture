-- ✒️ 123ECRITURE — Restauration explicite des pierres tombales (restore_file)
-- Dépend de 20261023110000 (#192) et 20261023120000 (#193). Idempotente.
--
-- Problème : prevent_stale_resurrection (trigger vault_files_no_stale_resurrect)
-- remet deleted=true dès qu'une pierre tombale repasse à false avec le MÊME
-- hash — y compris pour restore_file, qui renvoyait ok:true sans effet.
-- Correctif :
--   • restore_file pose le drapeau transaction-local
--     app_123ecriture.allow_restore = 'on' ; le trigger le respecte ;
--   • les écritures directes (anciens clients) restent bloquées ;
--   • quand le trigger bloque, deleted_at / deleted_by_device sont rétablis
--     depuis l'ancienne ligne (deletion_trace, exécuté avant, les avait
--     effacés) : jamais de ligne supprimée sans trace.

create or replace function app_123ecriture.prevent_stale_resurrection()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if old.deleted = true and new.deleted = false and new.content_hash = old.content_hash then
    if coalesce(current_setting('app_123ecriture.allow_restore', true), '') = 'on' then
      return new; -- restauration explicite (restore_file)
    end if;
    new.deleted := true;
    new.deleted_at := old.deleted_at;
    new.deleted_by_device := old.deleted_by_device;
  end if;
  return new;
end;
$$;
revoke all on function app_123ecriture.prevent_stale_resurrection() from public, anon, authenticated;

drop trigger if exists vault_files_no_stale_resurrect on app_123ecriture.vault_files;
create trigger vault_files_no_stale_resurrect
  before update on app_123ecriture.vault_files
  for each row execute function app_123ecriture.prevent_stale_resurrection();

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
  v_n integer;
begin
  perform set_config('app_123ecriture.allow_restore', 'on', true);
  update app_123ecriture.vault_files
     set deleted = false,
         version = version + 1
   where vault_id = p_vault_id
     and rel_path = p_rel_path
     and deleted = true;
  get diagnostics v_n = row_count;
  -- Drapeau refermé aussitôt : rien d'autre dans la transaction n'en profite.
  perform set_config('app_123ecriture.allow_restore', 'off', true);
  if v_n > 0 then
    return app_123ecriture.lock_result(true, p_vault_id, p_rel_path);
  end if;
  if not exists (
    select 1 from app_123ecriture.vault_files where vault_id = p_vault_id and rel_path = p_rel_path
  ) then
    return jsonb_build_object('ok', true, 'conflict', false, 'current_version', null, 'current_hash', null, 'deleted', false);
  end if;
  return app_123ecriture.lock_result(false, p_vault_id, p_rel_path);
end;
$$;
revoke all on function app_123ecriture.restore_file(uuid, text) from public, anon;
grant execute on function app_123ecriture.restore_file(uuid, text) to authenticated;
