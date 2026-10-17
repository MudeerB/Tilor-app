/**
 * src/services/auth.ts
 *
 * Authentication service layer — all Supabase auth operations.
 * Replaces the hardcoded owner/owner123 + staff/staff123 logic.
 */

import { supabase } from './supabase';
import { UserProfile } from '../types/auth';
import { Platform } from 'react-native';
import { validatePasswordStrength } from '../utils/authValidation';

// ─── Sign In ──────────────────────────────────────────────────────────────────

export interface SignInResult {
  profile: UserProfile;
  error: null;
}

export interface SignInError {
  profile: null;
  error: string;
}

/**
 * Signs in a user with email and password.
 * After successful sign-in:
 *   1. Queries `public.users` to get the user's profile
 *   2. Checks `is_active` — if false, immediately signs out
 *   3. Updates `last_login` timestamp
 */
export async function signIn(
  email: string,
  password: string
): Promise<SignInResult | SignInError> {
  try {
    // Step 1: Supabase Auth sign-in
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });

    if (authError) {
      // Map Supabase error messages to user-friendly ones
      if (authError.status === 429) {
        return {
          profile: null,
          error: 'Too many attempts. Please wait a few minutes and try again.',
        };
      }
      if (
        authError.message.includes('Invalid login credentials') ||
        authError.message.includes('invalid_grant')
      ) {
        return { profile: null, error: 'Incorrect email or password. Please try again.' };
      }
      return { profile: null, error: authError.message };
    }

    if (!authData.user) {
      return { profile: null, error: 'Sign in failed. Please try again.' };
    }

    // Step 2: Load profile from public.users
    const { data: profile, error: profileError } = await supabase
      .from('users')
      .select('*')
      .eq('id', authData.user.id)
      .single();

    if (profileError || !profile) {
      await supabase.auth.signOut();
      return {
        profile: null,
        error: 'Account not found in this shop. Contact your owner.',
      };
    }

    // Step 3: Check is_active — immediately revoke deactivated accounts
    if (!profile.is_active) {
      await supabase.auth.signOut();
      return {
        profile: null,
        error: 'Your account has been deactivated. Contact the shop owner.',
      };
    }

    // Step 4: Update last_login (fire-and-forget, non-blocking)
    supabase
      .from('users')
      .update({ last_login: new Date().toISOString() })
      .eq('id', authData.user.id)
      .then(() => {});

    return { profile: profile as UserProfile, error: null };
  } catch {
    return {
      profile: null,
      error: 'Connection failed. Check your internet and try again.',
    };
  }
}

// ─── Sign Out ─────────────────────────────────────────────────────────────────

/**
 * Signs out the current user.
 * Calls Supabase server-side to invalidate the refresh token.
 */
export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}

// ─── Reset Password ───────────────────────────────────────────────────────────

/**
 * Sends a password reset email via Supabase Auth.
 * Returns an error message string, or null on success.
 */
export async function resetPassword(email: string): Promise<string | null> {
  let redirectUrl = 'tilor://reset-password';
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    redirectUrl = window.location.origin;
  }

  const { error } = await supabase.auth.resetPasswordForEmail(
    email.trim().toLowerCase(),
    {
      redirectTo: redirectUrl,
    }
  );
  if (error) return error.message;
  return null;
}

// ─── Change Password With Re-authentication ───────────────────────────────────

/**
 * Updates user password securely:
 * 1. Re-authenticates with current password to prevent unattended device takeover.
 * 2. Enforces password complexity (min 8 chars, uppercase, lowercase, number).
 * 3. Updates password and records password_changed_at rotation timestamp.
 */
export async function changePasswordWithReauth(
  currentPass: string,
  newPass: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user?.email) {
      return { success: false, error: 'No active session found. Please sign in again.' };
    }

    // 1. Verify caller identity using current password
    const { error: verifyError } = await supabase.auth.signInWithPassword({
      email: session.user.email,
      password: currentPass,
    });

    if (verifyError) {
      return { success: false, error: 'Current password is incorrect.' };
    }

    // 2. Validate new password strength
    const validation = validatePasswordStrength(newPass);
    if (!validation.isValid) {
      return { success: false, error: validation.error };
    }

    if (currentPass === newPass) {
      return { success: false, error: 'New password cannot be the same as your current password.' };
    }

    // 3. Update password in Supabase Auth
    const { error: updateError } = await supabase.auth.updateUser({
      password: newPass,
    });

    if (updateError) {
      return { success: false, error: updateError.message };
    }

    // 4. Record timestamp for 90-day password rotation tracking
    try {
      await supabase.rpc('record_password_change');
    } catch {}

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Failed to update password.' };
  }
}

// ─── Get Current Profile ──────────────────────────────────────────────────────

/**
 * Returns the current user's profile from public.users.
 * Reads active session locally first to avoid unnecessary network auth/v1/user hits.
 */
export async function getCurrentProfile(): Promise<UserProfile | null> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    let userId = session?.user?.id;

    if (!userId) {
      const { data: { user } } = await supabase.auth.getUser();
      userId = user?.id;
    }

    if (!userId) return null;

    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();

    if (error || !data) return null;
    return data as UserProfile;
  } catch {
    return null;
  }
}

// ─── Get Session ──────────────────────────────────────────────────────────────

/**
 * Returns the current Supabase session, or null if not authenticated.
 * Used on app cold start to restore session automatically.
 */
export async function getSession() {
  const { data: { session } } = await supabase.auth.getSession();
  return session;
}

/**
 * Fetches all staff and owner profiles for a given shop.
 * Useful for assigning tasks or dispatch batches.
 */
export async function fetchShopStaff(shopId: string): Promise<UserProfile[]> {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('shop_id', shopId)
      .eq('is_active', true)
      .order('full_name', { ascending: true });

    if (error || !data) return [];
    return data as UserProfile[];
  } catch {
    return [];
  }
}
