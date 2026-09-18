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

-- 4) Bucket Storage privé dédié (chemin d'objet : <vaults.id>/<clé encodée>)
insert into storage.buckets (id, name, public)
values ('123ecriture-vaults', '123ecriture-vaults', false)
on conflict (id) do nothing;

-- Politique Storage : forme PROUVÉE en réel (v0.4.9), identique à celle
-- appliquée via le dashboard → Storage → Policies. Les formes précédentes
-- (storage.foldername(name)[1], puis sous-requête exists(... vaults ...))
-- ont TOUTES échoué avec 403 « new row violates row-level security » :
-- les sous-requêtes vers un autre schéma ne passent pas dans les policies
-- storage. On s'appuie sur storage.objects.owner_id (TEXT, rempli par
-- Supabase à l'upload avec l'uid de l'utilisateur connecté).
drop policy if exists "123ecriture: owner select objects" on storage.objects;
drop policy if exists "123ecriture: owner insert objects" on storage.objects;
drop policy if exists "123ecriture: owner update objects" on storage.objects;
drop policy if exists "123ecriture: owner delete objects" on storage.objects;
drop policy if exists "123ecriture_vaults_owner_all" on storage.objects;
create policy "123ecriture_vaults_owner_all" on storage.objects
  for all to authenticated
  using (bucket_id = '123ecriture-vaults' and owner_id = auth.uid()::text)
  with check (bucket_id = '123ecriture-vaults' and owner_id = auth.uid()::text);

-- 5) Exposer le schéma à l'API PostgREST.
-- Sans elle, toute requête échoue avec PGRST106 « Invalid schema ».
-- (La liste écrase la config : reprendre les schémas par défaut + le nôtre.)
-- ⚠️ En hébergé, le rôle postgres n'a pas le droit de modifier ce paramètre
-- (« permission denied to set parameter pgrst.db_schemas ») : dans ce cas,
-- passer par le Dashboard → Project Settings → Data API → Exposed schemas
-- et ajouter app_123ecriture à la liste, puis Save/Restart.
alter database postgres set pgrst.db_schemas = 'public, graphql_public, app_123ecriture';
notify pgrst, 'reload config';

-- 6) Appareils connectés à chaque coffre (v0.4.10) : heartbeat par appareil
-- à chaque synchro (Paramètres → Coffres distants affiche « qui » est
-- connecté et quand il a été vu la dernière fois).
create table if not exists app_123ecriture.vault_devices (
  vault_id uuid not null references app_123ecriture.vaults(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  device_id text not null,
  device_name text not null,
  last_seen_at timestamptz not null default now(),
  primary key (vault_id, device_id)
);

alter table app_123ecriture.vault_devices enable row level security;
drop policy if exists "vault_devices: owner select" on app_123ecriture.vault_devices;
drop policy if exists "vault_devices: owner insert" on app_123ecriture.vault_devices;
drop policy if exists "vault_devices: owner update" on app_123ecriture.vault_devices;
drop policy if exists "vault_devices: owner delete" on app_123ecriture.vault_devices;
create policy "vault_devices: owner select" on app_123ecriture.vault_devices
  for select to authenticated using (owner_id = auth.uid());
create policy "vault_devices: owner insert" on app_123ecriture.vault_devices
  for insert to authenticated with check (owner_id = auth.uid());
create policy "vault_devices: owner update" on app_123ecriture.vault_devices
  for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "vault_devices: owner delete" on app_123ecriture.vault_devices
  for delete to authenticated using (owner_id = auth.uid());

grant select, insert, update, delete on app_123ecriture.vault_devices to authenticated;
