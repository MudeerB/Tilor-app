/**
 * src/hooks/useSession.tsx
 *
 * React Context that manages authentication state throughout the app.
 * Replaces the old AsyncStorage-based session.
 *
 * Usage:
 *   const { session, userProfile, loading, signOut, isOwner } = useAuth();
 */

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
} from 'react';
import { Session } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import { supabase } from '../services/supabase';
import { getCurrentProfile, signOut as authSignOut } from '../services/auth';
import { UserProfile } from '../types/auth';
import { isPasswordExpired } from '../utils/authValidation';

// ─── Context shape ────────────────────────────────────────────────────────────

interface AuthContextValue {
  /** Raw Supabase session (contains JWT tokens). Null if not signed in. */
  session: Session | null;
  /** Full user profile from public.users (shop_id, role, etc.). */
  userProfile: UserProfile | null;
  /** True while the initial session check is running on cold start. */
  loading: boolean;
  /** Signs out the current user (server + local). */
  signOut: () => Promise<void>;
  /** True if the current user has the 'owner' role. */
  isOwner: boolean;
  /** True if the current user has the 'admin' role. */
  isAdmin: boolean;
  /** True if the current user has either 'owner' or 'admin' role. */
  isOwnerOrAdmin: boolean;
  /** Refresh the userProfile from the database. */
  refreshProfile: () => Promise<void>;
  /** True if the user is in the middle of a password reset flow. */
  recoveryMode: boolean;
  /** Allows the app to exit recovery mode after password is set. */
  setRecoveryMode: (mode: boolean) => void;
  /** True if staff password has exceeded 90 days rotation policy. */
  isPasswordExpired: boolean;
}

const AuthContext = createContext<AuthContextValue>({
  session: null,
  userProfile: null,
  loading: true,
  signOut: async () => {},
  isOwner: false,
  isAdmin: false,
  isOwnerOrAdmin: false,
  refreshProfile: async () => {},
  recoveryMode: false,
  setRecoveryMode: () => {},
  isPasswordExpired: false,
});

// ─── Provider ─────────────────────────────────────────────────────────────────

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [recoveryMode, setRecoveryMode] = useState(false);

  const loadProfile = useCallback(async (currentSession: Session | null) => {
    if (!currentSession?.user) {
      setUserProfile(null);
      await AsyncStorage.removeItem('tilor_cached_user_profile').catch(() => {});
      return;
    }
    const profile = await getCurrentProfile();
    // [SECURITY FIX] Revoke session immediately if account is confirmed deactivated by server
    if (profile && profile.is_active === false) {
      await authSignOut();
      setSession(null);
      setUserProfile(null);
      await AsyncStorage.removeItem('tilor_cached_user_profile').catch(() => {});
      return;
    }
    if (profile) {
      // Cache profile locally so offline cold start doesn't lock user out
      await AsyncStorage.setItem('tilor_cached_user_profile', JSON.stringify(profile)).catch(() => {});
      setUserProfile(profile);
    } else {
      // Fallback to local cache if device is offline
      const cached = await AsyncStorage.getItem('tilor_cached_user_profile').catch(() => null);
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          if (parsed && parsed.id === currentSession.user.id) {
            // Immediately revoke if cached profile was already deactivated
            if (parsed.is_active === false) {
              await authSignOut();
              setSession(null);
              setUserProfile(null);
              await AsyncStorage.removeItem('tilor_cached_user_profile').catch(() => {});
              return;
            }
            setUserProfile(parsed);
            return;
          }
        } catch {}
      }
      setUserProfile(null);
    }
  }, []);

  const refreshProfile = useCallback(async () => {
    await loadProfile(session);
  }, [session, loadProfile]);

  // On mount: restore existing session & listen for auth changes
  useEffect(() => {
    let mounted = true;

    // 1. Get existing session on cold start
    supabase.auth.getSession().then(({ data: { session: existing } }) => {
      if (!mounted) return;
      setSession(existing);
      loadProfile(existing).finally(() => {
        if (mounted) setLoading(false);
      });
    });

    // 2. Listen for sign-in / sign-out / token-refresh events
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, newSession) => {
        if (!mounted) return;
        
        if (event === 'PASSWORD_RECOVERY') {
          setRecoveryMode(true);
        }

        setSession(newSession);
        loadProfile(newSession);
      }
    );

    // 3. Listen for app foregrounding to re-check user active status and password expiry
    const appStateSub = AppState.addEventListener('change', (nextAppState) => {
      if (nextAppState === 'active') {
        supabase.auth.getSession().then(({ data: { session: current } }) => {
          if (current) {
            loadProfile(current);
          }
        });
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
      appStateSub.remove();
    };
  }, [loadProfile]);

  const handleSignOut = useCallback(async () => {
    await authSignOut();
    await AsyncStorage.removeItem('tilor_cached_user_profile').catch(() => {});
    setSession(null);
    setUserProfile(null);
  }, []);

  const passwordExpired = Boolean(
    userProfile &&
    userProfile.role === 'staff' &&
    isPasswordExpired(userProfile.password_changed_at)
  );

  const value: AuthContextValue = {
    session,
    userProfile,
    loading,
    signOut: handleSignOut,
    isOwner: userProfile?.role === 'owner',
    isAdmin: userProfile?.role === 'admin',
    isOwnerOrAdmin: userProfile?.role === 'owner' || userProfile?.role === 'admin',
    refreshProfile,
    recoveryMode,
    setRecoveryMode,
    isPasswordExpired: passwordExpired,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

// ─── Hook ─────────────────────────────────────────────────────────────────────

export const useAuth = () => useContext(AuthContext);
