// ✒️ 123ECRITURE — lib/sync/supabaseClient.ts — client Supabase partagé (auth + synchro)
//////////////////////////////////////////////////////////////////////////////
//
// Client Supabase unique de l'app. Projet « Projet Synapse », partagé avec
// d'autres apps : toutes les tables de 123Ecriture vivent dans le schéma
// dédié `app_123ecriture` (jamais `public`, réservé aux autres apps) —
// voir supabase/migrations/.
//
// Invariants du fichier :
//   • URL + clé « publishable » (anon) viennent de variables EXPO_PUBLIC_*,
//     inline au build par Expo (voir apps/mobile/.env.example) : cette clé
//     est SÛRE à exposer côté client, elle n'autorise que ce que les
//     policies RLS permettent explicitement (voir la migration SQL).
//   • `supabase` vaut `null` si les variables d'env ne sont pas renseignées
//     (ex. build sans .env local) plutôt que de planter au chargement du
//     module — AuthContext/syncEngine dégradent proprement dans ce cas.
//   • SUPABASE_URL / SUPABASE_ANON_KEY sont exportées pour les
//     téléchargements Storage hors supabase-js (expo/fetch tamponne les
//     réponses en mémoire Java → OOM natif sur Android, voir
//     syncEngine.downloadRemoteText).
//
// SOMMAIRE :
//   1. Les variables d'environnement et le client (SUPABASE_URL, SUPABASE_ANON_KEY, supabase)
//   2. Les constantes de schéma et de tables
//
//////////////////////////////////////////////////////////////////////////////

//////// 1. Les variables d'environnement et le client (SUPABASE_URL, SUPABASE_ANON_KEY, supabase) ///////////

import { Platform } from 'react-native';
import { createClient } from '@supabase/supabase-js';

import { nativeAuthStorage } from './nativeAuthStorage';

export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
export const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

export const supabase =
  SUPABASE_URL && SUPABASE_ANON_KEY
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
          // PKCE : nécessaire pour le flux OAuth "navigateur système" utilisé
          // par le shell Electron (voir AuthContext.tsx) — le flow implicite
          // classique ne convient pas à une redirection vers un schéma
          // d'URL personnalisé (app123ecriture://...).
          flowType: 'pkce',
          // Session persistée : localStorage dans le renderer Electron
          // (partition par défaut, persistante — comportement par défaut du
          // client, laissé explicite ici pour la documentation) ; fichier
          // JSON du stockage privé sur natif (nativeAuthStorage.ts) — sans
          // lui, supabase-js retombe sur un stockage en mémoire et la
          // session disparaît à chaque redémarrage de l'app.
          storage: Platform.OS === 'web' ? undefined : nativeAuthStorage,
          persistSession: true,
          // En NAVIGATEUR PUR (pas de pont Electron), le retour Google →
          // Supabase recharge la page du site avec ?code=... : supabase-js
          // doit détecter et échanger ce code au chargement (puis nettoyer
          // l'URL). Dans le renderer Electron, le callback arrive via le
          // protocole app123ecriture:// et AuthContext appelle explicitement
          // exchangeCodeForSession — la détection d'URL doit rester off.
          // (Test explicite sur Platform : `typeof window` ne suffit pas —
          // window existe aussi sous Hermes natif.)
          detectSessionInUrl:
            Platform.OS === 'web' && typeof window !== 'undefined' && !('electronBridge' in window),
        },
      })
    : null;

//////// 2. Les constantes de schéma et de tables ///////////

// Nom du schéma Postgres dédié à 123Ecriture dans le projet Supabase partagé
// "Projet Synapse" — voir supabase/migrations/.
export const APP_SCHEMA = 'app_123ecriture';

export const VAULTS_TABLE = 'vaults';
export const VAULT_FILES_TABLE = 'vault_files';
export const VAULT_DEVICES_TABLE = 'vault_devices';
// PASSERELLE À DISTANCE : file de commandes par appareil (dump-diagnostics,
// activation de la synchro…) — voir deviceGateway.ts et la migration
// 20261018210000_device_commands.sql.
export const DEVICE_COMMANDS_TABLE = 'device_commands';
export const VAULT_FILES_BUCKET = '123ecriture-vaults';
