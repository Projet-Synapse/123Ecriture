-- v0.4.71 — Observabilité croisée des appareils (« donner des yeux au
-- vault », demande de Catelina, 17/10/2026) : chaque appareil publie dans
-- son heartbeat la version de l'app et le résumé de son dernier cycle de
-- synchronisation ; la carte « Appareils connectés » les affiche pour tous.
--
-- À appliquer dans le dashboard Supabase (SQL Editor) sur la base
-- lcfbzfsfubegppsyzkeb. Sans cette migration, le code reste fonctionnel :
-- le heartbeat retombe sur les colonnes historiques (repli gracieux) et la
-- carte n'affiche simplement pas les nouvelles informations.
--
-- RLS inchangée : mêmes lignes, mêmes policies, on ne fait qu'élargir la
-- ligne existante (upsert sur vault_id,device_id déjà en place).

alter table app_123ecriture.vault_devices
  add column if not exists app_version text,
  add column if not exists last_cycle_at timestamptz,
  add column if not exists last_cycle_pushed integer,
  add column if not exists last_cycle_pulled integer,
  add column if not exists last_cycle_deleted integer,
  add column if not exists last_cycle_conflicts integer,
  add column if not exists last_cycle_errors integer;

comment on column app_123ecriture.vault_devices.app_version is
  'Version de l''app de l''appareil (ex. 0.4.71) au moment du heartbeat';
comment on column app_123ecriture.vault_devices.last_cycle_at is
  'Horodatage du dernier cycle de synchronisation terminé par cet appareil';
comment on column app_123ecriture.vault_devices.last_cycle_pushed is
  'Fichiers poussés (envoyés) lors du dernier cycle';
comment on column app_123ecriture.vault_devices.last_cycle_pulled is
  'Fichiers tirés (reçus) lors du dernier cycle';
comment on column app_123ecriture.vault_devices.last_cycle_deleted is
  'Lignes supprimées/tombstonées lors du dernier cycle';
comment on column app_123ecriture.vault_devices.last_cycle_conflicts is
  'Conflits traités lors du dernier cycle';
comment on column app_123ecriture.vault_devices.last_cycle_errors is
  'Erreurs rencontrées lors du dernier cycle';
