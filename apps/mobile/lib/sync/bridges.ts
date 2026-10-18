// ✒️ 123ECRITURE — lib/sync/bridges.ts — l'accès aux ponts de plateforme
//////////////////////////////////////////////////////////////////////////////
//
// Le point d'entrée unique des ponts (window.vault / window.sync /
// window.vaults, posés par installNativeBridges ou installWebBridges).
// requireBridges REFUSE tout environnement incomplet : un pont manquant est
// une erreur explicite, jamais un undefined silencieux.
//
// SOMMAIRE :
//   1. L'accès garanti aux ponts
//
//////////////////////////////////////////////////////////////////////////////

import { supabase } from './supabaseClient';

//////// 1. L'accès garanti aux ponts //////////////////////////////////////

export function requireBridges() {
  if (!supabase) throw new Error('Client Supabase non configuré (variables EXPO_PUBLIC_SUPABASE_* absentes).');
  if (typeof window === 'undefined' || !window.vault || !window.sync || !window.vaults) {
    throw new Error('Synchronisation indisponible sur cette plateforme.');
  }
  return { supabase, vault: window.vault, sync: window.sync, vaults: window.vaults };
}

