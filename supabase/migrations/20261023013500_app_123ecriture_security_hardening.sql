-- Appliquée en prod le 23/10/2026 (projet lcfbzfsfubegppsyzkeb) via MCP.
-- Sauvegardes privées (RLS, aucun accès anon/authenticated)
create table if not exists app_123ecriture.vault_files_backup_20261023 as select * from app_123ecriture.vault_files;
create table if not exists app_123ecriture.vault_devices_backup_20261023 as select * from app_123ecriture.vault_devices;
create table if not exists app_123ecriture.device_commands_backup_20261023 as select * from app_123ecriture.device_commands;
alter table app_123ecriture.vault_files_backup_20261023 enable row level security;
alter table app_123ecriture.vault_devices_backup_20261023 enable row level security;
alter table app_123ecriture.device_commands_backup_20261023 enable row level security;
revoke all on app_123ecriture.vault_files_backup_20261023, app_123ecriture.vault_devices_backup_20261023, app_123ecriture.device_commands_backup_20261023 from anon, authenticated;

-- agent_coordination : outil interne d'agents, plus exposé
alter table app_123ecriture.agent_coordination enable row level security;
revoke all on app_123ecriture.agent_coordination from anon, authenticated;

-- sync_journals : lecture publique remplacée par accès propriétaire du coffre
drop policy if exists "sync_journals: lecture publique" on app_123ecriture.sync_journals;
drop policy if exists "sync_journals: les appareils mettent à jour leur journal" on app_123ecriture.sync_journals;
drop policy if exists "sync_journals: les appareils publient leur journal" on app_123ecriture.sync_journals;
create policy "sync_journals: owner select" on app_123ecriture.sync_journals for select to authenticated using (exists (select 1 from app_123ecriture.vaults v where v.id = vault_id and v.owner_id = (select auth.uid())));
create policy "sync_journals: owner insert" on app_123ecriture.sync_journals for insert to authenticated with check (exists (select 1 from app_123ecriture.vaults v where v.id = vault_id and v.owner_id = (select auth.uid())));
create policy "sync_journals: owner update" on app_123ecriture.sync_journals for update to authenticated using (exists (select 1 from app_123ecriture.vaults v where v.id = vault_id and v.owner_id = (select auth.uid()))) with check (exists (select 1 from app_123ecriture.vaults v where v.id = vault_id and v.owner_id = (select auth.uid())));
revoke all on app_123ecriture.sync_journals from anon;

alter function app_123ecriture.prevent_stale_resurrection() set search_path = app_123ecriture, pg_catalog;

-- Le trigger auth continue de fonctionner (exécuté par le propriétaire)
revoke execute on function public.handle_new_user() from public, anon, authenticated;
