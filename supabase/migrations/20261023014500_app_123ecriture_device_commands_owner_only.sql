-- Appliquée en prod le 23/10/2026 (lcfbzfsfubegppsyzkeb).
-- Supprime l'accès anonyme (insertion par clé partagée en dur + lecture publique
-- de toutes les commandes/résultats). L'app (deviceGateway.ts) lit et écrit
-- déjà avec la session utilisateur et owner_id : aucun client n'est cassé.
drop policy if exists "device_commands: insertion par clé partagée" on app_123ecriture.device_commands;
drop policy if exists "device_commands: lecture des résultats" on app_123ecriture.device_commands;
drop policy if exists "device_commands: owner insert" on app_123ecriture.device_commands;
create policy "device_commands: owner insert" on app_123ecriture.device_commands
  for insert to authenticated
  with check (owner_id = (select auth.uid())
    and exists (select 1 from app_123ecriture.vaults v where v.id = vault_id and v.owner_id = (select auth.uid())));
revoke all on app_123ecriture.device_commands from anon;
