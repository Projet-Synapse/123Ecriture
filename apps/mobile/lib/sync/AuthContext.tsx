import type { Session } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { supabase } from './supabaseClient';

// Connexion par compte Google (voir docs/ARCHITECTURE.md §6 et
// apps/desktop/electron/auth.js pour le pont "navigateur système +
// protocole personnalisé" propre à Electron). Même schéma dégradé que
// PreferencesContext/VaultsContext : sans window.auth (web/mobile natif
// pour l'instant, voir apps/desktop/electron/preload.js) ou sans client
// Supabase configuré (variables d'env absentes, voir supabaseClient.ts),
// `available` reste `false` et la carte "Compte" de SettingsScreen affiche
// un message plutôt qu'un bouton cassé.
const REDIRECT_TO = 'app123ecriture://auth-callback';

type AuthUser = { id: string; email: string | null };

type AuthContextValue = {
  session: Session | null;
  user: AuthUser | null;
  loading: boolean;
  available: boolean;
  error: string | null;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthReactContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const bridge = typeof window !== 'undefined' ? window.auth : undefined;
  const available = Boolean(bridge && supabase);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(() => available);
  const [error, setError] = useState<string | null>(null);

  // Session courante au montage + abonnement aux changements (connexion,
  // déconnexion, rafraîchissement de token...) — géré entièrement par
  // supabase-js, aucun pont Electron nécessaire pour cette partie.
  useEffect(() => {
    if (!supabase) return;
    void (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        setSession(data.session);
      } catch (err) {
        console.error('[auth] échec de récupération de la session :', err);
      } finally {
        setLoading(false);
      }
    })();

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });
    return () => authListener.subscription.unsubscribe();
  }, []);

  // Callback OAuth reçu via le protocole personnalisé (voir auth.js) —
  // termine l'échange PKCE amorcé par signInWithGoogle ci-dessous.
  useEffect(() => {
    // Capturée dans une const locale : la narrowing de `!client` doit
    // survivre à la fermeture imbriquée ci-dessous (TypeScript ne fait pas
    // toujours confiance à une narrowing d'import à travers une closure).
    const client = supabase;
    if (!bridge || !client) return;
    return bridge.onCallback((url) => {
      void (async () => {
        try {
          const { error: exchangeError } = await client.auth.exchangeCodeForSession(url);
          if (exchangeError) throw exchangeError;
          setError(null);
        } catch (err) {
          console.error('[auth] échec de connexion :', err);
          setError(err instanceof Error ? err.message : String(err));
        }
      })();
    });
  }, [bridge]);

  const signInWithGoogle = useCallback(async () => {
    if (!bridge || !supabase) return;
    setError(null);
    try {
      // `skipBrowserRedirect` : on ne veut PAS que supabase-js navigue la
      // fenêtre de l'app elle-même vers Google (bloqué par Google dans un
      // contexte Electron) — juste qu'il nous renvoie l'URL à ouvrir dans
      // le navigateur système via le pont auth.js.
      const { data, error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: REDIRECT_TO, skipBrowserRedirect: true },
      });
      if (oauthError) throw oauthError;
      if (!data.url) throw new Error('Supabase n’a pas renvoyé d’URL de connexion.');
      await bridge.openExternal(data.url);
    } catch (err) {
      console.error('[auth] échec du lancement de la connexion :', err);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [bridge]);

  const signOut = useCallback(async () => {
    if (!supabase) return;
    setError(null);
    try {
      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) throw signOutError;
    } catch (err) {
      console.error('[auth] échec de la déconnexion :', err);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const value = useMemo<AuthContextValue>(() => {
    const user: AuthUser | null = session?.user
      ? { id: session.user.id, email: session.user.email ?? null }
      : null;
    return { session, user, loading, available, error, signInWithGoogle, signOut };
  }, [session, loading, available, error, signInWithGoogle, signOut]);

  return <AuthReactContext.Provider value={value}>{children}</AuthReactContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthReactContext);
  if (!ctx) {
    throw new Error('useAuth() doit être appelé sous <AuthProvider>');
  }
  return ctx;
}
