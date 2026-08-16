-- 123Ecriture — coffres (vaults) + synchronisation par compte Google.
-- Voir docs/ARCHITECTURE.md §6.
--
-- Projet Supabase PARTAGÉ ("Projet Synapse") avec une autre app en prod
-- (tables `public.recipes`, `public.user_profiles`...) — tout ce qui suit
-- vit dans un schéma dédié `app_123ecriture`, jamais dans `public`, pour ne
-- rien risquer côté existant.

create schema if not exists app_123ecriture;

-- Identité CLOUD d'un coffre local. `local_vault_id` est l'id miné côté
-- client dans .123ecriture/vault.json (voir apps/desktop/electron/vaults.js)
-- — relie un dossier à sa ligne cloud indépendamment de son chemin/machine.
create table app_123ecriture.vaults (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  local_vault_id text not null,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, local_vault_id)
);
comment on table app_123ecriture.vaults is
  '123Ecriture : identité cloud d''un coffre local, une ligne par (propriétaire, coffre local).';

-- Métadonnées de synchro, une ligne par note (un objet Storage par note,
-- granularité choisie pour cette app — voir docs/ARCHITECTURE.md §6).
-- `deleted` réservé à un futur suivi de suppression (v0.1) : jamais posé à
-- true par le code v0, filtré défensivement quand même.
create table app_123ecriture.vault_files (
  id uuid primary key default gen_random_uuid(),
  vault_id uuid not null references app_123ecriture.vaults(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  rel_path text not null,
  content_hash text not null,
  size_bytes integer not null,
  storage_object_path text not null,
  updated_at timestamptz not null,
  deleted boolean not null default false,
  created_at timestamptz not null default now(),
  unique (vault_id, rel_path)
);
comment on table app_123ecriture.vault_files is
  '123Ecriture : métadonnées de synchro par note (hash/taille/horodatage), un objet Storage par ligne.';
create index vault_files_vault_id_idx on app_123ecriture.vault_files (vault_id);

-- RLS : strictement propriétaire uniquement des deux côtés.
alter table app_123ecriture.vaults enable row level security;
alter table app_123ecriture.vault_files enable row level security;

create policy "vaults: owner select" on app_123ecriture.vaults
  for select to authenticated using (owner_id = auth.uid());
create policy "vaults: owner insert" on app_123ecriture.vaults
  for insert to authenticated with check (owner_id = auth.uid());
create policy "vaults: owner update" on app_123ecriture.vaults
  for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "vaults: owner delete" on app_123ecriture.vaults
  for delete to authenticated using (owner_id = auth.uid());

create policy "vault_files: owner select" on app_123ecriture.vault_files
  for select to authenticated using (owner_id = auth.uid());
create policy "vault_files: owner insert" on app_123ecriture.vault_files
  for insert to authenticated with check (owner_id = auth.uid());
create policy "vault_files: owner update" on app_123ecriture.vault_files
  for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "vault_files: owner delete" on app_123ecriture.vault_files
  for delete to authenticated using (owner_id = auth.uid());

-- RLS restreint les LIGNES, mais PostgREST a aussi besoin des privilèges
-- schéma/table pour le rôle, sinon chaque requête échoue avant même que RLS
-- ne s'applique. Volontairement AUCUN grant à `anon` : la synchro exige un
-- compte connecté.
grant usage on schema app_123ecriture to authenticated;
grant select, insert, update, delete on app_123ecriture.vaults to authenticated;
grant select, insert, update, delete on app_123ecriture.vault_files to authenticated;

-- Bucket Storage privé dédié (jamais partagé avec les autres apps du
-- projet). Chemin d'objet : "<vaults.id>/<relPath>".
insert into storage.buckets (id, name, public)
values ('123ecriture-vaults', '123ecriture-vaults', false)
on conflict (id) do nothing;

-- Policies Storage par LOOKUP (jamais par segment de chemin "de confiance")
-- — révoquer une ligne `vaults` coupe aussi l'accès à ses objets.
create policy "123ecriture: owner select objects" on storage.objects
  for select to authenticated using (
    bucket_id = '123ecriture-vaults'
    and exists (
      select 1 from app_123ecriture.vaults v
      where v.id::text = (storage.foldername(name))[1] and v.owner_id = auth.uid()
    )
  );
create policy "123ecriture: owner insert objects" on storage.objects
  for insert to authenticated with check (
    bucket_id = '123ecriture-vaults'
    and exists (
      select 1 from app_123ecriture.vaults v
      where v.id::text = (storage.foldername(name))[1] and v.owner_id = auth.uid()
    )
  );
create policy "123ecriture: owner update objects" on storage.objects
  for update to authenticated using (
    bucket_id = '123ecriture-vaults'
    and exists (
      select 1 from app_123ecriture.vaults v
      where v.id::text = (storage.foldername(name))[1] and v.owner_id = auth.uid()
    )
  ) with check (
    bucket_id = '123ecriture-vaults'
    and exists (
      select 1 from app_123ecriture.vaults v
      where v.id::text = (storage.foldername(name))[1] and v.owner_id = auth.uid()
    )
  );
create policy "123ecriture: owner delete objects" on storage.objects
  for delete to authenticated using (
    bucket_id = '123ecriture-vaults'
    and exists (
      select 1 from app_123ecriture.vaults v
      where v.id::text = (storage.foldername(name))[1] and v.owner_id = auth.uid()
    )
  );
