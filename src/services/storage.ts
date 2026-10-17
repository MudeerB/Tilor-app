import AsyncStorage from '@react-native-async-storage/async-storage';
import { UserSession } from '../types/auth';

export { UserSession };

const SESSION_KEY = 'tilor_user_session';

export const StorageService = {
  /**
   * Saves the user session to local storage.
   */
  async setSession(session: UserSession): Promise<void> {
    try {
      await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(session));
    } catch (error) {
      console.error('Error saving user session:', error);
      throw error;
    }
  },

  /**
   * Retrieves the user session from local storage.
   */
  async getSession(): Promise<UserSession | null> {
    try {
      const sessionStr = await AsyncStorage.getItem(SESSION_KEY);
      if (!sessionStr) return null;
      return JSON.parse(sessionStr) as UserSession;
    } catch (error) {
      console.error('Error retrieving user session:', error);
      return null;
    }
  },

  /**
   * Clears the user session from local storage (logout).
   */
  async clearSession(): Promise<void> {
    try {
      await AsyncStorage.removeItem(SESSION_KEY);
    } catch (error) {
      console.error('Error clearing user session:', error);
      throw error;
    }
  },
};
