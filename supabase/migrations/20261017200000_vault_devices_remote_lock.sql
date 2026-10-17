-- v0.4.72 — VERROU À DISTANCE DES APPAREILS (demande de Catelina, 17/10 :
-- « ajoute le contrôle à distance sur les connexions des appareils au vault
-- distant … cela pourra me servir dans des cas d'urgence »).
--
-- Chaque appareil publie son heartbeat dans vault_devices ; ces colonnes
-- permettent de LE VERROUILLER à distance (depuis la carte « Appareils
-- connectés » d'un autre appareil, ou directement en SQL/API en cas
-- d'urgence) : un appareil verrouillé n'exécute PLUS AUCUN cycle cloud
-- (il continue de travailler en local, zéro perte de données) tant que le
-- verrou n'est pas levé.
--
-- À appliquer dans le dashboard Supabase (SQL Editor), comme la migration
-- 20261017120000_vault_devices_observability.sql. RLS inchangée.

alter table app_123ecriture.vault_devices
  add column if not exists locked boolean not null default false,
  add column if not exists lock_reason text,
  add column if not exists locked_at timestamptz;

comment on column app_123ecriture.vault_devices.locked is
  'Verrou d''urgence : true = cet appareil n''exécute plus aucun cycle cloud';
comment on column app_123ecriture.vault_devices.lock_reason is
  'Motif du verrou (affiché sur l''appareil concerné)';
comment on column app_123ecriture.vault_devices.locked_at is
  'Horodatage de la dernière pose/levée de verrou';
