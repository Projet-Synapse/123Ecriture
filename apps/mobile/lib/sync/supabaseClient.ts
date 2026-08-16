import { createClient } from '@supabase/supabase-js';

// Client Supabase partagé (auth + synchro) — voir docs/ARCHITECTURE.md §6.
// Projet "Projet Synapse", partagé avec d'autres apps : toutes les tables de
// 123Ecriture vivent dans le schéma dédié `app_123ecriture` (jamais
// `public`, réservé aux autres apps) — voir supabase/migrations/.
//
// URL + clé "publishable" (anon) viennent de variables `EXPO_PUBLIC_*` :
// Expo les inline au build (voir apps/mobile/.env.example) — cette clé est
// SÛRE à exposer côté client, elle n'autorise que ce que les policies RLS
// permettent explicitement (voir la migration SQL).
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

// `null` si les variables d'env ne sont pas renseignées (ex. build sans
// .env local) plutôt que de planter au chargement du module — AuthContext/
// syncEngine dégradent proprement dans ce cas (mêmes règles que
// PreferencesContext quand window.preferences est absent).
export const supabase =
  SUPABASE_URL && SUPABASE_ANON_KEY
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
          // PKCE : nécessaire pour le flux OAuth "navigateur système" utilisé
          // par le shell Electron (voir AuthContext.tsx) — le flow implicite
          // classique ne convient pas à une redirection vers un schéma
          // d'URL personnalisé (app123ecriture://...).
          flowType: 'pkce',
          // localStorage persiste la session entre redémarrages de l'app
          // dans le renderer Electron (partition par défaut, persistante) —
          // comportement par défaut du client, laissé explicite ici pour la
          // documentation.
          persistSession: true,
          detectSessionInUrl: false,
        },
      })
    : null;

// Nom du schéma Postgres dédié à 123Ecriture dans le projet Supabase partagé
// "Projet Synapse" — voir supabase/migrations/.
export const APP_SCHEMA = 'app_123ecriture';

export const VAULTS_TABLE = 'vaults';
export const VAULT_FILES_TABLE = 'vault_files';
export const VAULT_FILES_BUCKET = '123ecriture-vaults';
