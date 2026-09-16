-- 123Ecriture — recette de mise en place COMPLÈTE et IDEMPOTENTE du cloud.
-- À coller telle quelle dans le SQL Editor du projet Supabase partagé
-- (« 🍳 123Cuisine ») : Dashboard → SQL Editor → New query → Run.
-- Sans danger si une partie est déjà appliquée (if not exists / drop policy).
--
-- Pourquoi ce fichier : l'app affiche « Invalid schema: app_123ecriture
-- (code PGRST106) » tant que le schéma n'est pas EXPOSÉ à l'API (étape 5) —
-- la migration d'août créait les tables mais personne n'avait exposé le
-- schéma, donc AUCUNE requête de sync ne pouvait aboutir.
-- Voir docs/ARCHITECTURE.md §6.

-- 1) Schéma dédié (jamais `public`, réservé aux autres apps du projet)
create schema if not exists app_123ecriture;

-- 2) Tables
create table if not exists app_123ecriture.vaults (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  local_vault_id text not null,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, local_vault_id)
);

create table if not exists app_123ecriture.vault_files (
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
create index if not exists vault_files_vault_id_idx on app_123ecriture.vault_files (vault_id);

-- 3) RLS strictement propriétaire uniquement
alter table app_123ecriture.vaults enable row level security;
alter table app_123ecriture.vault_files enable row level security;

drop policy if exists "vaults: owner select" on app_123ecriture.vaults;
drop policy if exists "vaults: owner insert" on app_123ecriture.vaults;
drop policy if exists "vaults: owner update" on app_123ecriture.vaults;
drop policy if exists "vaults: owner delete" on app_123ecriture.vaults;
create policy "vaults: owner select" on app_123ecriture.vaults
  for select to authenticated using (owner_id = auth.uid());
create policy "vaults: owner insert" on app_123ecriture.vaults
  for insert to authenticated with check (owner_id = auth.uid());
create policy "vaults: owner update" on app_123ecriture.vaults
  for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "vaults: owner delete" on app_123ecriture.vaults
  for delete to authenticated using (owner_id = auth.uid());

drop policy if exists "vault_files: owner select" on app_123ecriture.vault_files;
drop policy if exists "vault_files: owner insert" on app_123ecriture.vault_files;
drop policy if exists "vault_files: owner update" on app_123ecriture.vault_files;
drop policy if exists "vault_files: owner delete" on app_123ecriture.vault_files;
create policy "vault_files: owner select" on app_123ecriture.vault_files
  for select to authenticated using (owner_id = auth.uid());
create policy "vault_files: owner insert" on app_123ecriture.vault_files
  for insert to authenticated with check (owner_id = auth.uid());
create policy "vault_files: owner update" on app_123ecriture.vault_files
  for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "vault_files: owner delete" on app_123ecriture.vault_files
  for delete to authenticated using (owner_id = auth.uid());

-- Privilèges pour le rôle API connecté (aucun grant à `anon` : la synchro
-- exige un compte)
grant usage on schema app_123ecriture to authenticated;
grant select, insert, update, delete on app_123ecriture.vaults to authenticated;
grant select, insert, update, delete on app_123ecriture.vault_files to authenticated;

-- 4) Bucket Storage privé dédié (chemin d'objet : <vaults.id>/<relPath>)
insert into storage.buckets (id, name, public)
values ('123ecriture-vaults', '123ecriture-vaults', false)
on conflict (id) do nothing;

drop policy if exists "123ecriture: owner select objects" on storage.objects;
drop policy if exists "123ecriture: owner insert objects" on storage.objects;
drop policy if exists "123ecriture: owner update objects" on storage.objects;
drop policy if exists "123ecriture: owner delete objects" on storage.objects;
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

-- 5) L'ÉTAPE QUI MANQUAIT : exposer le schéma à l'API PostgREST.
-- Sans elle, toute requête échoue avec PGRST106 « Invalid schema ».
-- (La liste écrase la config : reprendre les schémas par défaut + le nôtre.)
alter database postgres set pgrst.db_schemas = 'public, graphql_public, app_123ecriture';
notify pgrst, 'reload config';
