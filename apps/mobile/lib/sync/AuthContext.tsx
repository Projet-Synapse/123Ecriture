import type { Session } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { supabase } from './supabaseClient';
import { errorMessage } from '../errorMessage';
import { parseAuthCallbackUrl } from '../authCallback';

// Connexion par compte Google (voir docs/ARCHITECTURE.md §6 et
// apps/desktop/electron/auth.js pour le pont "navigateur système +
// protocole personnalisé" propre à Electron). Même schéma dégradé que
// PreferencesContext/VaultsContext : sans window.auth (web/mobile natif
// pour l'instant, voir apps/desktop/electron/preload.js) ou sans client
// Supabase configuré (variables d'env absentes, voir supabaseClient.ts),
// `available` reste `false` et la carte "Compte" de SettingsScreen affiche
// un message plutôt qu'un bouton cassé.
//
// En NAVIGATEUR PUR (pont web installé par installWebBridges, pas de pont
// Electron), la connexion se déroule dans la même page : redirectTo est
// l'URL du site elle-même (doit être autorisée dans les Redirect URLs
// Supabase) et le retour ?code=... est échangé par supabase-js au
// rechargement (detectSessionInUrl, voir supabaseClient.ts).
const IS_ELECTRON = typeof window !== 'undefined' && 'electronBridge' in window;

// URL de retour canonique en navigateur pur : l'URL courante sans
// « index.html » final et avec slash final. Même ressource pour le serveur,
// mais une seule forme possible à autoriser dans les Redirect URLs du
// dashboard Supabase — sinon « /app/ » autorisé + retour effectif sur
// « /app/index.html » (ou l'inverse) fait basculer Supabase sur sa Site URL
// de repli, qui peut ne pas exister (404 GitHub Pages au retour de Google).
function webRedirectTo(): string {
  const canonical = window.location.pathname.replace(/index\.html$/, '');
  return `${window.location.origin}${canonical.endsWith('/') ? canonical : `${canonical}/`}`;
}

const REDIRECT_TO =
  typeof window !== 'undefined' && !IS_ELECTRON ? webRedirectTo() : 'app123ecriture://auth-callback';

type AuthUser = { id: string; email: string | null };

type AuthContextValue = {
  session: Session | null;
  user: AuthUser | null;
  loading: boolean;
  available: boolean;
  error: string | null;
  // Message informatif distinct de `error` (ex. « confirme ton email ») —
  // même neutralisé qu'une erreur dès qu'une session s'établit.
  notice: string | null;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthReactContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const bridge = typeof window !== 'undefined' ? window.auth : undefined;
  const available = Boolean(bridge && supabase);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(() => available);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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
      // Une session qui s'établit invalide toute erreur d'auth périmée.
      // Cas vécu « invalid flow state » : le PREMIER échange avait réussi,
      // mais une seconde livraison du même callback (Windows peut relancer
      // le gestionnaire de protocole deux fois) échouait sur le code déjà
      // consommé et laissait l'erreur affichée PAR-DESSUS l'état connecté.
      if (newSession) {
        setError(null);
        setNotice(null);
      }
    });
    return () => authListener.subscription.unsubscribe();
  }, []);

  // Callback OAuth reçu via le protocole personnalisé (voir auth.js) —
  // termine l'échange PKCE amorcé par signInWithGoogle ci-dessous.
  // Idempotent et gardé par session (mêmes raisons que ci-dessus) :
  // - la MÊME URL livrée deux fois : la seconde est ignorée ;
  // - une URL d'un flux périmé (ancien onglet navigateur complété après un
  //   nouveau clic sur « Se connecter ») alors qu'une session existe déjà :
  //   ignorée aussi, sans afficher d'erreur.
  const handledCallbackUrls = useRef<Set<string>>(new Set());
  const exchangeCallbackUrl = useCallback((url: string) => {
    if (!supabase) return;
    if (handledCallbackUrls.current.has(url)) return;
    handledCallbackUrls.current.add(url);
    void (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (data.session) {
          setError(null);
          return;
        }
        // supabase-js >= 2.1xx (multi-flux PKCE) : exchangeCodeForSession
        // attend LE CODE (pas l'URL) et un options.flowId pour viser le bon
        // flux. L'URL du protocole custom porte les deux — voir
        // lib/authCallback.ts (pur, testé) pour le décodage, et le pourquoi
        // du bug « invalid flow state » quand on lui passait l'URL entière
        // (POST /token → 404 flow_state_not_found, constaté sur v0.4.6).
        const { code, flowId, error: oauthError } = parseAuthCallbackUrl(url);
        if (oauthError) throw new Error(oauthError);
        if (!code) return; // rien à échanger (URL sans code : déjà traitée)
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(
          code,
          flowId ? { flowId } : undefined,
        );
        if (exchangeError) throw exchangeError;
        setError(null);
      } catch (err) {
        console.error('[auth] échec de connexion :', err);
        setError(errorMessage(err));
      }
    })();
  }, []);

  useEffect(() => {
    if (!bridge) return;
    const unsubscribe = bridge.onCallback(exchangeCallbackUrl);
    // Démarrage à froid : l'app lancée PAR le lien de callback (elle était
    // fermée au moment du retour OAuth) reçoit l'URL dans argv — le process
    // principal la met de côté et le renderer la tire ici, une seule fois
    // (voir auth.ts / preload.ts). Sans cette consommation, la connexion
    // échouait silencieusement quand l'app n'était pas déjà ouverte.
    if (bridge.takePendingUrl) {
      void bridge.takePendingUrl().then((url) => {
        if (url) exchangeCallbackUrl(url);
      });
    }
    return unsubscribe;
  }, [bridge, exchangeCallbackUrl]);

  const signInWithGoogle = useCallback(async () => {
    if (!bridge || !supabase) return;
    setError(null);
    setNotice(null);
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
      setError(errorMessage(err));
    }
  }, [bridge]);

  // Connexion email/mot de passe — complément volontairement SANS navigateur
  // externe ni protocole custom (contrairement au flux Google) : formulaire
  // dans l'app, supabase-js fait le reste. Même compte/web dashboard que
  // Google pour un même email : les deux méthodes cohabitent sur le projet.
  const signInWithEmail = useCallback(async (email: string, password: string) => {
    if (!supabase) return;
    setError(null);
    setNotice(null);
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) throw signInError;
    } catch (err) {
      console.error('[auth] échec de la connexion email :', err);
      setError(errorMessage(err));
    }
  }, []);

  const signUpWithEmail = useCallback(async (email: string, password: string) => {
    if (!supabase) return;
    setError(null);
    setNotice(null);
    try {
      const { data, error: signUpError } = await supabase.auth.signUp({ email, password });
      if (signUpError) throw signUpError;
      // Projet avec confirmation email active (défaut Supabase) : aucune
      // session n'est ouverte à l'inscription — on l'explique plutôt que
      // d'afficher un état « connecté » mensonger.
      if (!data.session) {
        setNotice('Compte créé — vérifie ta boîte mail (et les indésirables) pour confirmer ton adresse, puis connecte-toi.');
      }
    } catch (err) {
      console.error('[auth] échec de la création de compte :', err);
      setError(errorMessage(err));
    }
  }, []);

  const signOut = useCallback(async () => {
    if (!supabase) return;
    setError(null);
    setNotice(null);
    try {
      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) throw signOutError;
    } catch (err) {
      console.error('[auth] échec de la déconnexion :', err);
      setError(errorMessage(err));
    }
  }, []);

  const value = useMemo<AuthContextValue>(() => {
    const user: AuthUser | null = session?.user
      ? { id: session.user.id, email: session.user.email ?? null }
      : null;
    return { session, user, loading, available, error, notice, signInWithGoogle, signInWithEmail, signUpWithEmail, signOut };
  }, [session, loading, available, error, notice, signInWithGoogle, signInWithEmail, signUpWithEmail, signOut]);

  return <AuthReactContext.Provider value={value}>{children}</AuthReactContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthReactContext);
  if (!ctx) {
    throw new Error('useAuth() doit être appelé sous <AuthProvider>');
  }
  return ctx;
}
