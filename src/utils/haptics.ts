/**
* src/utils/haptics.ts
*
* Unified tactile feedback provider leveraging expo-haptics.
* Safe across iOS, Android, and Web with zero crash risk.
*/

import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

export const hapticFeedback = {
  /**
   * Subtle micro-impact for tab switching, button clicks, and chip presses.
   */
  light: () => {
    if (Platform.OS !== 'web') {
      try {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => { });
      } catch {
        // Safe no-op on unsupported hardware
      }
    }
  },

  /**
   * Crisp selection tick for number pad entries, steppers, and radio buttons.
   */
  selection: () => {
    if (Platform.OS !== 'web') {
      try {
        Haptics.selectionAsync().catch(() => { });
      } catch {
        // Safe no-op on unsupported hardware
      }
    }
  },

  /**
   * Success notification pulse for completed invoice finalize or stock adjustment.
   */
  success: () => {
    if (Platform.OS !== 'web') {
      try {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => { });
      } catch {
        // Safe no-op on unsupported hardware
      }
    }
  },

  /**
   * Error notification pulse for failed validation or network error.
   */
  error: () => {
    if (Platform.OS !== 'web') {
      try {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => { });
      } catch {
        // Safe no-op on unsupported hardware
      }
    }
  },
};
