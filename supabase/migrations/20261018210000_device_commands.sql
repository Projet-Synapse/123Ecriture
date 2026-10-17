-- v0.4.76 — PASSERELLE À DISTANCE (demande de Catelina : « une passerelle
-- alternative au câble USB et au débogage sans fil qui permet de contrôler
-- si nécessaire mon téléphone Android ») : chaque appareil exécute, à
-- chaque cycle de synchro, les commandes qui lui sont adressées ici et
-- publie le résultat. Le canal est Supabase, déjà authentifié (RLS owner) :
-- plus aucun besoin d'adb pour voir l'état d'un appareil ou lever son
-- disjoncteur à distance.
--
-- Commandes v1 (deviceGateway.ts) : dump-diagnostics · clear-sync-block ·
-- lock-sync · unlock-sync. Toutes les commandes et résultats restent dans
-- la table (audit).
--
-- À appliquer dans le dashboard Supabase (SQL Editor), comme les
-- migrations 20261017120000 et 20261017200000.

create table if not exists app_123ecriture.device_commands (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  vault_id uuid not null references app_123ecriture.vaults(id) on delete cascade,
  device_id text not null,
  command text not null,
  params jsonb,
  status text not null default 'pending',
  result text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create policy "device_commands: owner select" on app_123ecriture.device_commands
  for select to authenticated using (owner_id = auth.uid());
create policy "device_commands: owner insert" on app_123ecriture.device_commands
  for insert to authenticated with check (owner_id = auth.uid());
create policy "device_commands: owner update" on app_123ecriture.device_commands
  for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "device_commands: owner delete" on app_123ecriture.device_commands
  for delete to authenticated using (owner_id = auth.uid());

create index if not exists device_commands_device_pending
  on app_123ecriture.device_commands (device_id, created_at)
  where status = 'pending';
