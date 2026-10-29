-- Inventaire par appareil (purement additif) : ce que chaque appareil a
-- RÉELLEMENT sur son disque local, publié en fin de cycle (deviceInventory.ts).
-- RLS owner-only via vaults.owner_id. Vue de comparaison avec vault_files.

create table if not exists app_123ecriture.vault_device_inventories (
  vault_id uuid not null references app_123ecriture.vaults(id) on delete cascade,
  device_id text not null,
  device_name text,
  app_version text,
  platform text,
  generated_at timestamptz not null default now(),
  file_count integer not null default 0,
  folder_count integer not null default 0,
  inventory jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (vault_id, device_id)
);

alter table app_123ecriture.vault_device_inventories enable row level security;
revoke all on app_123ecriture.vault_device_inventories from anon;
grant select, insert, update, delete on app_123ecriture.vault_device_inventories to authenticated;

create policy "vault_device_inventories: owner select" on app_123ecriture.vault_device_inventories
  for select to authenticated using (exists (select 1 from app_123ecriture.vaults v where v.id = vault_id and v.owner_id = (select auth.uid())));
create policy "vault_device_inventories: owner insert" on app_123ecriture.vault_device_inventories
  for insert to authenticated with check (exists (select 1 from app_123ecriture.vaults v where v.id = vault_id and v.owner_id = (select auth.uid())));
create policy "vault_device_inventories: owner update" on app_123ecriture.vault_device_inventories
  for update to authenticated using (exists (select 1 from app_123ecriture.vaults v where v.id = vault_id and v.owner_id = (select auth.uid())))
  with check (exists (select 1 from app_123ecriture.vaults v where v.id = vault_id and v.owner_id = (select auth.uid())));
create policy "vault_device_inventories: owner delete" on app_123ecriture.vault_device_inventories
  for delete to authenticated using (exists (select 1 from app_123ecriture.vaults v where v.id = vault_id and v.owner_id = (select auth.uid())));

-- Fichiers VIVANTS côté serveur (chemin POSIX, hors .trash) absents du
-- disque de chaque appareil inventorié. security_invoker : RLS appliquée.
create or replace view app_123ecriture.vault_device_inventory_gaps
with (security_invoker = true) as
with live as (
  select f.vault_id, replace(f.rel_path, '\', '/') as rel_path, f.content_hash, f.updated_at
  from app_123ecriture.vault_files f
  where not f.deleted and replace(f.rel_path, '\', '/') not like '.trash/%'
),
inv as (
  select i.vault_id, i.device_id, i.device_name, i.generated_at, e->>'path' as rel_path, e->>'hash' as hash
  from app_123ecriture.vault_device_inventories i
  cross join lateral jsonb_array_elements(coalesce(i.inventory->'files', '[]'::jsonb)) e
)
select d.vault_id, d.device_id, d.device_name, d.generated_at, l.rel_path, 'absent_sur_appareil'::text as ecart, l.updated_at
from app_123ecriture.vault_device_inventories d
join live l on l.vault_id = d.vault_id
where not exists (select 1 from inv where inv.vault_id = d.vault_id and inv.device_id = d.device_id and inv.rel_path = l.rel_path)
union all
select inv.vault_id, inv.device_id, inv.device_name, inv.generated_at, inv.rel_path, 'absent_du_serveur', null
from inv
where not exists (select 1 from live l where l.vault_id = inv.vault_id and l.rel_path = inv.rel_path)
  and inv.rel_path not like '.123ecriture/%';

revoke all on app_123ecriture.vault_device_inventory_gaps from anon;
grant select on app_123ecriture.vault_device_inventory_gaps to authenticated;
