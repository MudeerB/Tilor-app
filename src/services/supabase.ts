/**
 * src/services/supabase.ts
 *
 * Supabase client with native hardware-backed ChunkedSecureStore adapter.
 *
 * SPRINT 2 FIX: OWASP A02 - Cryptographic Failures.
 * Replaces custom, vulnerable AES-CTR encryption (static counter keystream reuse
 * and hardcoded fallback keys) with native hardware-backed chunking via expo-secure-store.
 *
 * Android's expo-secure-store is limited to 2048 bytes per key.
 * Large JWT tokens are safely chunked into <= 1800 byte segments stored across
 * native Android Keystore and iOS Keychain.
 */

import 'react-native-get-random-values';
import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { Platform } from 'react-native';

// ─── Chunked SecureStore Adapter ──────────────────────────────────────────────

const CHUNK_SIZE = 1800; // Well below Android Keystore 2048-byte limit

export const ChunkedSecureStore = {
  async getItem(key: string): Promise<string | null> {
    try {
      // On Web, SecureStore is unavailable; delegate to AsyncStorage (localStorage)
      if (Platform.OS === 'web') {
        return await AsyncStorage.getItem(key);
      }

      // 1. Check if the value was saved in multiple chunks
      const countStr = await SecureStore.getItemAsync(`${key}_chunks`);
      if (countStr) {
        const count = parseInt(countStr, 10);
        if (!isNaN(count) && count > 0) {
          const chunks: string[] = [];
          for (let i = 0; i < count; i++) {
            const chunk = await SecureStore.getItemAsync(`${key}_${i}`);
            if (chunk === null) {
              return null; // Corrupted or incomplete chunks
            }
            chunks.push(chunk);
          }
          return chunks.join('');
        }
      }

      // 2. Otherwise read as a single unchunked item
      const singleValue = await SecureStore.getItemAsync(key);
      if (singleValue) {
        return singleValue;
      }

      // 3. Fallback for legacy cleanup
      return null;
    } catch {
      return null;
    }
  },

  async setItem(key: string, value: string): Promise<void> {
    try {
      // On Web, delegate directly to AsyncStorage
      if (Platform.OS === 'web') {
        await AsyncStorage.setItem(key, value);
        return;
      }

      // If the value fits in a single chunk, store directly
      if (value.length <= CHUNK_SIZE) {
        await SecureStore.setItemAsync(key, value);
        // Clean up any old chunk artifacts if key previously had multiple chunks
        await ChunkedSecureStore.cleanChunks(key);
        return;
      }

      // Value exceeds safe chunk size: chunk across hardware-backed store
      const prevCountStr = await SecureStore.getItemAsync(`${key}_chunks`);
      const prevCount = prevCountStr ? parseInt(prevCountStr, 10) : 0;

      const count = Math.ceil(value.length / CHUNK_SIZE);
      await SecureStore.setItemAsync(`${key}_chunks`, String(count));

      for (let i = 0; i < count; i++) {
        const slice = value.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
        await SecureStore.setItemAsync(`${key}_${i}`, slice);
      }

      // Prune any orphaned chunks if new value has fewer chunks than before
      if (!isNaN(prevCount) && prevCount > count) {
        for (let i = count; i < prevCount; i++) {
          await SecureStore.deleteItemAsync(`${key}_${i}`).catch(() => {});
        }
      }

      // Delete the legacy unchunked key if present
      await SecureStore.deleteItemAsync(key).catch(() => {});
    } catch (err) {
      console.error('[ChunkedSecureStore] setItem failed:', err);
    }
  },

  async removeItem(key: string): Promise<void> {
    try {
      if (Platform.OS === 'web') {
        await AsyncStorage.removeItem(key).catch(() => {});
        return;
      }
      await ChunkedSecureStore.cleanChunks(key);
      await SecureStore.deleteItemAsync(key).catch(() => {});
      // Also clean up any legacy AsyncStorage entry
      await AsyncStorage.removeItem(key).catch(() => {});
    } catch {
      // Ignore removal errors
    }
  },

  async cleanChunks(key: string): Promise<void> {
    try {
      const countStr = await SecureStore.getItemAsync(`${key}_chunks`);
      if (countStr) {
        const count = parseInt(countStr, 10);
        if (!isNaN(count)) {
          for (let i = 0; i < count; i++) {
            await SecureStore.deleteItemAsync(`${key}_${i}`).catch(() => {});
          }
        }
        await SecureStore.deleteItemAsync(`${key}_chunks`).catch(() => {});
      }
    } catch {}
  },
};

// ─── Supabase Client Initialization ───────────────────────────────────────────

const supabaseUrl =
  process.env.EXPO_PUBLIC_SUPABASE_URL ||
  'https://ddjpljgswesrzzcrojtn.supabase.co';

const supabaseAnonKey =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkanBsamdzd2Vzcnp6Y3JvanRuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcxNDM0OTksImV4cCI6MjEwMjcxOTQ5OX0.4H3uVFTNDsZUDkgALY2dvzCJzW8T62VxoJUSxLqrTfk';

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    '[Supabase] Warning: Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY.'
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: ChunkedSecureStore,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
