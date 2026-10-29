-- Envoi GROUPÉ des marqueurs de dossier (`<dossier>/.123ecriture-dossier`,
-- taille 0, aucun objet Storage). Une requête pour N marqueurs au lieu de N
-- appels push_file. Même sémantique que push_file avec p_expected_version
-- NULL : insertion si absente, jamais d'écrasement ni de résurrection d'une
-- pierre tombale (restore_file reste le seul chemin). Le client retombe sur
-- push_file en parallèle tant que cette migration n'est pas appliquée.
create or replace function app_123ecriture.push_folder_markers(p_vault_id uuid, p_items jsonb)
returns jsonb
language plpgsql
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_uid uuid := app_123ecriture.assert_vault_owner(p_vault_id);
  v_item jsonb;
  v_path text;
  v_storage text;
  v_out jsonb := '[]'::jsonb;
  v_ok boolean;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 500 then
    raise exception 'p_items: tableau de 500 éléments au plus' using errcode = '22023';
  end if;
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_path := v_item->>'rel_path';
    v_storage := v_item->>'storage_path';
    if v_path is null or right(v_path, 20) <> '.123ecriture-dossier' then
      raise exception 'not a folder marker: %', v_path using errcode = '22023';
    end if;
    if v_storage is null or left(v_storage, length(p_vault_id::text) + 1) <> p_vault_id::text || '/' then
      raise exception 'storage path outside vault' using errcode = '22023';
    end if;
    insert into app_123ecriture.vault_files (vault_id, owner_id, rel_path, content_hash, size_bytes, storage_object_path, deleted)
    values (p_vault_id, v_uid, v_path, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 0, v_storage, false)
    on conflict (vault_id, rel_path) do nothing;
    if found then
      v_ok := true;
    else
      select not deleted into v_ok from app_123ecriture.vault_files where vault_id = p_vault_id and rel_path = v_path;
    end if;
    v_out := v_out || jsonb_build_object('rel_path', v_path, 'ok', coalesce(v_ok, false));
  end loop;
  return v_out;
end;
$function$;

revoke all on function app_123ecriture.push_folder_markers(uuid, jsonb) from public, anon;
grant execute on function app_123ecriture.push_folder_markers(uuid, jsonb) to authenticated;
