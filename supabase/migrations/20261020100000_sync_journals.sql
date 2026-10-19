-- v0.4.89 — LES JOURNAUX DE SYNCHRONISATION DES TROIS APPAREILS EN UN SEUL
-- ENDROIT (demande de Catelina : « voir le journal de sync des trois
-- appareils afin de ne définitivement plus interpréter leur situation »).
--
-- Chaque appareil publie à chaque cycle ses dernières entrées de journal
-- ICI ; le plugin Obsidian « 123Ecriture Sync Views » lit la table et
-- affiche les trois colonnes côte à côte.
--
-- À appliquer dans le dashboard Supabase (SQL Editor), comme les
-- migrations précédentes. NOTE : le GRANT select public est VOLONTAIRE —
-- le contenu est un journal d'opérations (chemins + horodatages, aucun
-- contenu de note, aucun secret) et le plugin Obsidian n'a pas de session
-- utilisateur. L'écriture reste réservée aux appareils authentifiés.

create table if not exists app_123ecriture.sync_journals (
  vault_id uuid not null references app_123ecriture.vaults(id) on delete cascade,
  device_id text not null,
  device_name text not null,
  app_version text,
  entries jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (vault_id, device_id)
);

-- La LECTURE est publique (le plugin Obsidian lit avec l'anon key — le
-- contenu est un journal d'opérations, aucun secret).
grant select on app_123ecriture.sync_journals to anon, authenticated;

-- L'ÉCRITURE est réservée aux appareils authentifiés (l'app pousse son
-- propre journal — jamais celui d'un autre).
grant insert, update on app_123ecriture.sync_journals to authenticated;

create policy "sync_journals: lecture publique" on app_123ecriture.sync_journals
  for select using (true);
create policy "sync_journals: les appareils publient leur journal" on app_123ecriture.sync_journals
  for insert to authenticated with check (true);
create policy "sync_journals: les appareils mettent à jour leur journal" on app_123ecriture.sync_journals
  for update to authenticated using (true);
