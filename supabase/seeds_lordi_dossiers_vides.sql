-- SEED (NON APPLIQUÉ) — dossiers vides du WORLDBUILDING sur LORDI → cloud,
-- au format « dossier de première classe » : ligne marqueur
-- <dossier>/.123ecriture-dossier, contenu vide (hash SHA-256 de ''), taille 0.
-- Coffre bbce9f43-d767-45c9-a221-31c45ec4a03a. Parents inclus. Chemins normalisés NFC.
-- Ne crée RIEN pour un dossier qui existe déjà dans le cloud (marqueur
-- présent, ou au moins un fichier vivant sous ce dossier, comparaison NFC).
-- Idempotent (on conflict do nothing). Aucun objet Storage n'est requis :
-- les clients ne téléchargent jamais un marqueur.
with v as (
  select id, owner_id from app_123ecriture.vaults where id = 'bbce9f43-d767-45c9-a221-31c45ec4a03a'
), wanted(dir) as (
  values
    ('1. 👁️ L''ENCHANTERESSE'),
    ('1. 👁️ L''ENCHANTERESSE/📄 RÉSUMÉS'),
    ('1. 👁️ L''ENCHANTERESSE/📄 RÉSUMÉS/0. 🌐 GAMEPLAY ET SIMULATION'),
    ('1. 👁️ L''ENCHANTERESSE/📄 RÉSUMÉS/0. 🌐 GAMEPLAY ET SIMULATION/ℹ IMPLEMENTATION'),
    ('1. 👁️ L''ENCHANTERESSE/📄 RÉSUMÉS/0. 🌐 GAMEPLAY ET SIMULATION/🌲 ENVIRONNEMENT'),
    ('1. 👁️ L''ENCHANTERESSE/📄 RÉSUMÉS/0. 🌐 GAMEPLAY ET SIMULATION/🪐 LOIS DU MONDE'),
    ('1. 👁️ L''ENCHANTERESSE/📄 RÉSUMÉS/1. 🗃️ BASES DE DONNEES'),
    ('1. 👁️ L''ENCHANTERESSE/📄 RÉSUMÉS/1. 🗃️ BASES DE DONNEES/🔙 ARCHIVES'),
    ('1. 👁️ L''ENCHANTERESSE/📄 RÉSUMÉS/4. 👥 FACTIONS'),
    ('1. 👁️ L''ENCHANTERESSE/📄 RÉSUMÉS/4. 👥 FACTIONS/⛪ RELIGIONS'),
    ('1. 👁️ L''ENCHANTERESSE/📄 RÉSUMÉS/4. 👥 FACTIONS/🌳 LIGNEES'),
    ('1. 👁️ L''ENCHANTERESSE/📇 TEMPLATES'),
    ('1. 👁️ L''ENCHANTERESSE/📇 TEMPLATES/0. 🌐 GAMEPLAY ET SIMULATION'),
    ('1. 👁️ L''ENCHANTERESSE/📇 TEMPLATES/0. 🌐 GAMEPLAY ET SIMULATION/🌲 ENVIRONNEMENT'),
    ('1. 👁️ L''ENCHANTERESSE/📇 TEMPLATES/0. 🌐 GAMEPLAY ET SIMULATION/📖 NARRATION'),
    ('1. 👁️ L''ENCHANTERESSE/📇 TEMPLATES/3. 🗺️ MAP'),
    ('1. 👁️ L''ENCHANTERESSE/📇 TEMPLATES/3. 🗺️ MAP/🏠 HABITATIONS'),
    ('1. 👁️ L''ENCHANTERESSE/📇 TEMPLATES/4. 👥 FACTIONS'),
    ('1. 👁️ L''ENCHANTERESSE/📇 TEMPLATES/4. 👥 FACTIONS/⚖️ INSTITUTIONS'),
    ('1. 👁️ L''ENCHANTERESSE/📇 TEMPLATES/4. 👥 FACTIONS/⛪ RELIGIONS'),
    ('1. 👁️ L''ENCHANTERESSE/📇 TEMPLATES/4. 👥 FACTIONS/✊ IDEOLOGIES'),
    ('1. 👁️ L''ENCHANTERESSE/📇 TEMPLATES/4. 👥 FACTIONS/🌳 LIGNÉES'),
    ('1. 👁️ L''ENCHANTERESSE/📇 TEMPLATES/5. 👤 PERSONNAGES'),
    ('1. 👁️ L''ENCHANTERESSE/📇 TEMPLATES/5. 👤 PERSONNAGES/🚸 ENJEUX'),
    ('1. 👁️ L''ENCHANTERESSE/📇 TEMPLATES/5. 👤 PERSONNAGES/🚸 ENJEUX/🏫 GEN V'),
    ('2. 🦸🏼 L''HOMME VOLANT'),
    ('2. 🦸🏼 L''HOMME VOLANT/📇 TEMPLATES'),
    ('2. 🦸🏼 L''HOMME VOLANT/📇 TEMPLATES/0. 🌐 GAMEPLAY ET SIMULATION'),
    ('2. 🦸🏼 L''HOMME VOLANT/📇 TEMPLATES/0. 🌐 GAMEPLAY ET SIMULATION/ℹ IMPLEMENTATIONS'),
    ('2. 🦸🏼 L''HOMME VOLANT/📇 TEMPLATES/0. 🌐 GAMEPLAY ET SIMULATION/🌲 ENVIRONNEMENT'),
    ('2. 🦸🏼 L''HOMME VOLANT/📇 TEMPLATES/0. 🌐 GAMEPLAY ET SIMULATION/📖 NARRATION'),
    ('2. 🦸🏼 L''HOMME VOLANT/📇 TEMPLATES/0. 🌐 GAMEPLAY ET SIMULATION/🪐 LOIS DU MONDE'),
    ('2. 🦸🏼 L''HOMME VOLANT/📇 TEMPLATES/2. ⏳ TIMELINES'),
    ('2. 🦸🏼 L''HOMME VOLANT/📇 TEMPLATES/2. ⏳ TIMELINES/🫆 ÉVÈNEMENTS MARQUANTS'),
    ('2. 🦸🏼 L''HOMME VOLANT/📇 TEMPLATES/3. 🗺️ MAP'),
    ('2. 🦸🏼 L''HOMME VOLANT/📇 TEMPLATES/3. 🗺️ MAP/⛳ LIEUX'),
    ('2. 🦸🏼 L''HOMME VOLANT/📇 TEMPLATES/3. 🗺️ MAP/🌍 PAYS'),
    ('2. 🦸🏼 L''HOMME VOLANT/📇 TEMPLATES/4. 👥 FACTIONS'),
    ('2. 🦸🏼 L''HOMME VOLANT/📇 TEMPLATES/4. 👥 FACTIONS/⚖️ INSTITUTIONS'),
    ('2. 🦸🏼 L''HOMME VOLANT/📇 TEMPLATES/4. 👥 FACTIONS/⛪ RELIGIONS'),
    ('2. 🦸🏼 L''HOMME VOLANT/📇 TEMPLATES/4. 👥 FACTIONS/✊ IDEOLOGIES'),
    ('2. 🦸🏼 L''HOMME VOLANT/📇 TEMPLATES/4. 👥 FACTIONS/👣 POPULATIONS'),
    ('2. 🦸🏼 L''HOMME VOLANT/📇 TEMPLATES/4. 👥 FACTIONS/📪 COMPAGNIES'),
    ('2. 🦸🏼 L''HOMME VOLANT/📇 TEMPLATES/4. 👥 FACTIONS/🤝 TEAMS'),
    ('2. 🦸🏼 L''HOMME VOLANT/📇 TEMPLATES/5. 👤 PERSONNAGES'),
    ('2. 🦸🏼 L''HOMME VOLANT/📇 TEMPLATES/5. 👤 PERSONNAGES/🚸 ENJEUX'),
    ('2. 🦸🏼 L''HOMME VOLANT/📇 TEMPLATES/5. 👤 PERSONNAGES/🚸 ENJEUX/🏫 ECOLE'),
    ('2. 🦸🏼 L''HOMME VOLANT/📇 TEMPLATES/5. 👤 PERSONNAGES/🚸 ENJEUX/🦸‍♀️ SUPER-HUMAINS'),
    ('2. 🦸🏼 L''HOMME VOLANT/📇 TEMPLATES/5. 👤 PERSONNAGES/🚸 ENJEUX/🫂 VOISINAGE'),
    ('2. 🦸🏼 L''HOMME VOLANT/🗒️ RÉSUMÉS'),
    ('2. 🦸🏼 L''HOMME VOLANT/🗒️ RÉSUMÉS/1. 🗃️ BASES DE DONNÉES'),
    ('2. 🦸🏼 L''HOMME VOLANT/🗒️ RÉSUMÉS/1. 🗃️ BASES DE DONNÉES/SCHÉMAS'),
    ('2. 🦸🏼 L''HOMME VOLANT/🗒️ RÉSUMÉS/1. 🗃️ BASES DE DONNÉES/🗂️ CATALOGUES'),
    ('2. 🦸🏼 L''HOMME VOLANT/🗒️ RÉSUMÉS/2. ⌛ TIMELINES'),
    ('2. 🦸🏼 L''HOMME VOLANT/🗒️ RÉSUMÉS/2. ⌛ TIMELINES/🎥 SCÈNES'),
    ('2. 🦸🏼 L''HOMME VOLANT/🗒️ RÉSUMÉS/2. ⌛ TIMELINES/🫆 ÉVÈNEMENTS MARQUANTS'),
    ('2. 🦸🏼 L''HOMME VOLANT/🗒️ RÉSUMÉS/3. 🗺️ MAP'),
    ('2. 🦸🏼 L''HOMME VOLANT/🗒️ RÉSUMÉS/3. 🗺️ MAP/🌍 PAYS'),
    ('2. 🦸🏼 L''HOMME VOLANT/🗒️ RÉSUMÉS/4. 👥 FACTIONS'),
    ('2. 🦸🏼 L''HOMME VOLANT/🗒️ RÉSUMÉS/4. 👥 FACTIONS/⚖️ INSTITUTIONS'),
    ('2. 🦸🏼 L''HOMME VOLANT/🗒️ RÉSUMÉS/4. 👥 FACTIONS/⛪ RELIGIONS'),
    ('2. 🦸🏼 L''HOMME VOLANT/🗒️ RÉSUMÉS/4. 👥 FACTIONS/✊ IDÉOLOGIES'),
    ('2. 🦸🏼 L''HOMME VOLANT/🗒️ RÉSUMÉS/4. 👥 FACTIONS/📪 COMPAGNIES'),
    ('2. 🦸🏼 L''HOMME VOLANT/🗒️ RÉSUMÉS/4. 👥 FACTIONS/🤝 TEAMS'),
    ('2. 🦸🏼 L''HOMME VOLANT/🗒️ RÉSUMÉS/5. 👤 PERSONNAGES'),
    ('2. 🦸🏼 L''HOMME VOLANT/🗒️ RÉSUMÉS/5. 👤 PERSONNAGES/🚸 ENJEUX'),
    ('2. 🦸🏼 L''HOMME VOLANT/🗒️ RÉSUMÉS/5. 👤 PERSONNAGES/🚸 ENJEUX/🦸‍♀️ SUPER-HUMAINS'),
    ('à cacher'),
    ('à cacher/Tags')
), live as (
  select normalize(rel_path, NFC) as p from app_123ecriture.vault_files
  where vault_id = 'bbce9f43-d767-45c9-a221-31c45ec4a03a' and deleted = false
)
insert into app_123ecriture.vault_files
  (vault_id, owner_id, rel_path, content_hash, size_bytes, storage_object_path, updated_at, deleted)
select v.id, v.owner_id, w.dir || '/.123ecriture-dossier',
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 0,
  v.id::text || '/' || w.dir || '/.123ecriture-dossier', now(), false
from v cross join wanted w
where not exists (select 1 from live where live.p like replace(replace(replace(w.dir,'\','\\'),'%','\%'),'_','\_') || '/%')
on conflict (vault_id, rel_path) do nothing;
